import type { Message } from "@ag-ui/client";
import type React from "react";
import { memo, useMemo } from "react";
import type { BranchRenderState } from "../context/ChatContext";
import type { ChatBranch, ChatMode } from "../contracts/chat-runtime";
import { groupAdjacentMessages } from "./messageGroups";
import type { FrameRenderer } from "./createFrameRenderer";
import { FrameListItem } from "./FrameListItem";
import { FrameSlot } from "./FrameSlot";
import type { MessageGroup, MessageRenderContext } from "./types";

interface FrameListViewProps<TMessage extends Message = Message> {
  branchId: string;
  branchIndex?: number;
  renderer: FrameRenderer<TMessage>;
  className?: string;
  frameClassName?: string;
  slotClassName?: string;
  empty?: React.ReactNode;
  state: BranchRenderState<TMessage>;
}

export function FrameListView<TMessage extends Message = Message>({
  branchId,
  branchIndex = 0,
  renderer,
  className,
  frameClassName,
  slotClassName,
  empty = null,
  state,
}: FrameListViewProps<TMessage>) {
  const { branch, messages, mode, selectedBranchId, threadId } = state;
  const groups: readonly MessageGroup<TMessage>[] = useMemo(
    () =>
      branch
        ? groupAdjacentMessages(messages, {
            threadId,
            turnId: branch.turnId,
            branchId,
          })
        : [],
    [branch?.turnId, branchId, messages, threadId],
  );

  if (!branch) {
    return empty;
  }

  return (
    <div className={className}>
      {groups.length === 0
        ? empty
        : groups.map((group, groupIndex) => (
            <FrameGroup
              key={group.id}
              branch={branch}
              branchIndex={branchIndex}
              frameClassName={frameClassName}
              group={group}
              groupIndex={groupIndex}
              mode={mode}
              renderer={renderer}
              selectedBranchId={selectedBranchId}
              slotClassName={slotClassName}
              threadId={threadId}
            />
          ))}
    </div>
  );
}

interface FrameGroupProps<TMessage extends Message = Message> {
  branch: ChatBranch<TMessage>;
  branchIndex: number;
  frameClassName?: string;
  group: MessageGroup<TMessage>;
  groupIndex: number;
  mode: ChatMode;
  renderer: FrameRenderer<TMessage>;
  selectedBranchId?: string;
  slotClassName?: string;
  threadId?: string;
}

function FrameGroup<TMessage extends Message = Message>({
  branch,
  branchIndex,
  frameClassName,
  group,
  groupIndex,
  mode,
  renderer,
  selectedBranchId,
  slotClassName,
  threadId,
}: FrameGroupProps<TMessage>) {
  const sharedContext = useMemo<FrameMessageContext>(
    () => ({
      threadId,
      turnId: group.turnId,
      branchId: group.branchId,
      branchLabel: branch.label,
      branchStatus: branch.status,
      branchMetadata: branch.metadata,
      sourceId: branch.sourceId,
      messageReader: branch.messageReader,
      selectedBranchId,
      isSelectedBranch: selectedBranchId === branch.id,
      groupId: group.id,
      entityId: group.id,
      groupIndex,
      branchIndex,
      mode,
    }),
    [
      branch.id,
      branch.label,
      branch.messageReader,
      branch.metadata,
      branch.sourceId,
      branch.status,
      branchIndex,
      group.branchId,
      group.id,
      group.turnId,
      groupIndex,
      mode,
      selectedBranchId,
      threadId,
    ],
  );

  return (
    <FrameListItem
      frameId={group.id}
      className={frameClassName}
    >
      <FrameSlot frameId={group.id} className={slotClassName}>
        {group.items.map((message, offset) => {
          return (
            <FrameMessage
              key={message.id}
              message={message}
              messageIndex={group.messageStartIndex + offset}
              renderer={renderer}
              sharedContext={sharedContext}
            />
          );
        })}
      </FrameSlot>
    </FrameListItem>
  );
}

type FrameMessageContext = Omit<MessageRenderContext, "messageIndex">;

interface FrameMessageProps<TMessage extends Message = Message> {
  message: TMessage;
  messageIndex: number;
  renderer: FrameRenderer<TMessage>;
  sharedContext: FrameMessageContext;
}

function FrameMessageComponent<TMessage extends Message = Message>({
  message,
  messageIndex,
  renderer,
  sharedContext,
}: FrameMessageProps<TMessage>) {
  const context = useMemo<MessageRenderContext>(
    () => ({
      ...sharedContext,
      messageIndex,
    }),
    [messageIndex, sharedContext],
  );
  const Card = renderer.getCard(message, context);

  return <Card message={message} context={context} />;
}

const FrameMessage = memo(FrameMessageComponent) as typeof FrameMessageComponent;
