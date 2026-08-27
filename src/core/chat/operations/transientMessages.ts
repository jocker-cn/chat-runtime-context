import type { Message } from "@ag-ui/client";
import type { ChatMetadata } from "../contracts/chat-runtime";
import type { CompareChatRuntime } from "../runtime/CompareChatRuntime";

export interface TransientMessageCleanupPolicy<
  TMessage extends Message = Message,
> {
  shouldRemoveInput?: (
    message: TMessage,
    context: { turnId: string },
  ) => boolean;
  shouldRemoveResponse?: (
    tailMessage: TMessage,
    context: { turnId: string; branchId: string },
  ) => boolean;
}

/**
 * Clears matching transient messages from the timeline tail. It only inspects
 * the Turn input and each Branch's raw final response message. A matched
 * response is removed as one unit, including preceding Reasoning and Tool
 * messages owned by that Branch.
 */
export async function clearTransientMessages<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
  TSourceMetadata extends ChatMetadata = ChatMetadata,
>(
  runtime: CompareChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata,
    TSourceMetadata
  >,
  policy: TransientMessageCleanupPolicy<TMessage>,
): Promise<void> {
  while (true) {
    const snapshot = runtime.getSnapshot();
    const turnId = snapshot.turnIds.at(-1);
    if (!turnId) return;

    const turn = snapshot.turnsById[turnId];
    if (!turn) return;

    // Input is optional. AI-only Turns continue to response cleanup below.
    if (
      turn.inputMessage &&
      policy.shouldRemoveInput?.(turn.inputMessage, { turnId })
    ) {
      await runtime.removeTurnInput(turnId);
      if (!runtime.getSnapshot().turnsById[turnId]) {
        continue;
      }
    }

    if (!policy.shouldRemoveResponse) return;

    const currentTurn = runtime.getSnapshot().turnsById[turnId];
    if (!currentTurn) continue;

    for (const branchId of currentTurn.branchIds) {
      const tailMessage = runtime.getBranchResponseTailMessage(
        turnId,
        branchId,
      );
      if (
        !tailMessage ||
        !policy.shouldRemoveResponse(tailMessage, {
          turnId,
          branchId,
        })
      ) {
        continue;
      }

      await runtime.removeBranchResponse(turnId, branchId);
      if (!runtime.getSnapshot().turnsById[turnId]) break;
    }

    if (!runtime.getSnapshot().turnsById[turnId]) {
      continue;
    }

    return;
  }
}
