import { describe, expect, it, vi } from "vitest";
import { createSubmissionQueue } from "../../../src/core/queue";
import { createMockChatData } from "../../../src/chat/demo/extension-poc/chatHistory";
import { observeQueue, observeRuntime, observeSessions } from "../../../src/chat/demo/extension-poc/analytics/observe";

describe("Pendo read-only observers", () => {
  it("counts submissions once across claim/fail/retry without reading payloads", () => {
    const queue = createSubmissionQueue<{ text: string }>();
    const track = vi.fn();
    const unsubscribe = observeQueue(queue, track);
    const item = queue.enqueue({ text: "private message" });
    queue.claim(item.id);
    queue.fail(item.id, new Error("private error"));
    queue.retry(item.id);
    expect(track.mock.calls).toEqual([[{ name: "chat_submitted", properties: {} }]]);
    expect(queue.get(item.id)?.payload.text).toBe("private message");
    unsubscribe();
    queue.enqueue({ text: "after unmount" });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does not let an analytics failure escape into a successful enqueue", () => {
    const queue = createSubmissionQueue<string>();
    const unsubscribe = observeQueue(queue, () => { throw new Error("SDK failure"); });
    expect(queue.enqueue("still sends").payload).toBe("still sends");
    expect(queue.size).toBe(1);
    unsubscribe();
  });

  it("ignores history, reports A/B terminal states once, and cleans up", () => {
    const listeners = new Set<() => void>();
    const branches: Record<string, { status: string; sourceId: string }> = {
      history: { status: "completed", sourceId: "agent-a" },
    };
    const runtime = {
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      getSnapshot: () => ({ branchesById: branches }),
    };
    const publish = () => listeners.forEach((listener) => listener());
    let now = 100;
    const track = vi.fn();
    const unsubscribe = observeRuntime(runtime, track, () => now);
    expect(track).not.toHaveBeenCalled();
    branches.a = { status: "running", sourceId: "agent-a" };
    branches.b = { status: "running", sourceId: "agent-b" };
    publish();
    now = 180;
    branches.a = { status: "completed", sourceId: "agent-a" };
    branches.b = { status: "error", sourceId: "agent-b" };
    publish(); publish();
    expect(track.mock.calls.map(([event]) => event.properties)).toEqual([
      { agent: "agent-a", outcome: "completed", duration_ms: 80 },
      { agent: "agent-b", outcome: "error", duration_ms: 80 },
    ]);
    branches.c = { status: "running", sourceId: "agent-a" };
    publish();
    now = 200;
    branches.c = { status: "cancelled", sourceId: "agent-a" };
    publish();
    expect(track.mock.lastCall?.[0].properties.outcome).toBe("cancelled");
    unsubscribe();
    expect(listeners.size).toBe(0);
  });

  it("counts created sessions, including same-tick creation, without titles/IDs", async () => {
    const data = createMockChatData();
    const track = vi.fn();
    const unsubscribe = observeSessions(data, track);
    const session = await data.createSession();
    await data.renameSession(session.id, "private title");
    // Allow the serialized baseline and subsequent refreshes to settle.
    await vi.waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    expect(track.mock.calls).toEqual([[{ name: "chat_session_created", properties: {} }]]);
    unsubscribe();
    await data.createSession();
    await Promise.resolve();
    expect(track).toHaveBeenCalledTimes(1);
  });
});
