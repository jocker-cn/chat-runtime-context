import { ListenerSet } from "../internal/ListenerSet";
import type {
  QueueEnqueueEntry,
  QueueEnqueueOptions,
  QueueItem,
  QueueItemPredicate,
  QueueItemUpdate,
  QueueReleaseOptions,
  QueueRetryOptions,
  SubmissionQueueOptions,
  SubmissionQueueSnapshot,
} from "./contracts";

export class SubmissionQueue<
  TPayload = unknown,
  TMetadata = unknown,
> {
  private readonly listeners = new ListenerSet();
  private readonly itemsById = new Map<
    string,
    QueueItem<TPayload, TMetadata>
  >();
  private readonly createId: () => string;
  private readonly now: () => number;
  private nextSequence = 0;
  private snapshot: SubmissionQueueSnapshot<TPayload, TMetadata> = {
    version: 0,
    items: [],
    size: 0,
  };

  constructor(options: SubmissionQueueOptions = {}) {
    this.createId = options.createId ?? createDefaultQueueItemId;
    this.now = options.now ?? Date.now;
  }

  public readonly subscribe = (listener: () => void): (() => void) =>
    this.listeners.add(listener);

  public readonly getSnapshot = (): SubmissionQueueSnapshot<
    TPayload,
    TMetadata
  > => this.snapshot;

  public get size(): number {
    return this.snapshot.size;
  }

  public enqueue(
    payload: TPayload,
    options: QueueEnqueueOptions<TMetadata> = {},
  ): QueueItem<TPayload, TMetadata> {
    const item = this.createQueueItem(payload, options);
    this.assertIdsAvailable([item.id]);
    this.itemsById.set(item.id, item);
    this.publish();
    return item;
  }

  public enqueueMany(
    entries: readonly QueueEnqueueEntry<TPayload, TMetadata>[],
  ): readonly QueueItem<TPayload, TMetadata>[] {
    if (entries.length === 0) {
      return [];
    }

    const items = entries.map(({ payload, options }) =>
      this.createQueueItem(payload, options),
    );
    this.assertIdsAvailable(items.map((item) => item.id));
    items.forEach((item) => this.itemsById.set(item.id, item));
    this.publish();
    return items;
  }

  public get(id: string): QueueItem<TPayload, TMetadata> | undefined {
    return this.itemsById.get(id);
  }

  public has(id: string): boolean {
    return this.itemsById.has(id);
  }

  public list(
    predicate?: QueueItemPredicate<TPayload, TMetadata>,
  ): readonly QueueItem<TPayload, TMetadata>[] {
    return predicate
      ? this.snapshot.items.filter(predicate)
      : this.snapshot.items;
  }

  public peek(): QueueItem<TPayload, TMetadata> | undefined {
    return this.snapshot.items.find((item) => item.status === "queued");
  }

  public dequeue(): QueueItem<TPayload, TMetadata> | undefined {
    const item = this.peek();
    return item ? this.take(item.id) : undefined;
  }

  public take(id: string): QueueItem<TPayload, TMetadata> | undefined {
    const item = this.itemsById.get(id);
    if (!item || item.status === "dispatching") {
      return undefined;
    }

    this.itemsById.delete(id);
    this.publish();
    return item;
  }

  public remove(id: string): boolean {
    return this.take(id) !== undefined;
  }

  public update(
    id: string,
    update:
      | QueueItemUpdate<TPayload, TMetadata>
      | ((
          item: QueueItem<TPayload, TMetadata>,
        ) => QueueItemUpdate<TPayload, TMetadata>),
  ): QueueItem<TPayload, TMetadata> | undefined {
    const item = this.itemsById.get(id);
    if (!item || item.status === "dispatching") {
      return undefined;
    }

    const patch = typeof update === "function" ? update(item) : update;
    const nextItem = applyItemUpdate(item, patch);
    if (nextItem === item) {
      return item;
    }

    this.itemsById.set(id, nextItem);
    this.publish();
    return nextItem;
  }

  public reprioritize(
    id: string,
    priority: number,
  ): QueueItem<TPayload, TMetadata> | undefined {
    return this.update(id, { priority });
  }

  public claim(id: string): QueueItem<TPayload, TMetadata> | undefined {
    const item = this.itemsById.get(id);
    if (!item || item.status !== "queued") {
      return undefined;
    }

    const claimed = {
      ...item,
      status: "dispatching" as const,
      attempts: item.attempts + 1,
      revision: item.revision + 1,
      lastError: undefined,
    };
    this.itemsById.set(id, claimed);
    this.publish();
    return claimed;
  }

  public ack(id: string): QueueItem<TPayload, TMetadata> | undefined {
    const item = this.itemsById.get(id);
    if (!item || item.status !== "dispatching") {
      return undefined;
    }

    this.itemsById.delete(id);
    this.publish();
    return item;
  }

  public release(
    id: string,
    options: QueueReleaseOptions = {},
  ): QueueItem<TPayload, TMetadata> | undefined {
    const item = this.itemsById.get(id);
    if (!item || item.status !== "dispatching") {
      return undefined;
    }

    const released = {
      ...item,
      status: "queued" as const,
      scheduledAt: options.scheduledAt ?? item.scheduledAt,
      revision: item.revision + 1,
      lastError: options.error,
    };
    this.itemsById.set(id, released);
    this.publish();
    return released;
  }

  public fail(
    id: string,
    error: unknown,
  ): QueueItem<TPayload, TMetadata> | undefined {
    const item = this.itemsById.get(id);
    if (!item || item.status !== "dispatching") {
      return undefined;
    }

    const failed = {
      ...item,
      status: "failed" as const,
      revision: item.revision + 1,
      lastError: error,
    };
    this.itemsById.set(id, failed);
    this.publish();
    return failed;
  }

  public retry(
    id: string,
    options: QueueRetryOptions = {},
  ): QueueItem<TPayload, TMetadata> | undefined {
    const item = this.itemsById.get(id);
    if (!item || item.status !== "failed") {
      return undefined;
    }

    const retried = {
      ...item,
      status: "queued" as const,
      scheduledAt: options.scheduledAt ?? item.scheduledAt,
      revision: item.revision + 1,
      lastError: undefined,
    };
    this.itemsById.set(id, retried);
    this.publish();
    return retried;
  }

  public clear(
    predicate?: QueueItemPredicate<TPayload, TMetadata>,
  ): readonly QueueItem<TPayload, TMetadata>[] {
    const removed = this.snapshot.items.filter(
      (item) =>
        item.status !== "dispatching" && (!predicate || predicate(item)),
    );
    if (removed.length === 0) {
      return [];
    }

    removed.forEach((item) => this.itemsById.delete(item.id));
    this.publish();
    return removed;
  }

  private createQueueItem(
    payload: TPayload,
    options: QueueEnqueueOptions<TMetadata> = {},
  ): QueueItem<TPayload, TMetadata> {
    const id = options.id ?? this.createId();
    assertQueueItemId(id);
    assertFiniteNumber(options.priority ?? 0, "priority");
    if (options.scheduledAt !== undefined) {
      assertFiniteNumber(options.scheduledAt, "scheduledAt");
    }

    return {
      id,
      payload,
      metadata: options.metadata,
      priority: options.priority ?? 0,
      sequence: this.nextSequence++,
      createdAt: this.now(),
      scheduledAt: options.scheduledAt,
      status: "queued",
      attempts: 0,
      revision: 0,
      lastError: undefined,
    };
  }

  private assertIdsAvailable(ids: readonly string[]) {
    const nextIds = new Set<string>();
    ids.forEach((id) => {
      if (this.itemsById.has(id) || nextIds.has(id)) {
        throw new Error(`Queue item "${id}" already exists.`);
      }
      nextIds.add(id);
    });
  }

  private publish() {
    const items = [...this.itemsById.values()].sort(
      (left, right) => left.sequence - right.sequence,
    );
    this.snapshot = {
      version: this.snapshot.version + 1,
      items,
      size: items.length,
    };
    this.listeners.emit();
  }
}

export function createSubmissionQueue<
  TPayload = unknown,
  TMetadata = unknown,
>(options: SubmissionQueueOptions = {}) {
  return new SubmissionQueue<TPayload, TMetadata>(options);
}

function applyItemUpdate<TPayload, TMetadata>(
  item: QueueItem<TPayload, TMetadata>,
  update: QueueItemUpdate<TPayload, TMetadata>,
): QueueItem<TPayload, TMetadata> {
  if (update.priority !== undefined) {
    assertFiniteNumber(update.priority, "priority");
  }
  if (update.scheduledAt !== undefined && update.scheduledAt !== null) {
    assertFiniteNumber(update.scheduledAt, "scheduledAt");
  }

  const hasPayload = Object.prototype.hasOwnProperty.call(update, "payload");
  const hasMetadata = Object.prototype.hasOwnProperty.call(update, "metadata");
  const hasScheduledAt = Object.prototype.hasOwnProperty.call(
    update,
    "scheduledAt",
  );
  const payload = hasPayload ? (update.payload as TPayload) : item.payload;
  const metadata = hasMetadata ? update.metadata : item.metadata;
  const priority = update.priority ?? item.priority;
  const scheduledAt = hasScheduledAt
    ? update.scheduledAt ?? undefined
    : item.scheduledAt;

  if (
    Object.is(payload, item.payload) &&
    Object.is(metadata, item.metadata) &&
    priority === item.priority &&
    scheduledAt === item.scheduledAt
  ) {
    return item;
  }

  return {
    ...item,
    payload,
    metadata,
    priority,
    scheduledAt,
    revision: item.revision + 1,
  };
}

function assertQueueItemId(id: string) {
  if (id.trim().length === 0) {
    throw new Error("Queue item id must not be empty.");
  }
}

function assertFiniteNumber(value: number, name: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`Queue item ${name} must be a finite number.`);
  }
}

function createDefaultQueueItemId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `submission-${crypto.randomUUID()}`;
  }

  return `submission-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
