import { describe, expect, it, vi } from "vitest";
import {
  QueueScheduler,
  createSubmissionQueue,
  type DispatchTargetSnapshot,
  type QueueDispatchContext,
  type QueueDispatchTarget,
  type QueueItem,
} from "../../../src/core/queue";

describe("QueueScheduler", () => {
  it("dispatches one item and waits for the target to become idle", async () => {
    const queue = createSubmissionQueue<string>();
    const target = new TestDispatchTarget<string>();
    const scheduler = new QueueScheduler({ queue, target });

    const first = queue.enqueue("first");
    const second = queue.enqueue("second");

    await vi.waitFor(() => expect(target.dispatchedIds).toEqual([first.id]));
    expect(queue.has(first.id)).toBe(false);
    expect(queue.has(second.id)).toBe(true);
    expect(scheduler.getSnapshot().status).toBe("waiting");

    target.complete();
    await vi.waitFor(() =>
      expect(target.dispatchedIds).toEqual([first.id, second.id]),
    );

    scheduler.dispose();
  });

  it("uses priority with FIFO as the stable tie breaker", async () => {
    const queue = createSubmissionQueue<string>();
    const target = new TestDispatchTarget<string>();
    const scheduler = new QueueScheduler({
      queue,
      target,
      autoStart: false,
    });
    const low = queue.enqueue("low", { priority: 1 });
    const highFirst = queue.enqueue("high first", { priority: 5 });
    const highSecond = queue.enqueue("high second", { priority: 5 });

    scheduler.start();
    await vi.waitFor(() =>
      expect(target.dispatchedIds).toEqual([highFirst.id]),
    );
    target.complete();
    await vi.waitFor(() =>
      expect(target.dispatchedIds).toEqual([highFirst.id, highSecond.id]),
    );
    target.complete();
    await vi.waitFor(() =>
      expect(target.dispatchedIds).toEqual([
        highFirst.id,
        highSecond.id,
        low.id,
      ]),
    );

    scheduler.dispose();
  });

  it("dispatches a selected item immediately when the target is idle", async () => {
    const queue = createSubmissionQueue<string>();
    const target = new TestDispatchTarget<string>();
    const scheduler = new QueueScheduler({
      queue,
      target,
      autoStart: false,
    });
    const first = queue.enqueue("first");
    const selected = queue.enqueue("selected");

    const result = await scheduler.dispatchNow(selected.id);

    expect(result).toEqual({
      status: "dispatched",
      itemId: selected.id,
    });
    expect(target.dispatchedIds).toEqual([selected.id]);
    expect(queue.has(first.id)).toBe(true);
    expect(queue.has(selected.id)).toBe(false);

    scheduler.dispose();
  });

  it("keeps a selected item queued while the target is running", async () => {
    const queue = createSubmissionQueue<string>();
    const target = new TestDispatchTarget<string>();
    target.setRunning();
    const scheduler = new QueueScheduler({ queue, target });
    const item = queue.enqueue("next turn");

    const result = await scheduler.dispatchNow(item.id);

    expect(result).toEqual({ status: "busy", itemId: item.id });
    expect(target.dispatchedIds).toEqual([]);
    expect(queue.has(item.id)).toBe(true);
    await vi.waitFor(() =>
      expect(scheduler.getSnapshot().status).toBe("waiting"),
    );

    scheduler.dispose();
  });

  it("surfaces a blocked target through the scheduler status", async () => {
    const queue = createSubmissionQueue<string>();
    const target = new TestDispatchTarget<string>();
    target.setBlocked();
    const scheduler = new QueueScheduler({ queue, target });
    const item = queue.enqueue("blocked");

    await vi.waitFor(() =>
      expect(scheduler.getSnapshot().status).toBe("blocked"),
    );
    expect(await scheduler.dispatchNow(item.id)).toEqual({
      status: "blocked",
      itemId: item.id,
    });
    expect(queue.has(item.id)).toBe(true);

    scheduler.dispose();
  });

  it("marks a rejected dispatch as failed until it is retried explicitly", async () => {
    const queue = createSubmissionQueue<string>();
    const target = new TestDispatchTarget<string>();
    const scheduler = new QueueScheduler({
      queue,
      target,
      autoStart: false,
    });
    const failedItem = queue.enqueue("fail");
    target.dispatchError = new Error("dispatch failed");

    const failedResult = await scheduler.dispatchNow(failedItem.id);
    expect(failedResult).toMatchObject({
      status: "failed",
    });
    expect(queue.get(failedItem.id)?.status).toBe("failed");

    target.dispatchError = undefined;
    queue.retry(failedItem.id);
    await expect(scheduler.dispatchNow(failedItem.id)).resolves.toEqual({
      status: "dispatched",
      itemId: failedItem.id,
    });
    scheduler.dispose();
  });

  it("waits until a scheduled item becomes due", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const queue = createSubmissionQueue<string>();
    const target = createAlwaysIdleTarget<string>();
    const scheduler = new QueueScheduler({
      queue,
      target,
      now: () => now,
    });

    try {
      queue.enqueue("later", { scheduledAt: 1_100 });
      await vi.runAllTicks();
      expect(target.dispatchedIds).toEqual([]);
      expect(scheduler.getSnapshot().status).toBe("waiting");

      now = 1_100;
      await vi.advanceTimersByTimeAsync(100);
      expect(target.dispatchedIds).toHaveLength(1);
      expect(queue.size).toBe(0);
    } finally {
      scheduler.dispose();
      vi.useRealTimers();
    }
  });

  it("locks dispatch before queue listeners can reenter the scheduler", async () => {
    const queue = createSubmissionQueue<string>();
    const target = createAlwaysIdleTarget<string>();
    const scheduler = new QueueScheduler({
      queue,
      target,
      autoStart: false,
    });
    const first = queue.enqueue("first");
    const second = queue.enqueue("second");
    let reentrantResult:
      | ReturnType<typeof scheduler.dispatchNow>
      | undefined;

    queue.subscribe(() => {
      if (
        !reentrantResult &&
        queue.get(first.id)?.status === "dispatching"
      ) {
        reentrantResult = scheduler.dispatchNow(second.id);
      }
    });

    await scheduler.dispatchNow(first.id);

    expect(await reentrantResult).toEqual({
      status: "busy",
      itemId: second.id,
    });
    expect(target.dispatchedIds).toEqual([first.id]);
    scheduler.dispose();
  });

  it("coalesces dispatch through microtasks instead of recursive pumping", async () => {
    const queue = createSubmissionQueue<number>();
    const target = createAlwaysIdleTarget<number>();
    const scheduler = new QueueScheduler({
      queue,
      target,
      autoStart: false,
    });
    queue.enqueueMany(
      Array.from({ length: 300 }, (_, value) => ({ payload: value })),
    );

    scheduler.start();
    await vi.waitFor(() => expect(queue.size).toBe(0), { timeout: 3000 });

    expect(target.dispatchedIds).toHaveLength(300);
    scheduler.dispose();
  });

  it("cancels and requeues an in-flight dispatch when disposed", async () => {
    const queue = createSubmissionQueue<string>();
    const target = createPendingTarget<string>();
    const scheduler = new QueueScheduler({
      queue,
      target,
      autoStart: false,
    });
    const item = queue.enqueue("preserve me");

    const resultPromise = scheduler.dispatchNow(item.id);
    await vi.waitFor(() =>
      expect(queue.get(item.id)?.status).toBe("dispatching"),
    );
    scheduler.dispose();

    await expect(resultPromise).resolves.toEqual({
      status: "cancelled",
      itemId: item.id,
    });
    expect(queue.get(item.id)?.status).toBe("queued");
    expect(scheduler.getSnapshot().status).toBe("disposed");
  });
});

class TestDispatchTarget<TPayload>
  implements QueueDispatchTarget<TPayload>
{
  public readonly dispatchedIds: string[] = [];
  public dispatchError?: unknown;
  private readonly listeners = new Set<() => void>();
  private snapshot: DispatchTargetSnapshot = { status: "idle" };

  public subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = () => this.snapshot;

  public dispatch = async (
    item: QueueItem<TPayload>,
    context: QueueDispatchContext,
  ) => {
    if (context.signal.aborted) {
      throw createAbortError();
    }
    if (this.dispatchError) {
      throw this.dispatchError;
    }
    this.dispatchedIds.push(item.id);
    this.setRunning();
  };

  public setRunning() {
    this.setSnapshot({ status: "running" });
  }

  public setBlocked() {
    this.setSnapshot({ status: "blocked" });
  }

  public complete() {
    this.setSnapshot({ status: "idle" });
  }

  private setSnapshot(snapshot: DispatchTargetSnapshot) {
    this.snapshot = snapshot;
    [...this.listeners].forEach((listener) => listener());
  }
}

function createAlwaysIdleTarget<TPayload>() {
  const dispatchedIds: string[] = [];

  return {
    dispatchedIds,
    subscribe: () => () => undefined,
    getSnapshot: () => ({ status: "idle" as const }),
    async dispatch(item: QueueItem<TPayload>) {
      dispatchedIds.push(item.id);
    },
  } satisfies QueueDispatchTarget<TPayload> & { dispatchedIds: string[] };
}

function createPendingTarget<TPayload>(): QueueDispatchTarget<TPayload> {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => ({ status: "idle" }),
    dispatch: (_item, { signal }) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(createAbortError()), {
          once: true,
        });
      }),
  };
}

function createAbortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
