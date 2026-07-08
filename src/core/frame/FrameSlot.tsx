import type { ReactNode } from "react";

export interface FrameSlotProps {
  frameId: string;
  className?: string;
  children: ReactNode;
}

export function FrameSlot({
  frameId,
  className,
  children,
}: FrameSlotProps) {
  return (
    <div className={className} data-frame-id={frameId}>
      {children}
    </div>
  );
}
