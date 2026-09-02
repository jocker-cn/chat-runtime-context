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
  agentId?: string;
  description?: string;
  threadId?: string;
  initialMessages?: Message[];
  onDisconnected?: (event: BackendTransportDisconnectEvent) => void;
};

export type BackendTransportAgentCloseOptions = {
  notifyDisconnected?: boolean;
};

/** Adapts a custom backend-message transport to the AG-UI Agent contract. */
export class BackendTransportAgent extends AbstractAgent {
  private readonly transport: BackendTransport;
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
