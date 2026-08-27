import type { Message } from "@ag-ui/client";
import type {
  ChatMetadata,
  ChatRuntime,
} from "../contracts/chat-runtime";

/** Removes the last settled Turn and all of its Source messages. */
export async function removeLastTurn<
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
): Promise<void> {
  const turnId = runtime.getSnapshot().turnIds.at(-1);
  if (!turnId) return;

  await runtime.removeTurn(turnId);
}
