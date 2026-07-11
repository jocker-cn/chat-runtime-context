import { memo, useCallback } from "react";
import type React from "react";
import { InnerFocusManager } from "../react/accessibility/InnerFocusManager";
import { useRuntimeFocusGroup } from "../react/accessibility/RuntimeFocusController";

export interface FrameListItemProps {
  frameId: string;
  className?: string;
  enabled: boolean;
  active: boolean;
  children: React.ReactNode;
  registerFrame: (frameId: string, element: HTMLDivElement | null) => void;
  onExitFrame: (frameId: string) => void;
  onFrameFocus: (
    event: React.FocusEvent<HTMLDivElement>,
    frameId: string,
  ) => void;
  onFrameKeyDown: (
    event: React.KeyboardEvent<HTMLElement>,
    frameId: string,
  ) => void;
}

function FrameListItemComponent({
  frameId,
  className,
  enabled,
  active,
  children,
  registerFrame,
  onExitFrame,
  onFrameFocus,
  onFrameKeyDown,
}: FrameListItemProps) {
  const runtimeGroup = useRuntimeFocusGroup(frameId, enabled);
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      registerFrame(frameId, element);
      runtimeGroup.ref(element);
    },
    [frameId, registerFrame, runtimeGroup.ref],
  );

  const handleFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    onFrameFocus(event, frameId);
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
    <InnerFocusManager
      enabled={enabled}
      role={enabled ? "listitem" : undefined}
      active={active}
      onExit={handleBlur}
      excludeOuterFocusable
    >
      <div
        ref={ref}
        className={className}
        data-active-frame={active ? "true" : undefined}
        data-frame-id={frameId}
        data-enabled={enabled ? "true" : undefined}
        data-runtime-focus-group-id={
          runtimeGroup.managed ? frameId : undefined
        }
        tabIndex={
          enabled
            ? runtimeGroup.managed
              ? -1
              : 0
            : undefined
        }
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </InnerFocusManager>
  );
}

export const FrameListItem = memo(FrameListItemComponent);
