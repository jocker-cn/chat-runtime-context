import type { Message } from "@ag-ui/client";
import type {
  QueueDispatchContext,
  QueueDispatchTarget,
  QueueItem,
} from "../../queue";
import type {
  ChatMetadata,
  ChatRunOptions,
  ChatRuntime,
} from "../contracts/chat-runtime";

export interface CreateChatRuntimeQueueTargetOptions<
  TPayload,
  TInput,
  TQueueMetadata = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> {
  runtime: ChatRuntime<TInput, TMessage, TTurnMetadata, TBranchMetadata>;
  toInput(
    item: QueueItem<TPayload, TQueueMetadata>,
  ): TInput | Promise<TInput>;
  toRunOptions?(
    item: QueueItem<TPayload, TQueueMetadata>,
  ):
    | ChatRunOptions<TMessage>
    | undefined
    | Promise<ChatRunOptions<TMessage> | undefined>;
  errorPolicy?: "block" | "continue";
}

export function createChatRuntimeQueueTarget<
  TPayload,
  TInput,
  TQueueMetadata = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(
  options: CreateChatRuntimeQueueTargetOptions<
    TPayload,
    TInput,
    TQueueMetadata,
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >,
): QueueDispatchTarget<TPayload, TQueueMetadata> {
  const errorPolicy = options.errorPolicy ?? "block";
  const target: QueueDispatchTarget<TPayload, TQueueMetadata> = {
    subscribe: options.runtime.subscribe,
    getSnapshot: () => {
      const snapshot = options.runtime.getSnapshot();

      if (
        snapshot.status === "closed" ||
        (snapshot.status === "error" && errorPolicy === "block")
      ) {
        return { status: "blocked" };
      }

      if (snapshot.status === "running") {
        return { status: "running" };
      }

      return { status: "idle" };
    },
    dispatch: async (item, context: QueueDispatchContext) => {
      throwIfAborted(context.signal);
      const input = await options.toInput(item);
      throwIfAborted(context.signal);
      const runOptions = await options.toRunOptions?.(item);
      throwIfAborted(context.signal);

      await options.runtime.send(input, runOptions);
    },
  };

  return target;
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) {
    return;
  }

  const error = new Error("Queue dispatch was cancelled.");
  error.name = "AbortError";
  throw error;
}
