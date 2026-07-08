import type { Message } from "@ag-ui/client";
import type { MessageGroup, MessageGroupContext } from "./types";

export function groupAdjacentMessages<
  TMessage extends Message = Message,
>(
  messages: readonly TMessage[],
  context: MessageGroupContext,
): readonly MessageGroup<TMessage>[] {
  const groups: MessageGroup<TMessage>[] = [];

  messages.forEach((message, index) => {
    const pairId = resolveMessagePairId(message, index);
    const last = groups[groups.length - 1];

    if (last?.pairId === pairId) {
      groups[groups.length - 1] = {
        ...last,
        items: [...last.items, message],
      };
      return;
    }

    groups.push({
      id: createGroupId(context, pairId),
      pairId,
      turnId: context.turnId,
      branchId: context.branchId,
      messageStartIndex: index,
      items: [message],
    });
  });

  return groups;
}

export function resolveMessagePairId(
  message: Message,
  index: number,
): string {
  const record = message as Record<string, unknown>;
  const pairId = record.pairId ?? record.message_id ?? message.id;

  return typeof pairId === "string" && pairId.length > 0
    ? pairId
    : `message-${index}`;
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
