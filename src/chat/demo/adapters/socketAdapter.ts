import { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type {
  ActivitySnapshotEvent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import type {
  ThinkingActivityContent,
  ThinkingActivityPhase,
} from "../thinkingActivity";
import { THINKING_ACTIVITY_TYPE } from "../thinkingActivity";

export type BackendMessage = {
  isCompleted?: boolean;
  event:
    | "run_started"
    | "thinking_started"
    | "thinking_delta"
    | "thinking_completed"
    | "streaming_started"
    | "streaming"
    | "streaming_completed"
    | "function_call"
    | "completed"
    | "error";
  message?: {
    id?: string;
    content?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
  error?: string;
};

export type BackendTransport = {
  close?: () => void;
  onDisconnected?: (event: SocketDisconnectEvent) => void;
  run: (
    input: RunAgentInput,
    handlers: {
      onMessage: (message: BackendMessage) => void;
      onError: (error: Error) => void;
    },
  ) => () => void;
};

export type SocketDisconnectEvent = {
  error: Error;
  code?: number;
  reason?: string;
  wasClean?: boolean;
};

export type SocketAdapterAgentOptions = {
  agentId?: string;
  description?: string;
  threadId?: string;
  initialMessages?: Message[];
  onDisconnected?: (event: SocketDisconnectEvent) => void;
};

export type SocketAdapterAgentCloseOptions = {
  notifyDisconnected?: boolean;
};

export type SocketDebugEvent = {
  direction: "open" | "send" | "receive" | "error" | "close";
  url: string;
  payload?: string;
  timestamp: string;
};

export const SOCKET_DEBUG_EVENT_NAME = "chat-runtime-socket-debug";

export type WebSocketBackendTransportOptions = {
  parseMessage?: (data: string) => BackendMessage;
  serializeRun?: (input: RunAgentInput) => string;
  onDebugEvent?: (event: SocketDebugEvent) => void;
};

type WebSocketRunHandlers = {
  onMessage: (message: BackendMessage) => void;
  onError: (error: Error) => void;
};

export class WebSocketBackendTransport implements BackendTransport {
  private readonly url: string;
  private readonly options: WebSocketBackendTransportOptions;
  public onDisconnected?: (event: SocketDisconnectEvent) => void;
  private activeHandlers?: WebSocketRunHandlers;
  private pendingPayloads: string[] = [];
  private socket?: WebSocket;

  constructor(
    url: string,
    options: WebSocketBackendTransportOptions = {},
  ) {
    this.url = url;
    this.options = options;
  }

  run(
    input: RunAgentInput,
    handlers: WebSocketRunHandlers,
  ) {
    this.activeHandlers = handlers;
    this.send(
      this.options.serializeRun?.(input) ??
        JSON.stringify({
          event: "run",
          input,
        }),
    );

    return () => {
      if (this.activeHandlers === handlers) {
        this.activeHandlers = undefined;
      }
    };
  }

  close() {
    this.pendingPayloads = [];
    this.socket?.close(4000, "Manual socket disconnect");
  }

  private connect() {
    if (
      this.socket &&
      this.socket.readyState !== WebSocket.CLOSED &&
      this.socket.readyState !== WebSocket.CLOSING
    ) {
      return this.socket;
    }

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.emitDebugEvent({ direction: "open" });
      this.flushPendingPayloads();
    };
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket) {
        return;
      }
      const payload = String(data);
      this.emitDebugEvent({
        direction: "receive",
        payload,
      });

      try {
        this.activeHandlers?.onMessage(
          this.options.parseMessage?.(payload) ??
            (JSON.parse(payload) as BackendMessage),
        );
      } catch (error) {
        this.activeHandlers?.onError(toError(error));
      }
    };
    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }
      this.emitDebugEvent({
        direction: "error",
        payload: "WebSocket backend connection failed.",
      });
      this.handleDisconnect(socket, {
        error: new Error("WebSocket backend connection failed."),
      });
      socket.close();
    };
    socket.onclose = (event) => {
      this.emitDebugEvent({ direction: "close" });
      const reason =
        event.reason.trim() || `WebSocket disconnected (${event.code}).`;
      this.handleDisconnect(socket, {
        error: new Error(reason),
        code: event.code,
        reason: event.reason || undefined,
        wasClean: event.wasClean,
      });
    };

    return socket;
  }

  private emitDebugEvent(
    event: Omit<SocketDebugEvent, "url" | "timestamp">,
  ) {
    const debugEvent: SocketDebugEvent = {
      ...event,
      url: this.url,
      timestamp: new Date().toISOString(),
    };
    this.options.onDebugEvent?.(debugEvent);
    window.dispatchEvent(
      new CustomEvent<SocketDebugEvent>(SOCKET_DEBUG_EVENT_NAME, {
        detail: debugEvent,
      }),
    );
  }

  private handleDisconnect(
    socket: WebSocket,
    event: SocketDisconnectEvent,
  ) {
    if (this.socket !== socket) {
      return;
    }

    this.socket = undefined;
    this.pendingPayloads = [];
    const handlers = this.activeHandlers;
    this.activeHandlers = undefined;

    try {
      handlers?.onError(event.error);
    } finally {
      this.onDisconnected?.(event);
    }
  }

  private flushPendingPayloads() {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const payloads = this.pendingPayloads;
    this.pendingPayloads = [];
    payloads.forEach((payload) => this.send(payload));
  }

  private send(payload: string) {
    const socket = this.connect();
    if (socket.readyState !== WebSocket.OPEN) {
      this.pendingPayloads.push(payload);
      return;
    }

    this.emitDebugEvent({
      direction: "send",
      payload,
    });
    socket.send(payload);
  }
}

export class SocketAdapterAgent extends AbstractAgent {
  private readonly transport: BackendTransport;

  constructor(
    transport: BackendTransport,
    options: SocketAdapterAgentOptions = {},
  ) {
    super({
      agentId: options.agentId ?? "default",
      description:
        options.description ?? "Socket-backed AG-UI adapter agent.",
      threadId: options.threadId,
      initialMessages: options.initialMessages,
    });
    this.transport = transport;
    if (options.onDisconnected) {
      this.onDisconnected = options.onDisconnected;
    }
  }

  set onDisconnected(
    callback: ((event: SocketDisconnectEvent) => void) | undefined,
  ) {
    this.transport.onDisconnected = callback;
  }

  close(options: SocketAdapterAgentCloseOptions = {}) {
    if (!options.notifyDisconnected) {
      this.onDisconnected = undefined;
    }
    this.transport.close?.();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const textMessageIds = new Set<string>();
      const thinkingMessageId = `thinking:${input.runId}`;
      let thinkingPhase: ThinkingActivityPhase = "processing";
      let thinkingText = "";
      let toolCallIndex = 0;
      let hasRunStarted = false;

      const emit = (event: BaseEvent) => subscriber.next(event);
      const emitThinkingSnapshot = () => {
        const content: ThinkingActivityContent = {
          phase: thinkingPhase,
          text: thinkingText,
        };
        const event: ActivitySnapshotEvent = {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: thinkingMessageId,
          activityType: THINKING_ACTIVITY_TYPE,
          content,
          replace: true,
        };

        emit(event);
      };
      const ensureRunStarted = () => {
        if (hasRunStarted) return;
        hasRunStarted = true;
        emit({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        });
        emitThinkingSnapshot();
      };

      ensureRunStarted();

      const disconnect = this.transport.run(input, {
        onMessage: (message) => {
          const messageId = message.message?.id ?? `assistant-${input.runId}`;
          ensureRunStarted();

          switch (message.event) {
            case "run_started":
              break;
            case "thinking_started": {
              thinkingPhase = "thought";
              emitThinkingSnapshot();
              break;
            }
            case "thinking_delta": {
              thinkingPhase = "thought";
              thinkingText += message.message?.content ?? "";
              emitThinkingSnapshot();
              break;
            }
            case "thinking_completed":
              break;
            case "streaming_started": {
              thinkingPhase = "answering";
              emitThinkingSnapshot();
              textMessageIds.add(messageId);
              emit({
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: "assistant",
              });
              break;
            }
            case "streaming":
              emit({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId,
                delta: message.message?.content ?? "",
              });
              break;
            case "streaming_completed":
              if (textMessageIds.delete(messageId)) {
                emit({
                  type: EventType.TEXT_MESSAGE_END,
                  messageId,
                });
              }
              break;
            case "function_call": {
              const toolCallId = `tool-${input.runId}-${toolCallIndex++}-${
                message.message?.name ?? "unknown"
              }`;
              emit({
                type: EventType.TOOL_CALL_START,
                toolCallId,
                toolCallName: message.message?.name ?? "unknown",
              });
              emit({
                type: EventType.TOOL_CALL_ARGS,
                toolCallId,
                delta: JSON.stringify(message.message?.arguments ?? {}),
              });
              emit({
                type: EventType.TOOL_CALL_END,
                toolCallId,
              });
              break;
            }
            case "completed":
              thinkingPhase = "completed";
              emitThinkingSnapshot();
              emit({
                type: EventType.RUN_FINISHED,
                threadId: input.threadId,
                runId: input.runId,
                outcome: { type: "success" },
              });
              subscriber.complete();
              break;
            case "error":
              emit({
                type: EventType.RUN_ERROR,
                message: message.error ?? "Socket backend error.",
              });
              subscriber.complete();
              break;
          }
        },
        onError: (error) => subscriber.error(error),
      });

      return () => disconnect();
    });
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
