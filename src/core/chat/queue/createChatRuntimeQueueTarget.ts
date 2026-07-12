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
  steer?(
    item: QueueItem<TPayload, TQueueMetadata>,
    context: QueueDispatchContext,
  ): Promise<void> | void;
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
  const target: QueueDispatchTarget<TPayload, TQueueMetadata> = {
    subscribe: options.runtime.subscribe,
    getSnapshot: () => {
      const snapshot = options.runtime.getSnapshot();

      if (snapshot.status === "closed") {
        return { status: "blocked" };
      }

      if (snapshot.status === "running") {
        return {
          status: "running",
          activeExecutionId: snapshot.activeTurnId,
        };
      }

      return { status: "idle" };
    },
    start: async (item) => {
      const input = await options.toInput(item);
      const runOptions = await options.toRunOptions?.(item);

      await options.runtime.send(input, runOptions);
    },
  };

  if (options.steer) {
    target.steer = async (item, context) => {
      await options.steer?.(item, context);
    };
  }

  return target;
}
