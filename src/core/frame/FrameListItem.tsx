import { memo, useCallback } from "react";
import type React from "react";
import { InnerFocusManager } from "./InnerFocusManager";

export interface FrameListItemProps {
  frameId: string;
  className?: string;
  enabled: boolean;
  active: boolean;
  frameRole?: string;
  children: React.ReactNode;
  registerFrame: (frameId: string, element: HTMLDivElement | null) => void;
  onExitFrame: (frameId: string) => void;
  onFrameFocus: (frameId: string) => void;
  onFrameKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
    frameId: string,
  ) => void;
}

function FrameListItemComponent({
  frameId,
  className,
  enabled,
  active,
  frameRole,
  children,
  registerFrame,
  onExitFrame,
  onFrameFocus,
  onFrameKeyDown,
}: FrameListItemProps) {
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      registerFrame(frameId, element);
    },
    [frameId, registerFrame],
  );

  const handleFocus = useCallback(() => {
    onFrameFocus(frameId);
  }, [frameId, onFrameFocus]);

  const handleBlur = useCallback(() => {
    onExitFrame(frameId);
  }, [frameId, onExitFrame]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      onFrameKeyDown(event, frameId);
    },
    [frameId, onFrameKeyDown],
  );

  return (
    <InnerFocusManager enabled={enabled}>
      <div
        ref={ref}
        role={frameRole}
        className={className}
        data-active-frame={active ? "true" : undefined}
        data-frame-id={frameId}
        tabIndex={enabled ? 0 : undefined}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </InnerFocusManager>
  );
}

export const FrameListItem = memo(FrameListItemComponent);
