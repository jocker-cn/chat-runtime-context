import { AbstractAgent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  ActivitySnapshotEvent,
  BaseEvent,
  Message,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import type {
  ThinkingActivityContent,
  ThinkingActivityPhase,
} from "../thinkingActivity";
import { THINKING_ACTIVITY_TYPE } from "../thinkingActivity";

export type BackendMessage = {
  /** Echo these identifiers to reject late events from previous runs. */
  runId?: string;
  threadId?: string;
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
  /** Cancels a run without closing the reusable connection. */
  cancel?: (input: RunAgentInput) => void;
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
  serializeCancel?: (input: RunAgentInput) => string;
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
  private activeInput?: RunAgentInput;
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
    this.activeInput = input;
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
        this.activeInput = undefined;
        this.pendingPayloads = [];
      }
    };
  }

  cancel(input: RunAgentInput): void {
    if (
      !this.activeInput ||
      this.activeInput.runId !== input.runId ||
      this.activeInput.threadId !== input.threadId
    ) {
      return;
    }

    const wasQueued = this.pendingPayloads.length > 0;
    this.pendingPayloads = [];
    this.activeInput = undefined;
    this.activeHandlers = undefined;

    // An unsent run must never be flushed after cancellation. Do not reconnect
    // just to send a cancellation for a run that never reached the backend.
    const socket = this.socket;
    if (wasQueued || !socket || socket.readyState !== WebSocket.OPEN) return;

    const payload = this.options.serializeCancel?.(input) ??
      JSON.stringify({
        event: "cancel",
        threadId: input.threadId,
        runId: input.runId,
      });
    this.emitDebugEvent({ direction: "send", payload });
    socket.send(payload);
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
        if (!this.activeHandlers) return;
        const message = this.options.parseMessage?.(payload) ??
          (JSON.parse(payload) as BackendMessage);
        if (
          (message.runId !== undefined && message.runId !== this.activeInput?.runId) ||
          (message.threadId !== undefined && message.threadId !== this.activeInput?.threadId)
        ) {
          return;
        }
        this.activeHandlers.onMessage(message);
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
    this.activeInput = undefined;

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

type SocketAgentRun = {
  cancelled: boolean;
  input?: RunAgentInput;
  stop?: (error?: Error) => void;
};

export class SocketAdapterAgent extends AbstractAgent {
  private readonly transport: BackendTransport;
  private activeRun?: SocketAgentRun;
  private readonly pendingRuns = new Map<string, SocketAgentRun>();

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

  override runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    const runId = parameters?.runId || crypto.randomUUID();
    const run: SocketAgentRun = { cancelled: false };
    // AG-UI initializes asynchronously before subscribing to run(). Remember
    // cancellation here too, so an immediate Runtime cancel cannot start later.
    this.pendingRuns.set(runId, run);
    this.activeRun = run;
    return super.runAgent({ ...parameters, runId }, subscriber).finally(() => {
      if (this.pendingRuns.get(runId) === run) this.pendingRuns.delete(runId);
      if (this.activeRun === run) this.activeRun = undefined;
    });
  }

  override abortRun(): void {
    const run = this.activeRun;
    if (!run || run.cancelled) return;
    run.cancelled = true;

    try {
      if (run.input) this.transport.cancel?.(run.input);
    } catch (error) {
      // Use the Agent's existing error channel, not an uncaught AbortSignal
      // listener exception. A failed notification is not a backend acknowledgement.
      run.stop?.(toError(error));
      return;
    }
    run.stop?.();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const run: SocketAgentRun = this.pendingRuns.get(input.runId) ?? {
        cancelled: false,
      };
      if (run.cancelled) {
        subscriber.complete();
        return;
      }
      this.activeRun = run;
      run.stop = (error) => {
        if (error) subscriber.error(error);
        else subscriber.complete();
      };
      subscriber.add(() => {
        run.stop = undefined;
        if (this.activeRun === run) this.activeRun = undefined;
      });
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
      if (subscriber.closed) return;

      run.input = input;
      const disconnect = this.transport.run(input, {
        onMessage: (message) => {
          if (subscriber.closed || run.cancelled) return;
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

      subscriber.add(disconnect);
    });
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
