import type { Message } from "@ag-ui/client";
import type React from "react";
import { useBranchMessages, useChatBranch, useChatSnapshot } from "../context/ChatContext";
import { groupAdjacentMessages } from "./messageGroups";
import type { FrameRenderer } from "./createFrameRenderer";
import type { FrameListAccessibilityOptions } from "./useFrameListAccessibility";
import { useFrameListAccessibility } from "./useFrameListAccessibility";
import { FrameListItem } from "./FrameListItem";
import { FrameSlot } from "./FrameSlot";
import type { MessageRenderContext } from "./types";

export interface FrameListProps<TMessage extends Message = Message> {
  branchId: string;
  branchIndex?: number;
  renderer: FrameRenderer<TMessage>;
  className?: string;
  frameClassName?: string;
  slotClassName?: string;
  empty?: React.ReactNode;
  accessibility?: FrameListAccessibilityOptions;
}

export function FrameList<TMessage extends Message = Message>({
  branchId,
  branchIndex = 0,
  renderer,
  className,
  frameClassName,
  slotClassName,
  empty = null,
  accessibility,
}: FrameListProps<TMessage>) {
  const snapshot = useChatSnapshot<unknown, TMessage>();
  const branch = useChatBranch<TMessage>(branchId);
  const messages = useBranchMessages<TMessage>(branchId);
  const turn = branch ? snapshot.turnsById[branch.turnId] : undefined;
  const groups = branch
    ? groupAdjacentMessages(messages, {
    threadId: snapshot.threadId,
    turnId: branch.turnId,
    branchId,
      })
    : [];
  const frameIds = groups.map((group) => group.id);
  const accessibilityApi = useFrameListAccessibility({
    accessibility,
    frameIds,
  });

  if (!branch) {
    return empty;
  }

  return (
    <div className={className} {...accessibilityApi.listProps}>
      {groups.length === 0
        ? empty
        : groups.map((group, groupIndex) => (
            <FrameListItem
              key={group.id}
              frameId={group.id}
              className={frameClassName}
              enabled={accessibilityApi.enabled}
              active={accessibilityApi.activeFrameId === group.id}
              frameRole={accessibilityApi.frameRole}
              registerFrame={accessibilityApi.registerFrame}
              onExitFrame={accessibilityApi.onExitFrame}
              onFrameFocus={accessibilityApi.onFrameFocus}
              onFrameKeyDown={accessibilityApi.onFrameKeyDown}
            >
              <FrameSlot frameId={group.id} className={slotClassName}>
                {group.items.map((message, offset) => {
                  const context: MessageRenderContext = {
                    threadId: snapshot.threadId,
                    turnId: group.turnId,
                    branchId: group.branchId,
                    branchLabel: branch.label,
                    branchStatus: branch.status,
                    branchMetadata: branch.metadata,
                    sourceId: branch.sourceId,
                    messageReader: branch.messageReader,
                    selectedBranchId: turn?.selectedBranchId,
                    isSelectedBranch: turn?.selectedBranchId === branch.id,
                    groupId: group.id,
                    entityId: group.id,
                    messageIndex: group.messageStartIndex + offset,
                    groupIndex,
                    branchIndex,
                    mode: snapshot.mode,
                  };
                  const Card = renderer.getCard(message, context);

                  return (
                    <Card
                      key={`${group.id}:${message.id}:${offset}`}
                      message={message}
                      context={context}
                    />
                  );
                })}
              </FrameSlot>
            </FrameListItem>
          ))}
    </div>
  );
}
