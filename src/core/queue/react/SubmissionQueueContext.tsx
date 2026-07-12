import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { QueueItem, SubmissionQueueSnapshot } from "../contracts";
import type { SubmissionQueue } from "../SubmissionQueue";

type AnySubmissionQueue = SubmissionQueue<unknown, unknown>;

const SubmissionQueueContext = createContext<
  AnySubmissionQueue | undefined
>(undefined);

export interface SubmissionQueueProviderProps<
  TPayload = unknown,
  TMetadata = unknown,
> {
  queue: SubmissionQueue<TPayload, TMetadata>;
  children: ReactNode;
}

export function SubmissionQueueProvider<
  TPayload = unknown,
  TMetadata = unknown,
>({
  queue,
  children,
}: SubmissionQueueProviderProps<TPayload, TMetadata>) {
  return (
    <SubmissionQueueContext.Provider value={queue as AnySubmissionQueue}>
      {children}
    </SubmissionQueueContext.Provider>
  );
}

export function useSubmissionQueue<
  TPayload = unknown,
  TMetadata = unknown,
>(): SubmissionQueue<TPayload, TMetadata> {
  const queue = useContext(SubmissionQueueContext);
  if (!queue) {
    throw new Error(
      "Submission queue hooks must be used within SubmissionQueueProvider.",
    );
  }

  return queue as SubmissionQueue<TPayload, TMetadata>;
}

export function useSubmissionQueueSelector<
  TSelected,
  TPayload = unknown,
  TMetadata = unknown,
>(
  selector: (
    snapshot: SubmissionQueueSnapshot<TPayload, TMetadata>,
  ) => TSelected,
  equalityFn: (previous: TSelected, next: TSelected) => boolean = Object.is,
): TSelected {
  const queue = useSubmissionQueue<TPayload, TMetadata>();

  return useSyncExternalStoreWithSelector(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot,
    selector,
    equalityFn,
  );
}

export function useSubmissionQueueSnapshot<
  TPayload = unknown,
  TMetadata = unknown,
>(): SubmissionQueueSnapshot<TPayload, TMetadata> {
  return useSubmissionQueueSelector<
    SubmissionQueueSnapshot<TPayload, TMetadata>,
    TPayload,
    TMetadata
  >((snapshot) => snapshot);
}

export function useQueuedSubmissions<
  TPayload = unknown,
  TMetadata = unknown,
>(): readonly QueueItem<TPayload, TMetadata>[] {
  return useSubmissionQueueSelector<
    readonly QueueItem<TPayload, TMetadata>[],
    TPayload,
    TMetadata
  >((snapshot) => snapshot.items);
}
