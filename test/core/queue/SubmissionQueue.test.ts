import { describe, expect, it, vi } from "vitest";
import { createSubmissionQueue } from "../../../src/core/queue";

describe("SubmissionQueue", () => {
  it("stores the complete payload and preserves FIFO insertion order", () => {
    const queue = createTestQueue<{
      text: string;
      files: readonly string[];
    }>();
    const firstPayload = {
      text: "first",
      files: ["release.txt"],
    };

    const first = queue.enqueue(firstPayload, {
      metadata: { region: "cn" },
    });
    const second = queue.enqueue({ text: "second", files: [] });

    expect(queue.list().map((item) => item.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(first.payload).toBe(firstPayload);
    expect(first.metadata).toEqual({ region: "cn" });
    expect(queue.peekFirst()).toBe(first);
    expect(queue.takeFirst()).toBe(first);
    expect(queue.peekFirst()).toBe(second);
  });

  it("publishes one stable snapshot per mutation", () => {
    const queue = createTestQueue<string>();
    const listener = vi.fn();
    queue.subscribe(listener);

    const initial = queue.getSnapshot();
    expect(queue.getSnapshot()).toBe(initial);

    queue.enqueue("one");
    const next = queue.getSnapshot();

    expect(next).not.toBe(initial);
    expect(queue.getSnapshot()).toBe(next);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("takes an arbitrary queued item for editing without changing its payload", () => {
    const queue = createTestQueue<{ text: string; audio?: string }>();
    const first = queue.enqueue({ text: "first" });
    const editablePayload = { text: "edit me", audio: "voice.wav" };
    const editable = queue.enqueue(editablePayload);

    const taken = queue.take(editable.id);

    expect(taken?.payload).toBe(editablePayload);
    expect(queue.has(editable.id)).toBe(false);
    expect(queue.peekFirst()).toBe(first);
  });

  it("supports priority and payload updates before dispatch", () => {
    const queue = createTestQueue<{ text: string }>();
    const item = queue.enqueue({ text: "draft" });

    const updated = queue.update(item.id, {
      payload: { text: "revised" },
      priority: 10,
      scheduledAt: 500,
    });

    expect(updated).toMatchObject({
      priority: 10,
      scheduledAt: 500,
      revision: 1,
    });
    expect(updated?.payload.text).toBe("revised");
  });

  it("protects a dispatching item from editing and deletion", () => {
    const queue = createTestQueue<string>();
    const item = queue.enqueue("send me");
    const claimed = queue.claim(item.id);

    expect(claimed).toMatchObject({
      status: "dispatching",
      attempts: 1,
    });
    expect(queue.take(item.id)).toBeUndefined();
    expect(queue.update(item.id, { priority: 2 })).toBeUndefined();
    expect(queue.clear()).toEqual([]);

    expect(queue.ack(item.id)?.id).toBe(item.id);
    expect(queue.size).toBe(0);
  });

  it("can fail, edit, retry, and requeue a dispatch", () => {
    const queue = createTestQueue<string>();
    const failedItem = queue.enqueue("retry me");
    const error = new Error("offline");

    queue.claim(failedItem.id);
    expect(queue.fail(failedItem.id, error)).toMatchObject({
      status: "failed",
      lastError: error,
    });
    expect(queue.retry(failedItem.id)).toMatchObject({
      status: "queued",
      attempts: 1,
      lastError: undefined,
    });

    queue.claim(failedItem.id);
    expect(queue.release(failedItem.id, { error })).toMatchObject({
      status: "queued",
      attempts: 2,
      lastError: error,
    });
  });

  it("rejects duplicate item ids without partially enqueueing a batch", () => {
    const queue = createTestQueue<string>();
    queue.enqueue("existing", { id: "fixed" });

    expect(() =>
      queue.enqueueMany([
        { payload: "new", options: { id: "new" } },
        { payload: "duplicate", options: { id: "fixed" } },
      ]),
    ).toThrow('Queue item "fixed" already exists.');
    expect(queue.has("new")).toBe(false);
  });
});

function createTestQueue<TPayload>() {
  let nextId = 0;
  let now = 100;

  return createSubmissionQueue<TPayload, { region: string }>({
    createId: () => `item-${++nextId}`,
    now: () => now++,
  });
}
