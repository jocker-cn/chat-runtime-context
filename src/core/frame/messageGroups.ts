import type { Message } from "@ag-ui/client";
import type { MessageGroup, MessageGroupContext } from "./types";

export function groupAdjacentMessages<
  TMessage extends Message = Message,
>(
  messages: readonly TMessage[],
  context: MessageGroupContext,
): readonly MessageGroup<TMessage>[] {
  if (messages.length === 0) {
    return [];
  }

  const pairId = "response";

  return [{
    id: createGroupId(context, pairId),
    pairId,
    turnId: context.turnId,
    branchId: context.branchId,
    messageStartIndex: 0,
    items: messages,
  }];
}

export function createGroupId(
  context: MessageGroupContext,
  pairId: string,
) {
  return [
    context.threadId,
    context.turnId,
    context.branchId,
    pairId,
  ]
    .filter(Boolean)
    .join(":");
}
