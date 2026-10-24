import { describe, expect, it, vi } from "vitest";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { createResponseTraceStore, type ResponseTraceProjector, type ResponseTraceRef } from "../../../src/features/ai-response-trace";
import { projectBackendResponseTrace } from "../../../src/chat/demo/adapters/backendResponseTrace";
import type { AgUiLifecycleNotification } from "../../../src/plugins/ag-ui-lifecycle";

function recording(projectEvents?: ResponseTraceProjector) {
  const store = createResponseTraceStore({ projectEvents });
  const input: RunAgentInput = { threadId: "session", runId: "run", messages: [], tools: [], context: [], state: {}, forwardedProps: {} };
  const ref: ResponseTraceRef = { sourceId: "agent-a", threadId: input.threadId, runId: input.runId };
  let time = 100;
  const send = (data: Partial<AgUiLifecycleNotification>) => store.record({
    ...ref, observedAt: time++, input, messages: [], state: {}, ...data,
  } as AgUiLifecycleNotification);
  const event = (type: string, fields: Record<string, unknown> = {}) => send({ type: "event", event: { type, ...fields } as BaseEvent });
  send({ type: "run-initialized" });
  return { store, input, ref, send, event };
}

describe("independent AI response traces", () => {
  it("retains arbitrary events without interpreting types or inventing phases and durations", () => {
    const { store, ref, send, event } = recording();
    const listener = vi.fn();
    store.subscribe(ref, listener);
    event("MY_STEP", { content: "custom" });
    event("TOOL_CALL_START", { toolCallId: "a" });
    event("MESSAGES_SNAPSHOT", { messages: [] });
    event("RUN_FINISHED");
    expect(store.getSnapshot(ref).record).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    send({ type: "run-finalized" });
    const record = store.getSnapshot(ref).record!;
    expect(record.entries.map((entry) => entry.event)).toEqual(["MY_STEP", "TOOL_CALL_START", "MESSAGES_SNAPSHOT", "RUN_FINISHED"]);
    expect(record.entries[0]?.content).toEqual({ type: "MY_STEP", content: "custom" });
    expect(record.entries.every((entry) => entry.endedAt === undefined)).toBe(true);
    expect(record.summary).toEqual({ durationMs: 5, eventCount: 4 });
    expect(record.outcome).toBe("completed");
    expect(listener).toHaveBeenCalledTimes(1);
    event("LATE_EVENT");
    expect(store.getSnapshot(ref).record).toBe(record);
  });

  it("uses exactly the caller-reported event, content and interval, with immutable copies", () => {
    const supplied = [{ id: "one", event: "由业务定义", content: { result: [1, null, true] }, startedAt: 101, endedAt: 109, details: { all: "fields" } }];
    const mapper = vi.fn(() => supplied);
    const { store, ref, send, event } = recording(mapper);
    event("custom");
    expect(mapper).not.toHaveBeenCalled();
    send({ type: "run-finalized" });
    const record = store.getSnapshot(ref).record!;
    expect(mapper).toHaveBeenCalledTimes(1);
    expect(record.entries).toEqual(supplied);
    supplied[0]!.content.result.push(9);
    expect(record.entries[0]?.content).toEqual({ result: [1, null, true] });
    expect(Object.isFrozen(record.entries[0]?.content)).toBe(true);
    expect(Object.isFrozen(record.events)).toBe(true);
  });

  it.each(["error", "cancelled", "incomplete"])("allows inspection after %s without declaring success", (outcome) => {
    const { store, ref, send, event } = recording();
    event("my_partial", { content: "partial" });
    if (outcome === "error") send({ type: "run-failed", error: new Error("offline") });
    if (outcome === "cancelled") store.markCancelled(ref);
    expect(store.getSnapshot(ref).status).toBe("recording");
    send({ type: "run-finalized" });
    expect(store.getSnapshot(ref).record?.outcome).toBe(outcome);
    expect(store.getSnapshot(ref).record?.entries[0]?.content).toEqual({ type: "my_partial", content: "partial" });
  });

  it("copies received fields and isolates source/run identities", () => {
    const { store, ref, send } = recording();
    const event = { type: EventType.RAW, event: { arbitrary: { nested: [1, 2] } } };
    send({ type: "event", event });
    event.event.arbitrary.nested.push(3);
    send({ type: "run-finalized" });
    expect(store.getSnapshot(ref).record?.events[0]?.event).toEqual({ type: EventType.RAW, event: { arbitrary: { nested: [1, 2] } } });
    expect(store.getSnapshot({ ...ref, sourceId: "agent-b" }).status).toBe("unavailable");
    expect(store.getSnapshot({ ...ref, runId: "another-run" }).status).toBe("unavailable");
    store.dispose();
    expect(store.getSnapshot(ref).status).toBe("unavailable");
  });

  it("lets the demo integration report its own streaming groups and full backend data", () => {
    const { store, ref, send, event } = recording(projectBackendResponseTrace);
    const raw = (payload: Record<string, unknown>) => event("RAW", { source: "copilot-backend", event: payload });
    raw({ event: "thinking_started", message: { id: "first" } });
    raw({ event: "thinking_delta", message: { id: "first", content: "Before" }, extra: { notInSchema: 42 } });
    raw({ event: "thinking_delta", message: { id: "first", content: " tool" } });
    raw({ event: "thinking_completed", message: { id: "first" } });
    raw({ event: "function_call", message: { id: "call", name: "sum", arguments: { numbers: [2, 3] } } });
    raw({ event: "tool_result", message: { id: "call", content: '{"sum":5}' }, providerField: "keep" });
    raw({ event: "thinking_started", message: { id: "second" } });
    raw({ event: "thinking_delta", message: { id: "second", content: "After" } });
    raw({ event: "thinking_completed", message: { id: "second" } });
    raw({ event: "future_event", newField: { preserve: true } });
    event("RAW", { source: "copilot-backend", event: null });
    event("RUN_FINISHED");
    send({ type: "run-finalized" });
    const record = store.getSnapshot(ref).record!;
    expect(record.entries.filter((entry) => entry.event === "thinking").map((entry) => entry.content)).toEqual(["Before tool", "After"]);
    expect(record.entries.filter((entry) => entry.event === "thinking").map((entry) => entry.endedAt! - entry.startedAt)).toEqual([3, 2]);
    const call = record.entries.find((entry) => entry.event === "function_call")!;
    expect(call.endedAt! - call.startedAt).toBe(1);
    expect(record.entries.find((entry) => entry.event === "tool_result")?.content).toBe('{"sum":5}');
    expect(JSON.stringify(record.entries)).toContain('"providerField":"keep"');
    expect(JSON.stringify(record.entries)).toContain('"notInSchema":42');
    expect(record.entries.find((entry) => entry.event === "future_event")?.content).toEqual({ event: "future_event", newField: { preserve: true } });
    expect(record.entries.find((entry) => entry.event === "RAW")?.content).toBeNull();
  });

  it("keeps demo same-name calls paired by ID and does not invent durations for missing results", () => {
    const { store, ref, send, event } = recording(projectBackendResponseTrace);
    const raw = (payload: Record<string, unknown>) => event("RAW", { source: "copilot-backend", event: payload });
    for (const id of ["a", "b", "missing"]) raw({ event: "function_call", message: { id, name: "same", arguments: {} } });
    raw({ event: "tool_result", message: { id: "b", content: "plain text" } });
    raw({ event: "tool_result", message: { id: "a", content: '{"answer":1}' } });
    send({ type: "run-finalized" });
    const entries = store.getSnapshot(ref).record!.entries;
    const calls = entries.filter((entry) => entry.event === "function_call");
    expect(calls.map((entry) => entry.endedAt === undefined ? undefined : entry.endedAt - entry.startedAt)).toEqual([4, 2, undefined]);
    expect(entries.filter((entry) => entry.event === "tool_result").map((entry) => entry.content)).toEqual(["plain text", '{"answer":1}']);
  });
});
