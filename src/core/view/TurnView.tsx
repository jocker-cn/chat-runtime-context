import type { Message } from "@ag-ui/client";
import type React from "react";
import { useChatSnapshot, useChatTurn } from "../context/ChatContext";
import type { FrameCardProps, FrameRenderer } from "../frame/createFrameRenderer";
import type { MessageRenderContext } from "../frame/types";
import { BranchView } from "./BranchView";

export type TurnInputRenderer<TMessage extends Message = Message> = (
  props: FrameCardProps<TMessage>,
) => React.ReactNode;

export interface TurnViewProps<TMessage extends Message = Message> {
  turnId: string;
  renderer: FrameRenderer<TMessage>;
  renderInput?: TurnInputRenderer<TMessage>;
  className?: string;
  inputClassName?: string;
  branchesClassName?: string;
  branchClassName?: string;
  frameListClassName?: string;
  frameClassName?: string;
  slotClassName?: string;
  showOnlySelectedBranch?: boolean;
}

export function TurnView<TMessage extends Message = Message>({
  turnId,
  renderer,
  renderInput,
  className,
  inputClassName,
  branchesClassName,
  branchClassName,
  frameListClassName,
  frameClassName,
  slotClassName,
  showOnlySelectedBranch = true,
}: TurnViewProps<TMessage>) {
  const snapshot = useChatSnapshot<unknown, TMessage>();
  const turn = useChatTurn<TMessage>(turnId);

  if (!turn) {
    return null;
  }

  const inputContext: MessageRenderContext = {
    threadId: snapshot.threadId,
    turnId,
    branchId: "__input",
    selectedBranchId: turn.selectedBranchId,
    isSelectedBranch: false,
    groupId: `${turnId}:input`,
    entityId: `${turnId}:input`,
    messageIndex: -1,
    groupIndex: -1,
    branchIndex: -1,
    mode: snapshot.mode,
  };
  const branchEntries = turn.branchIds
    .map((branchId, branchIndex) => ({
      branchId,
      branchIndex,
    }))
    .filter(
      ({ branchId }) =>
        !showOnlySelectedBranch ||
        !turn.selectedBranchId ||
        turn.selectedBranchId === branchId,
    );

  return (
    <article className={className} data-turn-id={turn.id}>
      {turn.inputMessage && renderInput && (
        <div className={inputClassName}>
          {renderInput({
            message: turn.inputMessage,
            context: inputContext,
          })}
        </div>
      )}
      <div className={branchesClassName}>
        {branchEntries.map(({ branchId, branchIndex }) => (
          <BranchView
            key={branchId}
            branchId={branchId}
            branchIndex={branchIndex}
            renderer={renderer}
            className={branchClassName}
            frameListClassName={frameListClassName}
            frameClassName={frameClassName}
            slotClassName={slotClassName}
          />
        ))}
      </div>
    </article>
  );
}
