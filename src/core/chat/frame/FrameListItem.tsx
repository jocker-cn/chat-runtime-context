import { memo } from "react";
import type React from "react";
import { RuntimeFocusGroup } from "../../react/accessibility/RuntimeFocusController";

interface FrameListItemProps {
  frameId: string;
  className?: string;
  children: React.ReactNode;
}

function FrameListItemComponent({
  frameId,
  className,
  children,
}: FrameListItemProps) {
  return (
    <RuntimeFocusGroup
      groupId={frameId}
      className={className}
      data-frame-id={frameId}
    >
      {children}
    </RuntimeFocusGroup>
  );
}

export const FrameListItem = memo(FrameListItemComponent);
