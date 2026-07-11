import type { Message } from "@ag-ui/client";
import type { MessageGroup, MessageGroupContext } from "./types";

export function groupAdjacentMessages<
  TMessage extends Message = Message,
>(
  messages: readonly TMessage[],
  context: MessageGroupContext,
): readonly MessageGroup<TMessage>[] {
  const groups: Array<Omit<MessageGroup<TMessage>, "items"> & {
    items: TMessage[];
  }> = [];

  messages.forEach((message, index) => {
    const pairId = resolveMessagePairId(message, index, "response");
    const last = groups[groups.length - 1];

    if (last?.pairId === pairId) {
      last.items.push(message);
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
  fallbackPairId?: string,
): string {
  const record = message as Record<string, unknown>;
  const pairId = record.pairId ?? record.message_id;

  return typeof pairId === "string" && pairId.length > 0
    ? pairId
    : fallbackPairId ?? message.id ?? `message-${index}`;
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
