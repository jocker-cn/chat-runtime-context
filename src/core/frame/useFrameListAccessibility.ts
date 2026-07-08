import { useCallback, useMemo, useRef, useState } from "react";

export interface FrameListAccessibilityOptions {
  enabled?: boolean;
  listRole?: string;
  frameRole?: string;
  ariaLabel?: string;
}

export interface FrameListAccessibilityApi {
  activeFrameId?: string;
  enabled: boolean;
  listProps: {
    role?: string;
    "aria-label"?: string;
  };
  frameRole?: string;
  registerFrame: (frameId: string, element: HTMLDivElement | null) => void;
  onExitFrame: (frameId: string) => void;
  onFrameFocus: (frameId: string) => void;
  onFrameKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
    frameId: string,
  ) => void;
}

export function useFrameListAccessibility({
  accessibility,
  frameIds,
}: {
  accessibility?: FrameListAccessibilityOptions;
  frameIds: readonly string[];
}): FrameListAccessibilityApi {
  const enabled = accessibility?.enabled ?? true;
  const frameRefs = useRef(new Map<string, HTMLDivElement>());
  const [activeFrameId, setActiveFrameId] = useState<string | undefined>(
    frameIds[0],
  );

  const focusFrame = useCallback(
    (frameId: string) => {
      setActiveFrameId(frameId);
      frameRefs.current.get(frameId)?.focus();
    },
    [],
  );

  const registerFrame = useCallback(
    (frameId: string, element: HTMLDivElement | null) => {
      if (element) {
        frameRefs.current.set(frameId, element);
        return;
      }

      frameRefs.current.delete(frameId);
    },
    [],
  );

  const onFrameKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, frameId: string) => {
      if (!enabled) return;

      const currentIndex = frameIds.indexOf(frameId);
      if (currentIndex < 0) return;

      const nextIndex =
        event.key === "ArrowDown"
          ? currentIndex + 1
          : event.key === "ArrowUp"
            ? currentIndex - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? frameIds.length - 1
                : currentIndex;

      if (nextIndex === currentIndex) return;

      const nextFrameId = frameIds[nextIndex];
      if (!nextFrameId) return;

      event.preventDefault();
      focusFrame(nextFrameId);
    },
    [enabled, focusFrame, frameIds],
  );

  return useMemo(
    () => ({
      activeFrameId,
      enabled,
      frameRole: accessibility?.frameRole,
      listProps: {
        role: accessibility?.listRole ?? "list",
        "aria-label": accessibility?.ariaLabel,
      },
      registerFrame,
      onExitFrame: () => undefined,
      onFrameFocus: setActiveFrameId,
      onFrameKeyDown,
    }),
    [
      accessibility?.ariaLabel,
      accessibility?.frameRole,
      accessibility?.listRole,
      activeFrameId,
      enabled,
      onFrameKeyDown,
      registerFrame,
    ],
  );
}
