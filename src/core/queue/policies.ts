import type {
  QueueItem,
  QueueSelectionPolicy,
} from "./contracts";

export const fifoQueuePolicy: QueueSelectionPolicy = (items, { now }) =>
  items.find((item) => isDispatchable(item, now));

export const priorityQueuePolicy: QueueSelectionPolicy = (items, { now }) => {
  let selected: QueueItem | undefined;

  items.forEach((item) => {
    if (!isDispatchable(item, now)) {
      return;
    }

    if (
      !selected ||
      item.priority > selected.priority ||
      (item.priority === selected.priority &&
        item.sequence < selected.sequence)
    ) {
      selected = item;
    }
  });

  return selected;
};

export function createPriorityQueuePolicy<
  TPayload = unknown,
  TMetadata = unknown,
>(): QueueSelectionPolicy<TPayload, TMetadata> {
  return priorityQueuePolicy as QueueSelectionPolicy<TPayload, TMetadata>;
}

export function createFifoQueuePolicy<
  TPayload = unknown,
  TMetadata = unknown,
>(): QueueSelectionPolicy<TPayload, TMetadata> {
  return fifoQueuePolicy as QueueSelectionPolicy<TPayload, TMetadata>;
}

function isDispatchable<TPayload, TMetadata>(
  item: QueueItem<TPayload, TMetadata>,
  now: number,
) {
  return (
    item.status === "queued" &&
    (item.scheduledAt === undefined || item.scheduledAt <= now)
  );
}
