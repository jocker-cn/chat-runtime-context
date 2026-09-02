import {
  fetchEventSource,
  type FetchEventSourceInit,
} from "@microsoft/fetch-event-source";
import type { RunAgentInput } from "@ag-ui/client";
import {
  BackendTransportAgent,
  type BackendTransportAgentOptions,
  type BackendTransport,
} from "./backendTransportAgent";
import type { BackendMessage } from "./backendMessage";

type FetchEventSource = (
  input: RequestInfo,
  init: FetchEventSourceInit,
) => Promise<void>;

export type SseBackendTransportOptions = {
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  parseMessage?: (data: string) => BackendMessage;
  serializeRun?: (input: RunAgentInput) => string;
  fetch?: typeof fetch;
  fetchEventSource?: FetchEventSource;
};

type ActiveSseRun = {
  input: RunAgentInput;
  controller: AbortController;
  stopped: boolean;
};

export class SseBackendTransport implements BackendTransport {
  private readonly url: string;
  private readonly options: SseBackendTransportOptions;
  private activeRun?: ActiveSseRun;

  constructor(url: string, options: SseBackendTransportOptions = {}) {
    this.url = url;
    this.options = options;
  }

  run(
    input: RunAgentInput,
    handlers: {
      onMessage: (message: BackendMessage) => void;
      onError: (error: Error) => void;
    },
  ) {
    const run: ActiveSseRun = {
      input,
      controller: new AbortController(),
      stopped: false,
    };
    this.activeRun = run;

    const stopWithError = (error: unknown) => {
      if (run.stopped) return;
      run.stopped = true;
      if (this.activeRun === run) this.activeRun = undefined;
      handlers.onError(toError(error));
    };
    const start = this.options.fetchEventSource ?? fetchEventSource;
    void start(this.url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...this.options.headers,
      },
      credentials: this.options.credentials,
      body:
        this.options.serializeRun?.(input) ?? JSON.stringify(input),
      signal: run.controller.signal,
      fetch: this.options.fetch,
      openWhenHidden: true,
      onopen: async (response) => {
        if (!response.ok) {
          throw new Error(`SSE backend request failed (${response.status}).`);
        }
      },
      onmessage: (event) => {
        if (run.stopped || !event.data.trim()) return;
        try {
          handlers.onMessage(
            this.options.parseMessage?.(event.data) ??
              (JSON.parse(event.data) as BackendMessage),
          );
        } catch (error) {
          run.controller.abort();
          stopWithError(error);
        }
      },
      onclose: () => {
        stopWithError(
          new Error("SSE backend stream closed before the run completed."),
        );
      },
      onerror: (error) => {
        stopWithError(error);
        throw error;
      },
    }).catch(stopWithError);

    return () => {
      if (run.stopped) return;
      run.stopped = true;
      if (this.activeRun === run) this.activeRun = undefined;
      run.controller.abort();
    };
  }

  cancel(input: RunAgentInput): void {
    const run = this.activeRun;
    if (
      !run ||
      run.input.threadId !== input.threadId ||
      run.input.runId !== input.runId
    ) {
      return;
    }

    run.stopped = true;
    this.activeRun = undefined;
    run.controller.abort();
  }

  close(): void {
    const run = this.activeRun;
    if (!run) return;
    run.stopped = true;
    this.activeRun = undefined;
    run.controller.abort();
  }
}

export type SseAdapterAgentOptions = Omit<
  BackendTransportAgentOptions,
  "onDisconnected"
> & {
  transport?: SseBackendTransportOptions;
};

export class SseAdapterAgent extends BackendTransportAgent {
  constructor(url: string, options: SseAdapterAgentOptions = {}) {
    const { transport, ...agentOptions } = options;
    super(new SseBackendTransport(url, transport), {
      ...agentOptions,
      description:
        agentOptions.description ?? "SSE-backed AG-UI adapter agent.",
    });
  }
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
