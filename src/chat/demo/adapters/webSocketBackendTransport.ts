import type { RunAgentInput } from "@ag-ui/client";
import type { BackendMessage } from "./backendMessage";
import type {
  BackendTransport,
  BackendTransportDisconnectEvent,
} from "./backendTransportAgent";

export type { BackendMessage } from "./backendMessage";

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
  public onDisconnected?: (
    event: BackendTransportDisconnectEvent,
  ) => void;
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
    event: BackendTransportDisconnectEvent,
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

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
