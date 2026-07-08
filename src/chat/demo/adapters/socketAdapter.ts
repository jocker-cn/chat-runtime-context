import { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

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
  run: (
    input: RunAgentInput,
    handlers: {
      onMessage: (message: BackendMessage) => void;
      onError: (error: Error) => void;
    },
  ) => () => void;
};

export type SocketAdapterAgentOptions = {
  agentId?: string;
  description?: string;
  threadId?: string;
  initialMessages?: Message[];
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
    this.activeHandlers = undefined;
    this.socket?.close();
    this.socket = undefined;
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
      this.emitDebugEvent({ direction: "open" });
      this.flushPendingPayloads();
    };
    socket.onmessage = ({ data }) => {
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
      this.emitDebugEvent({
        direction: "error",
        payload: "WebSocket backend connection failed.",
      });
      this.activeHandlers?.onError(
        new Error("WebSocket backend connection failed."),
      );
    };
    socket.onclose = () => {
      this.emitDebugEvent({ direction: "close" });
      if (this.socket === socket) {
        this.socket = undefined;
      }
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
  }

  close() {
    this.transport.close?.();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const textMessageIds = new Set<string>();
      const reasoningMessageIds = new Set<string>();
      let toolCallIndex = 0;
      let hasRunStarted = false;

      const emit = (event: BaseEvent) => subscriber.next(event);
      const ensureRunStarted = () => {
        if (hasRunStarted) return;
        hasRunStarted = true;
        emit({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        });
      };

      const disconnect = this.transport.run(input, {
        onMessage: (message) => {
          const messageId = message.message?.id ?? `assistant-${input.runId}`;
          ensureRunStarted();

          switch (message.event) {
            case "run_started":
              break;
            case "thinking_started": {
              reasoningMessageIds.add(messageId);
              emit({
                type: EventType.REASONING_START,
                messageId,
              });
              emit({
                type: EventType.REASONING_MESSAGE_START,
                messageId,
                role: "reasoning",
              });
              break;
            }
            case "thinking_delta":
              emit({
                type: EventType.REASONING_MESSAGE_CONTENT,
                messageId,
                delta: message.message?.content ?? "",
              });
              break;
            case "thinking_completed": {
              if (reasoningMessageIds.delete(messageId)) {
                emit({
                  type: EventType.REASONING_MESSAGE_END,
                  messageId,
                });
                emit({
                  type: EventType.REASONING_END,
                  messageId,
                });
              }
              break;
            }
            case "streaming_started":
              textMessageIds.add(messageId);
              emit({
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: "assistant",
              });
              break;
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
