import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createResponseTraceStore } from "../../../src/features/ai-response-trace";
import { createAgUiResponseTraceObserver } from "../../../src/plugins/ag-ui-response-trace";
import { observeAgUiAgentLifecycle } from "../../../src/plugins/ag-ui-lifecycle";

class FixtureAgent extends AbstractAgent {
  constructor(private readonly events: (input: RunAgentInput) => BaseEvent[], messages: Message[] = []) {
    super({ initialMessages: messages });
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      this.events(input).forEach((event) => subscriber.next(event));
      subscriber.complete();
    });
  }
}

function textEvents(input: RunAgentInput, id: string, text: string): BaseEvent[] {
  return [
    { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId },
    { type: EventType.TEXT_MESSAGE_START, messageId: id, role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: id, delta: text },
    { type: EventType.TEXT_MESSAGE_END, messageId: id },
    { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId },
  ] as BaseEvent[];
}

describe("independent AG-UI response trace observer", () => {
  it("records a standard AG-UI Agent and resolves actual message IDs with no Runtime", async () => {
    const store = createResponseTraceStore();
    const observer = createAgUiResponseTraceObserver(store);
    let round = 0;
    const agent = new FixtureAgent((input) => textEvents(input, `answer-${++round}`, `text-${round}`),
      [{ id: "history", role: "assistant", content: "old" }]);
    observer.observe(agent, "a");
    await agent.runAgent();
    const first = observer.resolveMessage({ sourceId: "a", messageId: "answer-1" })!;
    expect(store.getSnapshot(first)?.entries.find((entry) => entry.type === "TEXT_MESSAGE")?.content).toBe("text-1");
    expect(observer.resolveMessage({ sourceId: "a", messageId: "history" })).toBeUndefined();
    expect(observer.resolveMessage({ messageId: "answer-1" })).toBeUndefined();
    await agent.runAgent();
    const second = observer.resolveMessage({ sourceId: "a", messageId: "answer-2" })!;
    expect(second).not.toBe(first);
    expect(observer.resolveMessage({ sourceId: "a", messageId: "answer-1" })).toBe(first);
    expect(store.getSnapshot(second)?.entries.find((entry) => entry.type === "TEXT_MESSAGE")?.content).toBe("text-2");
    observer.dispose();
  });

  it("isolates identical message IDs from two sources", async () => {
    const store = createResponseTraceStore();
    const observer = createAgUiResponseTraceObserver(store);
    const a = new FixtureAgent((input) => textEvents(input, "same-id", "A"));
    const b = new FixtureAgent((input) => textEvents(input, "same-id", "B"));
    observer.observe(a, "a");
    observer.observe(b, "b");
    await Promise.all([a.runAgent(), b.runAgent()]);
    const refA = observer.resolveMessage({ sourceId: "a", messageId: "same-id" })!;
    const refB = observer.resolveMessage({ sourceId: "b", messageId: "same-id" })!;
    expect(refA).not.toBe(refB);
    expect(store.getSnapshot(refA)?.entries.find((entry) => entry.type === "TEXT_MESSAGE")?.content).toBe("A");
    expect(store.getSnapshot(refB)?.entries.find((entry) => entry.type === "TEXT_MESSAGE")?.content).toBe("B");
    observer.dispose();
  });

  it("keeps complete native RAW fields and avoids duplicating converted events", async () => {
    const store = createResponseTraceStore();
    const observer = createAgUiResponseTraceObserver(store);
    const raw = (event: unknown): BaseEvent => ({ type: EventType.RAW, source: "copilot-backend", event } as BaseEvent);
    const agent = new FixtureAgent((input) => [
      { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId },
      raw({ event: "thinking_started", message: { id: "thought" } }),
      raw({ event: "thinking_delta", message: { id: "thought", content: "original" }, extra: { all: true } }),
      raw({ event: "thinking_completed", message: { id: "thought" } }),
      raw({ event: "future-step", arbitrary: { nested: [1, null] } }),
      ...textEvents(input, "answer", "final").slice(1),
    ] as BaseEvent[]);
    observer.observe(agent, "a");
    await agent.runAgent();
    const id = observer.resolveMessage({ sourceId: "a", messageId: "answer" })!;
    const entries = store.getSnapshot(id)!.entries;
    expect(entries.map((entry) => entry.type)).toEqual(["thinking", "future-step"]);
    expect(entries[0]?.content).toBe("original");
    expect(JSON.stringify(entries[0]?.details)).toContain('"all":true');
    expect(entries[1]?.content).toEqual({ event: "future-step", arbitrary: { nested: [1, null] } });
    observer.dispose();
  });

  it("coexists with the old lifecycle observer and unsubscribes independently", async () => {
    const store = createResponseTraceStore();
    const observer = createAgUiResponseTraceObserver(store);
    const oldNotification = vi.fn();
    let round = 0;
    const agent = new FixtureAgent((input) => textEvents(input, `answer-${++round}`, "text"));
    const stopOld = observeAgUiAgentLifecycle(agent, { sourceId: "a", onNotification: oldNotification });
    const stopTrace = observer.observe(agent, "a");
    await agent.runAgent();
    expect(oldNotification).toHaveBeenCalled();
    expect(observer.resolveMessage({ sourceId: "a", messageId: "answer-1" })).toBeDefined();
    stopTrace();
    oldNotification.mockClear();
    await agent.runAgent();
    expect(oldNotification).toHaveBeenCalled();
    expect(observer.resolveMessage({ sourceId: "a", messageId: "answer-2" })).toBeUndefined();
    stopOld();
    observer.dispose();
    expect(observer.resolveMessage({ sourceId: "a", messageId: "answer-1" })).toBeUndefined();
  });
});
