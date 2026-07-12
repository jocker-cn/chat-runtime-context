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

    await vi.waitFor(() => expect(target.startedIds).toEqual([first.id]));
    expect(queue.has(first.id)).toBe(false);
    expect(queue.has(second.id)).toBe(true);

    target.complete();
    await vi.waitFor(() =>
      expect(target.startedIds).toEqual([first.id, second.id]),
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
      expect(target.startedIds).toEqual([highFirst.id]),
    );
    target.complete();
    await vi.waitFor(() =>
      expect(target.startedIds).toEqual([highFirst.id, highSecond.id]),
    );
    target.complete();
    await vi.waitFor(() =>
      expect(target.startedIds).toEqual([
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
      mode: "start",
    });
    expect(target.startedIds).toEqual([selected.id]);
    expect(queue.has(first.id)).toBe(true);
    expect(queue.has(selected.id)).toBe(false);

    scheduler.dispose();
  });

  it("uses steer for a selected item while the target is running", async () => {
    const queue = createSubmissionQueue<{ text: string }>();
    const target = new TestDispatchTarget<{ text: string }>();
    target.setRunning("turn-1");
    const scheduler = new QueueScheduler({ queue, target });
    const selected = queue.enqueue({ text: "change direction" });

    const result = await scheduler.dispatchNow(selected.id);

    expect(result).toEqual({
      status: "dispatched",
      itemId: selected.id,
      mode: "steer",
    });
    expect(target.steered).toEqual([
      {
        itemId: selected.id,
        activeExecutionId: "turn-1",
      },
    ]);
    expect(queue.has(selected.id)).toBe(false);

    scheduler.dispose();
  });

  it("does not call start while running when steer is unavailable", async () => {
    const queue = createSubmissionQueue<string>();
    const target = createTargetWithoutSteer<string>();
    target.setRunning("turn-1");
    const scheduler = new QueueScheduler({ queue, target });
    const item = queue.enqueue("next turn");

    const result = await scheduler.dispatchNow(item.id);

    expect(result).toEqual({ status: "unsupported", itemId: item.id });
    expect(target.startedIds).toEqual([]);
    expect(queue.has(item.id)).toBe(true);

    scheduler.dispose();
  });

  it("marks a failed start and requeues a failed steer by default", async () => {
    const queue = createSubmissionQueue<string>();
    const target = new TestDispatchTarget<string>();
    const scheduler = new QueueScheduler({
      queue,
      target,
      autoStart: false,
    });
    const startItem = queue.enqueue("start");
    target.startError = new Error("start failed");

    const startResult = await scheduler.dispatchNow(startItem.id);
    expect(startResult).toMatchObject({
      status: "failed",
      mode: "start",
      disposition: "fail",
    });
    expect(queue.get(startItem.id)?.status).toBe("failed");

    target.startError = undefined;
    target.steerError = new Error("turn changed");
    target.setRunning("turn-2");
    const steerItem = queue.enqueue("steer");

    const steerResult = await scheduler.dispatchNow(steerItem.id);
    expect(steerResult).toMatchObject({
      status: "failed",
      mode: "steer",
      disposition: "requeue",
    });
    expect(queue.get(steerItem.id)?.status).toBe("queued");

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
      expect(target.startedIds).toEqual([]);

      now = 1_100;
      await vi.advanceTimersByTimeAsync(100);
      expect(target.startedIds).toHaveLength(1);
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
    expect(target.startedIds).toEqual([first.id]);
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

    expect(target.startedIds).toHaveLength(300);
    scheduler.dispose();
  });
});

class TestDispatchTarget<TPayload>
  implements QueueDispatchTarget<TPayload>
{
  public readonly startedIds: string[] = [];
  public readonly steered: Array<{
    itemId: string;
    activeExecutionId?: string;
  }> = [];
  public startError?: unknown;
  public steerError?: unknown;
  private readonly listeners = new Set<() => void>();
  private snapshot: DispatchTargetSnapshot = { status: "idle" };

  public subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = () => this.snapshot;

  public start = async (item: QueueItem<TPayload>) => {
    if (this.startError) {
      throw this.startError;
    }
    this.startedIds.push(item.id);
    this.setRunning(item.id);
  };

  public steer = async (
    item: QueueItem<TPayload>,
    context: QueueDispatchContext,
  ) => {
    if (this.steerError) {
      throw this.steerError;
    }
    this.steered.push({
      itemId: item.id,
      activeExecutionId: context.activeExecutionId,
    });
  };

  public setRunning(activeExecutionId: string) {
    this.setSnapshot({ status: "running", activeExecutionId });
  }

  public complete() {
    this.setSnapshot({ status: "idle" });
  }

  private setSnapshot(snapshot: DispatchTargetSnapshot) {
    this.snapshot = snapshot;
    [...this.listeners].forEach((listener) => listener());
  }
}

function createTargetWithoutSteer<TPayload>() {
  const listeners = new Set<() => void>();
  let snapshot: DispatchTargetSnapshot = { status: "idle" };
  const startedIds: string[] = [];

  return {
    startedIds,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async start(item: QueueItem<TPayload>) {
      startedIds.push(item.id);
    },
    setRunning(activeExecutionId: string) {
      snapshot = { status: "running", activeExecutionId };
      [...listeners].forEach((listener) => listener());
    },
  } satisfies QueueDispatchTarget<TPayload> & {
    startedIds: string[];
    setRunning(activeExecutionId: string): void;
  };
}

function createAlwaysIdleTarget<TPayload>() {
  const startedIds: string[] = [];

  return {
    startedIds,
    subscribe: () => () => undefined,
    getSnapshot: () => ({ status: "idle" as const }),
    async start(item: QueueItem<TPayload>) {
      startedIds.push(item.id);
    },
  } satisfies QueueDispatchTarget<TPayload> & { startedIds: string[] };
}
