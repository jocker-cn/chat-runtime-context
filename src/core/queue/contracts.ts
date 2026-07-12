export type QueueItemStatus = "queued" | "dispatching" | "failed";

export interface QueueItem<
  TPayload = unknown,
  TMetadata = unknown,
> {
  readonly id: string;
  readonly payload: TPayload;
  readonly metadata?: TMetadata;
  readonly priority: number;
  readonly sequence: number;
  readonly createdAt: number;
  readonly scheduledAt?: number;
  readonly status: QueueItemStatus;
  readonly attempts: number;
  readonly revision: number;
  readonly lastError?: unknown;
}

export interface QueueEnqueueOptions<TMetadata = unknown> {
  id?: string;
  metadata?: TMetadata;
  priority?: number;
  scheduledAt?: number;
}

export interface QueueEnqueueEntry<
  TPayload = unknown,
  TMetadata = unknown,
> {
  payload: TPayload;
  options?: QueueEnqueueOptions<TMetadata>;
}

export interface QueueItemUpdate<
  TPayload = unknown,
  TMetadata = unknown,
> {
  payload?: TPayload;
  metadata?: TMetadata;
  priority?: number;
  scheduledAt?: number | null;
}

export interface SubmissionQueueSnapshot<
  TPayload = unknown,
  TMetadata = unknown,
> {
  readonly version: number;
  readonly items: readonly QueueItem<TPayload, TMetadata>[];
  readonly size: number;
}

export interface SubmissionQueueOptions {
  createId?: () => string;
  now?: () => number;
}

export type QueueItemPredicate<
  TPayload = unknown,
  TMetadata = unknown,
> = (item: QueueItem<TPayload, TMetadata>) => boolean;

export interface QueueReleaseOptions {
  error?: unknown;
  scheduledAt?: number;
}

export interface QueueRetryOptions {
  scheduledAt?: number;
}

export interface QueueSelectionContext {
  now: number;
}

export type QueueSelectionPolicy<
  TPayload = unknown,
  TMetadata = unknown,
> = (
  items: readonly QueueItem<TPayload, TMetadata>[],
  context: QueueSelectionContext,
) => QueueItem<TPayload, TMetadata> | undefined;

export type DispatchTargetStatus = "idle" | "running" | "blocked";

export interface DispatchTargetSnapshot {
  readonly status: DispatchTargetStatus;
  readonly activeExecutionId?: string;
}

export interface QueueDispatchContext {
  readonly activeExecutionId?: string;
}

export interface QueueDispatchTarget<
  TPayload = unknown,
  TMetadata = unknown,
> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DispatchTargetSnapshot;
  start(item: QueueItem<TPayload, TMetadata>): Promise<void>;
  steer?(
    item: QueueItem<TPayload, TMetadata>,
    context: QueueDispatchContext,
  ): Promise<void>;
}

export type QueueDispatchMode = "start" | "steer";

export type QueueFailureDisposition = "fail" | "requeue";

export interface QueueDispatchFailureContext<
  TPayload = unknown,
  TMetadata = unknown,
> {
  readonly error: unknown;
  readonly item: QueueItem<TPayload, TMetadata>;
  readonly mode: QueueDispatchMode;
}

export type QueueDispatchFailureResolver<
  TPayload = unknown,
  TMetadata = unknown,
> = (
  context: QueueDispatchFailureContext<TPayload, TMetadata>,
) => QueueFailureDisposition;

export type DispatchNowMode = "auto" | QueueDispatchMode;

export interface DispatchNowOptions {
  mode?: DispatchNowMode;
}

export type QueueDispatchResult =
  | {
      status: "dispatched";
      itemId: string;
      mode: QueueDispatchMode;
    }
  | {
      status: "failed";
      itemId: string;
      mode: QueueDispatchMode;
      disposition: QueueFailureDisposition;
      error: unknown;
    }
  | {
      status: "not-found" | "busy" | "blocked" | "unsupported";
      itemId: string;
    };

export type QueueSchedulerStatus =
  | "idle"
  | "paused"
  | "dispatching"
  | "disposed";

export interface QueueSchedulerSnapshot {
  readonly status: QueueSchedulerStatus;
  readonly dispatchingItemId?: string;
  readonly lastError?: unknown;
}
