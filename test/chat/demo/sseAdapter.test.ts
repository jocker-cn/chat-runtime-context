import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type {
  EventSourceMessage,
  FetchEventSourceInit,
} from "@microsoft/fetch-event-source";
import { describe, expect, it, vi } from "vitest";
import { SseAdapterAgent } from "../../../src/chat/demo/adapters/sseAdapter";

describe("SseAdapterAgent", () => {
  it("maps the custom backend stream through the shared AG-UI converter", async () => {
    const stream = createFakeEventSource();
    const agent = new SseAdapterAgent("/api/agent", {
      transport: {
        headers: { Authorization: "Bearer test" },
        fetchEventSource: stream.fetchEventSource,
      },
    });
    const events: BaseEvent[] = [];
    const input = runInput("sse-run");
    const subscription = agent.run(input).subscribe((event) => {
      events.push(event);
    });
    await vi.waitFor(() => expect(stream.init).toBeDefined());

    expect(stream.url).toBe("/api/agent");
    expect(stream.init).toMatchObject({
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify(input),
      openWhenHidden: true,
    });

    stream.message({
      event: "streaming_started",
      message: { id: "answer" },
    });
    stream.message({
      event: "streaming",
      message: { id: "answer", content: "hello" },
    });
    stream.message({
      event: "streaming_completed",
      message: { id: "answer" },
    });
    stream.message({ event: "completed" });

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.ACTIVITY_SNAPSHOT,
      EventType.RUN_FINISHED,
    ]);
    expect(events.find(
      (event) => event.type === EventType.TEXT_MESSAGE_CONTENT,
    )).toMatchObject({
      messageId: "answer",
      delta: "hello",
    });
    expect(subscription.closed).toBe(true);
    expect(stream.init?.signal?.aborted).toBe(true);
  });

  it("aborts the active SSE request idempotently", async () => {
    const stream = createFakeEventSource();
    const agent = new SseAdapterAgent("/api/agent", {
      transport: { fetchEventSource: stream.fetchEventSource },
    });
    const subscription = agent.run(runInput("cancelled")).subscribe();
    await vi.waitFor(() => expect(stream.init).toBeDefined());

    agent.abortRun();
    agent.abortRun();

    expect(subscription.closed).toBe(true);
    expect(stream.init?.signal?.aborted).toBe(true);
  });

  it("reports invalid custom messages through the subscription error", async () => {
    const stream = createFakeEventSource();
    const agent = new SseAdapterAgent("/api/agent", {
      transport: { fetchEventSource: stream.fetchEventSource },
    });
    const onError = vi.fn();
    agent.run(runInput("invalid")).subscribe({ error: onError });
    await vi.waitFor(() => expect(stream.init).toBeDefined());

    stream.rawMessage("not-json");

    expect(onError).toHaveBeenCalledWith(expect.any(SyntaxError));
    expect(stream.init?.signal?.aborted).toBe(true);
  });
});

function createFakeEventSource() {
  const stream: {
    url?: RequestInfo;
    init?: FetchEventSourceInit;
    fetchEventSource: (
      input: RequestInfo,
      init: FetchEventSourceInit,
    ) => Promise<void>;
    message(message: unknown): void;
    rawMessage(data: string): void;
  } = {
    fetchEventSource: async (url, init) => {
      stream.url = url;
      stream.init = init;
      await waitForAbort(init.signal);
    },
    message: (message) => stream.rawMessage(JSON.stringify(message)),
    rawMessage: (data) => {
      stream.init?.onmessage?.({
        data,
        event: "",
        id: "",
        retry: undefined,
      } satisfies EventSourceMessage);
    },
  };
  return stream;
}

function waitForAbort(signal?: AbortSignal | null) {
  if (!signal || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function runInput(runId: string): RunAgentInput {
  return {
    threadId: "thread",
    runId,
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
}
