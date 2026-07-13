import { ListenerSet } from "../internal/ListenerSet";
import type {
  QueueDispatchResult,
  QueueDispatchTarget,
  QueueItem,
  QueueSchedulerSnapshot,
  QueueSelectionPolicy,
} from "./contracts";
import { createPriorityQueuePolicy } from "./policies";
import type { SubmissionQueue } from "./SubmissionQueue";

export interface QueueSchedulerOptions<
  TPayload = unknown,
  TMetadata = unknown,
> {
  queue: SubmissionQueue<TPayload, TMetadata>;
  target: QueueDispatchTarget<TPayload, TMetadata>;
  selectNext?: QueueSelectionPolicy<TPayload, TMetadata>;
  now?: () => number;
  autoStart?: boolean;
}

export class QueueScheduler<
  TPayload = unknown,
  TMetadata = unknown,
> {
  private readonly listeners = new ListenerSet();
  private readonly queue: SubmissionQueue<TPayload, TMetadata>;
  private readonly target: QueueDispatchTarget<TPayload, TMetadata>;
  private readonly selectNext: QueueSelectionPolicy<TPayload, TMetadata>;
  private readonly now: () => number;
  private unsubscribeQueue?: () => void;
  private unsubscribeTarget?: () => void;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private started = false;
  private paused = false;
  private disposed = false;
  private pumpScheduled = false;
  private dispatchingItemId?: string;
  private dispatchController?: AbortController;
  private snapshot: QueueSchedulerSnapshot = {
    status: "idle",
    dispatchingItemId: undefined,
    lastError: undefined,
  };

  constructor(options: QueueSchedulerOptions<TPayload, TMetadata>) {
    this.queue = options.queue;
    this.target = options.target;
    this.selectNext =
      options.selectNext ?? createPriorityQueuePolicy<TPayload, TMetadata>();
    this.now = options.now ?? Date.now;

    if (options.autoStart ?? true) {
      this.start();
    }
  }

  public readonly subscribe = (listener: () => void): (() => void) =>
    this.listeners.add(listener);

  public readonly getSnapshot = (): QueueSchedulerSnapshot => this.snapshot;

  public start() {
    this.assertNotDisposed();
    if (this.started) {
      return;
    }

    this.started = true;
    this.unsubscribeQueue = this.queue.subscribe(this.schedulePump);
    this.unsubscribeTarget = this.target.subscribe(this.schedulePump);
    this.schedulePump();
  }

  public pause() {
    this.assertNotDisposed();
    if (this.paused) {
      return;
    }

    this.paused = true;
    this.clearWakeTimer();
    this.updateSnapshot({
      status: "paused",
      dispatchingItemId: this.dispatchingItemId,
      lastError: this.snapshot.lastError,
    });
  }

  public resume() {
    this.assertNotDisposed();
    if (!this.paused) {
      return;
    }

    this.paused = false;
    this.updateSnapshot({
      status: this.dispatchingItemId
        ? "dispatching"
        : this.getRestingStatus(),
      dispatchingItemId: this.dispatchingItemId,
      lastError: this.snapshot.lastError,
    });
    this.schedulePump();
  }

  public async dispatchNow(
    itemId: string,
  ): Promise<QueueDispatchResult> {
    this.assertNotDisposed();
    const item = this.queue.get(itemId);
    if (!item || item.status !== "queued") {
      return { status: "not-found", itemId };
    }
    if (this.paused || this.dispatchingItemId) {
      return { status: "busy", itemId };
    }

    const targetSnapshot = this.target.getSnapshot();
    if (targetSnapshot.status === "blocked") {
      return { status: "blocked", itemId };
    }
    if (targetSnapshot.status !== "idle") {
      return { status: "busy", itemId };
    }

    return this.dispatch(item);
  }

  public dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.started = false;
    this.dispatchController?.abort();
    this.unsubscribeQueue?.();
    this.unsubscribeTarget?.();
    this.unsubscribeQueue = undefined;
    this.unsubscribeTarget = undefined;
    this.clearWakeTimer();
    this.updateSnapshot({
      status: "disposed",
      dispatchingItemId: this.dispatchingItemId,
      lastError: this.snapshot.lastError,
    });
    this.listeners.clear();
  }

  private readonly schedulePump = () => {
    if (
      this.disposed ||
      !this.started ||
      this.paused ||
      this.pumpScheduled
    ) {
      return;
    }

    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  };

  private pump() {
    if (
      this.disposed ||
      !this.started ||
      this.paused ||
      this.dispatchingItemId
    ) {
      return;
    }

    const targetSnapshot = this.target.getSnapshot();
    if (targetSnapshot.status === "blocked") {
      this.clearWakeTimer();
      this.setStatus("blocked");
      return;
    }
    if (targetSnapshot.status === "running") {
      this.clearWakeTimer();
      this.setStatus("waiting");
      return;
    }

    const queueSnapshot = this.queue.getSnapshot();
    const now = this.now();
    const next = this.selectNext(queueSnapshot.items, { now });
    if (!next) {
      this.setStatus(
        queueSnapshot.items.some((item) => item.status === "queued")
          ? "waiting"
          : "idle",
      );
      this.scheduleNextWake(queueSnapshot.items, now);
      return;
    }

    this.clearWakeTimer();
    void this.dispatch(next);
  }

  private async dispatch(
    item: QueueItem<TPayload, TMetadata>,
  ): Promise<QueueDispatchResult> {
    if (this.dispatchingItemId) {
      return { status: "busy", itemId: item.id };
    }

    this.dispatchingItemId = item.id;
    const claimed = this.queue.claim(item.id);
    if (!claimed) {
      this.dispatchingItemId = undefined;
      return { status: "not-found", itemId: item.id };
    }
    const controller = new AbortController();
    this.dispatchController = controller;

    this.updateSnapshot({
      status: "dispatching",
      dispatchingItemId: claimed.id,
      lastError: undefined,
    });

    try {
      await waitForDispatch(
        this.target.dispatch(claimed, { signal: controller.signal }),
        controller.signal,
      );

      if (controller.signal.aborted || this.disposed) {
        this.queue.release(claimed.id);
        return { status: "cancelled", itemId: claimed.id };
      }

      this.queue.ack(claimed.id);
      return {
        status: "dispatched",
        itemId: claimed.id,
      };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        this.queue.release(claimed.id);
        return { status: "cancelled", itemId: claimed.id };
      }

      this.queue.fail(claimed.id, error);
      this.updateSnapshot({
        status: "dispatching",
        dispatchingItemId: claimed.id,
        lastError: error,
      });
      return {
        status: "failed",
        itemId: claimed.id,
        error,
      };
    } finally {
      if (this.dispatchController === controller) {
        this.dispatchController = undefined;
      }
      this.dispatchingItemId = undefined;
      if (!this.disposed) {
        this.updateSnapshot({
          status: this.paused ? "paused" : this.getRestingStatus(),
          dispatchingItemId: undefined,
          lastError: this.snapshot.lastError,
        });
        this.schedulePump();
      }
    }
  }

  private scheduleNextWake(
    items: readonly QueueItem<TPayload, TMetadata>[],
    now: number,
  ) {
    const nextScheduledAt = items.reduce<number | undefined>(
      (earliest, item) => {
        if (
          item.status !== "queued" ||
          item.scheduledAt === undefined ||
          item.scheduledAt <= now
        ) {
          return earliest;
        }

        return earliest === undefined
          ? item.scheduledAt
          : Math.min(earliest, item.scheduledAt);
      },
      undefined,
    );

    this.clearWakeTimer();
    if (nextScheduledAt === undefined) {
      return;
    }

    this.wakeTimer = setTimeout(
      this.schedulePump,
      Math.max(0, nextScheduledAt - now),
    );
  }

  private clearWakeTimer() {
    if (this.wakeTimer !== undefined) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = undefined;
    }
  }

  private getRestingStatus(): QueueSchedulerSnapshot["status"] {
    const targetStatus = this.target.getSnapshot().status;
    if (targetStatus === "blocked") {
      return "blocked";
    }
    if (targetStatus === "running") {
      return "waiting";
    }

    return this.queue.getSnapshot().items.some((item) => item.status === "queued")
      ? "waiting"
      : "idle";
  }

  private setStatus(status: QueueSchedulerSnapshot["status"]) {
    this.updateSnapshot({
      status,
      dispatchingItemId: this.dispatchingItemId,
      lastError: this.snapshot.lastError,
    });
  }

  private updateSnapshot(next: QueueSchedulerSnapshot) {
    if (
      this.snapshot.status === next.status &&
      this.snapshot.dispatchingItemId === next.dispatchingItemId &&
      Object.is(this.snapshot.lastError, next.lastError)
    ) {
      return;
    }

    this.snapshot = next;
    this.listeners.emit();
  }

  private assertNotDisposed() {
    if (this.disposed) {
      throw new Error("QueueScheduler has been disposed.");
    }
  }
}

export function createQueueScheduler<
  TPayload = unknown,
  TMetadata = unknown,
>(options: QueueSchedulerOptions<TPayload, TMetadata>) {
  return new QueueScheduler(options);
}

function waitForDispatch(
  dispatch: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });

    dispatch.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function createAbortError(): Error {
  const error = new Error("Queue dispatch was cancelled.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
