import { ListenerSet } from "../internal/ListenerSet";
import type {
  DispatchNowOptions,
  QueueDispatchFailureResolver,
  QueueDispatchMode,
  QueueDispatchResult,
  QueueDispatchTarget,
  QueueFailureDisposition,
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
  resolveFailure?: QueueDispatchFailureResolver<TPayload, TMetadata>;
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
  private readonly resolveFailure: QueueDispatchFailureResolver<
    TPayload,
    TMetadata
  >;
  private readonly now: () => number;
  private unsubscribeQueue?: () => void;
  private unsubscribeTarget?: () => void;
  private wakeTimer?: ReturnType<typeof setTimeout>;
  private started = false;
  private paused = false;
  private disposed = false;
  private pumpScheduled = false;
  private dispatchingItemId?: string;
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
    this.resolveFailure = options.resolveFailure ?? defaultFailureResolver;
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
      status: this.dispatchingItemId ? "dispatching" : "idle",
      dispatchingItemId: this.dispatchingItemId,
      lastError: this.snapshot.lastError,
    });
    this.schedulePump();
  }

  public async dispatchNow(
    itemId: string,
    options: DispatchNowOptions = {},
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
    const requestedMode = options.mode ?? "auto";

    if (requestedMode === "start" || requestedMode === "auto") {
      if (targetSnapshot.status === "idle") {
        return this.dispatch(item, "start");
      }
      if (requestedMode === "start") {
        return {
          status:
            targetSnapshot.status === "blocked" ? "blocked" : "busy",
          itemId,
        };
      }
    }

    if (targetSnapshot.status === "blocked") {
      return { status: "blocked", itemId };
    }
    if (targetSnapshot.status !== "running" || !this.target.steer) {
      return { status: "unsupported", itemId };
    }

    return this.dispatch(item, "steer");
  }

  public dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.started = false;
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
    if (targetSnapshot.status !== "idle") {
      this.clearWakeTimer();
      return;
    }

    const queueSnapshot = this.queue.getSnapshot();
    const now = this.now();
    const next = this.selectNext(queueSnapshot.items, { now });
    if (!next) {
      this.scheduleNextWake(queueSnapshot.items, now);
      return;
    }

    this.clearWakeTimer();
    void this.dispatch(next, "start");
  }

  private async dispatch(
    item: QueueItem<TPayload, TMetadata>,
    mode: QueueDispatchMode,
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

    this.updateSnapshot({
      status: "dispatching",
      dispatchingItemId: claimed.id,
      lastError: undefined,
    });

    try {
      if (mode === "steer") {
        const steer = this.target.steer;
        if (!steer) {
          this.queue.release(claimed.id);
          return { status: "unsupported", itemId: claimed.id };
        }
        await steer(claimed, {
          activeExecutionId: this.target.getSnapshot().activeExecutionId,
        });
      } else {
        await this.target.start(claimed);
      }

      this.queue.ack(claimed.id);
      return {
        status: "dispatched",
        itemId: claimed.id,
        mode,
      };
    } catch (error) {
      const disposition = this.resolveFailure({ error, item: claimed, mode });
      this.applyFailureDisposition(claimed.id, error, disposition);
      this.updateSnapshot({
        status: "dispatching",
        dispatchingItemId: claimed.id,
        lastError: error,
      });
      return {
        status: "failed",
        itemId: claimed.id,
        mode,
        disposition,
        error,
      };
    } finally {
      this.dispatchingItemId = undefined;
      if (!this.disposed) {
        this.updateSnapshot({
          status: this.paused ? "paused" : "idle",
          dispatchingItemId: undefined,
          lastError: this.snapshot.lastError,
        });
        this.schedulePump();
      }
    }
  }

  private applyFailureDisposition(
    itemId: string,
    error: unknown,
    disposition: QueueFailureDisposition,
  ) {
    if (disposition === "requeue") {
      this.queue.release(itemId, { error });
      return;
    }

    this.queue.fail(itemId, error);
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

function defaultFailureResolver({
  mode,
}: {
  mode: QueueDispatchMode;
}): QueueFailureDisposition {
  return mode === "steer" ? "requeue" : "fail";
}
