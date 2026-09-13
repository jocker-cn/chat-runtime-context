import type { Message } from "@ag-ui/client";
import type {
  ChatMetadata,
  ChatRuntime,
} from "../contracts/chat-runtime";

/** Finds one already-loaded Message without adding storage to the Runtime. */
export function findChatMessageById<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(
  runtime: ChatRuntime<
    TInput,
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >,
  messageId: string,
): TMessage | undefined {
  const snapshot = runtime.getSnapshot();

  for (const turnId of snapshot.turnIds) {
    const turn = snapshot.turnsById[turnId];
    if (turn?.inputMessage?.id === messageId) {
      return turn.inputMessage;
    }

    for (const branchId of turn?.branchIds ?? []) {
      const message = snapshot.branchesById[branchId]?.messageReader
        .getMessages()
        .find((candidate) => candidate.id === messageId);
      if (message) {
        return message;
      }
    }
  }

  return undefined;
}
