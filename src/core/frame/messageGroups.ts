import type { Message } from "@ag-ui/client";
import type { MessageGroup, MessageGroupContext } from "./types";

const emptyMessageGroups: readonly MessageGroup[] = [];

export function groupAdjacentMessages<
  TMessage extends Message = Message,
>(
  messages: readonly TMessage[],
  context: MessageGroupContext,
): readonly MessageGroup<TMessage>[] {
  if (messages.length === 0) {
    return emptyMessageGroups as readonly MessageGroup<TMessage>[];
  }

  return [{
    id: createGroupId(context),
    turnId: context.turnId,
    branchId: context.branchId,
    messageStartIndex: 0,
    items: messages,
  }];
}

export function createGroupId(
  context: MessageGroupContext,
) {
  return [
    context.threadId,
    context.turnId,
    context.branchId,
    "response",
  ]
    .filter(Boolean)
    .join(":");
}
