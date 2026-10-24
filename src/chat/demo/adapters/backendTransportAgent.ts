import { AbstractAgent, EventType } from "@ag-ui/client";
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

export type BackendTransportDisconnectEvent = {
  error: Error;
  code?: number;
  reason?: string;
  wasClean?: boolean;
};

export type BackendTransport = {
  close?: () => void;
  /** Cancels a run without closing a reusable transport connection. */
  cancel?: (input: RunAgentInput) => void;
  onDisconnected?: (event: BackendTransportDisconnectEvent) => void;
  run: (
    input: RunAgentInput,
    handlers: {
      onMessage: (message: BackendMessage) => void;
      onError: (error: Error) => void;
    },
  ) => () => void;
};

export type BackendTransportAgentOptions = {
  /** Expose original backend payloads as standard RAW events without changing messages. */
  captureRawEvents?: boolean;
  onRunCancelled?: (input: RunAgentInput) => void;
  agentId?: string;
  description?: string;
  threadId?: string;
  initialMessages?: Message[];
  /** Convert failures to run-owned error messages before ending the stream. */
  handleRunErrors?: boolean;
  onDisconnected?: (event: BackendTransportDisconnectEvent) => void;
};

export type BackendTransportAgentCloseOptions = {
  notifyDisconnected?: boolean;
};

/** Adapts a custom backend-message transport to the AG-UI Agent contract. */
export class BackendTransportAgent extends AbstractAgent {
  private readonly transport: BackendTransport;
  private readonly handleRunErrors: boolean;
  private readonly captureRawEvents: boolean;
  private readonly onRunCancelled?: (input: RunAgentInput) => void;
  private activeRun?: {
    input: RunAgentInput;
    cancelled: boolean;
    stop: (error?: Error) => void;
  };

  constructor(
    transport: BackendTransport,
    options: BackendTransportAgentOptions = {},
  ) {
    super({
      agentId: options.agentId ?? "default",
      description:
        options.description ?? "Transport-backed AG-UI adapter agent.",
      threadId: options.threadId,
      initialMessages: options.initialMessages,
    });
    this.transport = transport;
    this.handleRunErrors = options.handleRunErrors ?? false;
    this.captureRawEvents = options.captureRawEvents ?? false;
    this.onRunCancelled = options.onRunCancelled;
    if (options.onDisconnected) {
      this.onDisconnected = options.onDisconnected;
    }
  }

  set onDisconnected(
    callback:
      | ((event: BackendTransportDisconnectEvent) => void)
      | undefined,
  ) {
    this.transport.onDisconnected = callback;
  }

  close(options: BackendTransportAgentCloseOptions = {}) {
    if (!options.notifyDisconnected) {
      this.onDisconnected = undefined;
    }
    this.transport.close?.();
  }

  override abortRun(): void {
    const run = this.activeRun;
    if (!run || run.cancelled) return;
    run.cancelled = true;
    try { this.onRunCancelled?.(run.input); } catch { /* Optional observation cannot cancel the cancellation. */ }

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

      const fail = (error: unknown) => {
        if (subscriber.closed || run.cancelled) return;
        if (this.handleRunErrors) {
          converter.fail(toError(error).message).events.forEach(emit);
          subscriber.complete();
        } else {
          subscriber.error(error);
        }
      };
      let disconnect: (() => void) | undefined;
      try {
        disconnect = this.transport.run(input, {
          onMessage: (message) => {
            if (subscriber.closed || run.cancelled) return;
            try {
              if (this.captureRawEvents) emit({ type: EventType.RAW, source: "copilot-backend", event: message });
              const conversion = this.handleRunErrors && message.event === "error"
                ? converter.fail(message.error ?? "Backend error.")
                : converter.convert(message);
              conversion.events.forEach(emit);
              if (conversion.terminal) subscriber.complete();
            } catch (error) {
              fail(error);
            }
          },
          onError: fail,
        });
      } catch (error) {
        fail(error);
      }

      return () => disconnect?.();
    });
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
