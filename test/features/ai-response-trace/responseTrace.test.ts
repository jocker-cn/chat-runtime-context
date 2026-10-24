import { afterEach, describe, expect, it, vi } from "vitest";
import { createResponseTraceStore } from "../../../src/features/ai-response-trace";

afterEach(() => vi.restoreAllMocks());

describe("protocol-independent response trace records", () => {
  it("accepts just the caller's own type and name without initialization or completion", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const store = createResponseTraceStore();
    expect(store.getSnapshot("response")).toBeUndefined();
    store.report("response", { type: "my-service:step", name: "我的事件" });
    expect(store.getSnapshot("response")).toMatchObject({
      id: "response", startedAt: 100, endedAt: 100, durationMs: 0,
      entries: [{ type: "my-service:step", name: "我的事件", startedAt: 100 }],
    });
    expect(store.getSnapshot("response")?.entries[0]?.endedAt).toBeUndefined();
  });

  it("upserts explicit event IDs in place and keeps prior snapshots and caller data unchanged", () => {
    const store = createResponseTraceStore();
    const listener = vi.fn();
    const stop = store.subscribe("response", listener);
    const content = { arbitrary: { nested: [1, 2] } };
    const id = store.report("response", { type: "any", name: "first", content, startedAt: 100 })!;
    content.arbitrary.nested.push(3);
    const before = store.getSnapshot("response")!;
    store.report("response", { type: "other", name: "second", startedAt: 110 });
    store.report("response", { id, type: "any", content: "updated", endedAt: 120 });
    const after = store.getSnapshot("response")!;
    expect(after.entries.map((entry) => entry.name)).toEqual(["first", "second"]);
    expect(after.entries[0]).toMatchObject({ startedAt: 100, endedAt: 120, content: "updated" });
    expect(before.entries[0]?.content).toEqual({ arbitrary: { nested: [1, 2] } });
    expect(Object.isFrozen(before.entries[0]?.content)).toBe(true);
    expect(Object.isFrozen(after.entries)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    store.report("response", { type: "another" });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("treats error and completion as ordinary events and never invents a terminal state", () => {
    const store = createResponseTraceStore();
    for (const type of ["my_step", "error", "completed", "another_step"]) {
      store.report("response", { type, content: { full: type }, startedAt: 100 });
    }
    expect(store.getSnapshot("response")?.entries.map((entry) => entry.type)).toEqual(["my_step", "error", "completed", "another_step"]);
    expect(store.getSnapshot("response")).not.toHaveProperty("outcome");
    expect(store.getSnapshot("response")).not.toHaveProperty("status");
  });

  it("derives total time from the reported event range rather than adding event durations", () => {
    const store = createResponseTraceStore();
    store.report("response", { type: "a", startedAt: 200, endedAt: 250 });
    store.report("response", { type: "b", startedAt: 150, endedAt: 220 });
    store.report("response", { type: "c", startedAt: 400 });
    expect(store.getSnapshot("response")).toMatchObject({ startedAt: 150, endedAt: 400, durationMs: 250 });
    expect(store.getSnapshot("response")?.entries[2]?.endedAt).toBeUndefined();
  });

  it("isolates arbitrary response IDs and releases subscriptions and records with its owner", () => {
    const store = createResponseTraceStore();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe("response-a", a);
    store.subscribe("response-b", b);
    store.report("response-a", { type: "own-type", content: "a" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(store.getSnapshot("response-b")).toBeUndefined();
    store.report("response-b", { type: "another-type", content: "b" });
    expect(store.getSnapshot("response-a")?.entries[0]?.content).toBe("a");
    store.dispose();
    expect(store.getSnapshot("response-a")).toBeUndefined();
    expect(store.getSnapshot("response-b")).toBeUndefined();
    expect(store.report("response-c", { type: "late" })).toBeUndefined();
  });
});
