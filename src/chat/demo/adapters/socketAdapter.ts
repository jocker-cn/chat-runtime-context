import { AbstractAgent } from "@ag-ui/client";
import type {
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import {
  createBackendMessageEventConverter,
  type BackendMessage,
} from "./backendMessage";

export type { BackendMessage } from "./backendMessage";

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

  cancel(input: RunAgentInput): void {
    // Drop an unsent run instead of flushing it after cancellation.
    this.pendingPayloads = [];
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const payload = JSON.stringify({
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
  private activeRun?: {
    input: RunAgentInput;
    cancelled: boolean;
    stop: (error?: Error) => void;
  };

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

  override abortRun(): void {
    const run = this.activeRun;
    if (!run || run.cancelled) return;
    run.cancelled = true;

    try {
      this.transport.cancel?.(run.input);
    } catch (error) {
      // Report send failures through the subscription, including AbortSignal calls.
      run.stop(toError(error));
      return;
    }
    run.stop();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const run = {
        input,
        cancelled: false,
        stop: (error?: Error) => {
          if (error) subscriber.error(error);
          else subscriber.complete();
        },
      };
      this.activeRun = run;
      subscriber.add(() => {
        if (this.activeRun === run) this.activeRun = undefined;
      });
      const emit = (event: BaseEvent) => subscriber.next(event);
      const converter = createBackendMessageEventConverter(input);
      converter.start().forEach(emit);
      if (subscriber.closed) return;

      const disconnect = this.transport.run(input, {
        onMessage: (message) => {
          if (subscriber.closed || run.cancelled) return;
          const conversion = converter.convert(message);
          conversion.events.forEach(emit);
          if (conversion.terminal) {
            subscriber.complete();
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
