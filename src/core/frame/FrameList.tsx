import type { Message } from "@ag-ui/client";
import type React from "react";
import { useMemo, useRef } from "react";
import type { BranchRenderState } from "../context/ChatContext";
import { useBranchRenderState } from "../context/ChatContext";
import type { ChatBranch, ChatMode } from "../contracts/chat-runtime";
import { groupAdjacentMessages } from "./messageGroups";
import type { FrameRenderer } from "./createFrameRenderer";
import type {
  FrameListAccessibilityApi,
  FrameListAccessibilityOptions,
} from "../react/accessibility/useFrameListAccessibility";
import { useFrameListAccessibility } from "../react/accessibility/useFrameListAccessibility";
import { FrameListItem } from "./FrameListItem";
import type { MessageGroup, MessageRenderContext } from "./types";

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

export function FrameList<TMessage extends Message = Message>(
  props: FrameListProps<TMessage>,
) {
  const state = useBranchRenderState<TMessage>(props.branchId);

  return <FrameListView {...props} state={state} />;
}

interface FrameListViewProps<TMessage extends Message = Message>
  extends FrameListProps<TMessage> {
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
  accessibility,
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
  const frameIds = useStableFrameIds(groups.map((group) => group.id));
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
            <FrameGroup
              key={group.id}
              accessibilityApi={accessibilityApi}
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
  accessibilityApi: FrameListAccessibilityApi;
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
  accessibilityApi,
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
  return (
    <FrameListItem
      frameId={group.id}
      className={frameClassName}
      enabled={accessibilityApi.enabled}
      active={accessibilityApi.activeFrameId === group.id}
      registerFrame={accessibilityApi.registerFrame}
      onExitFrame={accessibilityApi.onExitFrame}
      onFrameFocus={accessibilityApi.onFrameFocus}
      onFrameKeyDown={accessibilityApi.onFrameKeyDown}
    >
      <div className={slotClassName} data-frame-slot-id={group.id}>
        {group.items.map((message, offset) => {
          const context: MessageRenderContext = {
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
            messageIndex: group.messageStartIndex + offset,
            groupIndex,
            branchIndex,
            mode,
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
      </div>
    </FrameListItem>
  );
}

function useStableFrameIds(frameIds: string[]): readonly string[] {
  const frameIdsRef = useRef<string[]>([]);

  if (!areStringArraysEqual(frameIdsRef.current, frameIds)) {
    frameIdsRef.current = frameIds;
  }

  return frameIdsRef.current;
}

function areStringArraysEqual(
  previous: readonly string[],
  next: readonly string[],
) {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;

  return previous.every((value, index) => value === next[index]);
}
