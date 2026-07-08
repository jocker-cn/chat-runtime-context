import type { Message } from "@ag-ui/client";
import { useBranchMessages, useChatBranch } from "../context/ChatContext";
import { FrameList } from "../frame/FrameList";
import type { FrameRenderer } from "../frame/createFrameRenderer";
import type { FrameListAccessibilityOptions } from "../frame/useFrameListAccessibility";

export interface BranchViewProps<TMessage extends Message = Message> {
  branchId: string;
  branchIndex: number;
  renderer: FrameRenderer<TMessage>;
  className?: string;
  frameListClassName?: string;
  frameClassName?: string;
  slotClassName?: string;
  accessibility?: FrameListAccessibilityOptions;
}

export function BranchView<TMessage extends Message = Message>({
  branchId,
  branchIndex,
  renderer,
  className,
  frameListClassName,
  frameClassName,
  slotClassName,
  accessibility,
}: BranchViewProps<TMessage>) {
  const branch = useChatBranch<TMessage>(branchId);
  const messages = useBranchMessages<TMessage>(branchId);

  if (!branch || messages.length === 0) {
    return null;
  }

  return (
    <section
      className={className}
      data-branch-id={branch.id}
      data-source-id={branch.sourceId}
    >
      <FrameList
        branchId={branch.id}
        branchIndex={branchIndex}
        renderer={renderer}
        className={frameListClassName}
        frameClassName={frameClassName}
        slotClassName={slotClassName}
        accessibility={accessibility}
      />
    </section>
  );
}
