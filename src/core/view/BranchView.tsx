import type { Message } from "@ag-ui/client";
import { memo } from "react";
import { useBranchRenderState } from "../context/ChatContext";
import { FrameListView } from "../frame/FrameListView";
import type { FrameRenderer } from "../frame/createFrameRenderer";

export interface BranchViewProps<TMessage extends Message = Message> {
  branchId: string;
  branchIndex: number;
  renderer: FrameRenderer<TMessage>;
  className?: string;
  frameListClassName?: string;
  frameClassName?: string;
  slotClassName?: string;
}

function BranchViewComponent<TMessage extends Message = Message>({
  branchId,
  branchIndex,
  renderer,
  className,
  frameListClassName,
  frameClassName,
  slotClassName,
}: BranchViewProps<TMessage>) {
  const state = useBranchRenderState<TMessage>(branchId);
  const { branch, messages } = state;

  if (!branch || messages.length === 0) {
    return null;
  }

  return (
    <section
      className={className}
      data-branch-id={branch.id}
      data-source-id={branch.sourceId}
    >
      <FrameListView
        branchId={branch.id}
        branchIndex={branchIndex}
        renderer={renderer}
        className={frameListClassName}
        frameClassName={frameClassName}
        slotClassName={slotClassName}
        state={state}
      />
    </section>
  );
}

export const BranchView = memo(
  BranchViewComponent,
) as typeof BranchViewComponent;
