import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { setInnerFocusableTabIndex } from "./InnerFocusManager";
import { KeyBoardEvent } from "./constants";

export interface FrameListAccessibilityOptions {
  enabled?: boolean;
  ariaLabel?: string;
  pageStep?: number;
}

interface UseFrameListAccessibilityOptions {
  accessibility?: FrameListAccessibilityOptions;
  frameIds: readonly string[];
}

const setFrameTabIndex = (
  element: HTMLElement | null | undefined,
  value: number,
) => {
  if (!element) {
    return;
  }

  element.tabIndex = value;
  element.setAttribute("tabindex", String(value));
};

const clearFrameTabIndex = (element: HTMLElement | null | undefined) => {
  if (!element) {
    return;
  }

  element.removeAttribute("tabindex");
};

export interface FrameListAccessibilityApi {
  activeFrameId: string | null;
  enabled: boolean;
  listProps: React.HTMLAttributes<HTMLDivElement>;
  onExitFrame: (frameId: string) => void;
  onFrameFocus: (
    event: React.FocusEvent<HTMLDivElement>,
    frameId: string,
  ) => void;
  onFrameKeyDown: (
    event: React.KeyboardEvent<HTMLElement>,
    frameId: string,
  ) => void;
  registerFrame: (frameId: string, element: HTMLDivElement | null) => void;
}

export const useFrameListAccessibility = ({
  accessibility,
  frameIds,
}: UseFrameListAccessibilityOptions): FrameListAccessibilityApi => {
  const enabled = accessibility?.enabled ?? true;
  const pageStep = accessibility?.pageStep ?? 4;
  const ariaLabel = accessibility?.ariaLabel ?? "chat";
  const enabledRef = useRef(enabled);
  const pageStepRef = useRef(pageStep);
  const frameIdsRef = useRef(frameIds);
  const previousFrameIdsRef = useRef<readonly string[]>([]);
  const frameElementByIdRef = useRef(new Map<string, HTMLDivElement>());
  const focusedFrameIdRef = useRef<string | null>(null);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);

  enabledRef.current = enabled;
  pageStepRef.current = pageStep;
  frameIdsRef.current = frameIds;

  const focusFrameById = useCallback(
    (frameId: string, shouldFocus = true) => {
      if (!enabledRef.current) {
        return;
      }

      const previousFrameId = focusedFrameIdRef.current;
      const previousElement = previousFrameId
        ? frameElementByIdRef.current.get(previousFrameId)
        : undefined;
      const nextElement = frameElementByIdRef.current.get(frameId);

      if (!nextElement) {
        return;
      }

      if (previousFrameId !== frameId) {
        setFrameTabIndex(previousElement, -1);
      }

      focusedFrameIdRef.current = frameId;
      setFrameTabIndex(nextElement, 0);
      setInnerFocusableTabIndex(nextElement, -1);

      if (shouldFocus) {
        requestAnimationFrame(() => nextElement.focus());
      }
    },
    [],
  );

  const focusFrameByIndex = useCallback(
    (nextIndex: number) => {
      const currentFrameIds = frameIdsRef.current;
      if (!enabledRef.current || currentFrameIds.length === 0) {
        return;
      }

      const clampedIndex = Math.max(
        0,
        Math.min(nextIndex, currentFrameIds.length - 1),
      );
      const nextFrameId = currentFrameIds[clampedIndex];
      if (nextFrameId) {
        focusFrameById(nextFrameId);
      }
    },
    [focusFrameById],
  );

  useEffect(() => {
    const currentFrameIds = frameIds;
    const currentFrameIdSet = new Set(currentFrameIds);

    frameElementByIdRef.current.forEach((_element, frameId) => {
      if (!currentFrameIdSet.has(frameId)) {
        frameElementByIdRef.current.delete(frameId);
      }
    });

    if (!enabled) {
      frameElementByIdRef.current.forEach(clearFrameTabIndex);
      focusedFrameIdRef.current = null;
      previousFrameIdsRef.current = currentFrameIds;
      setActiveFrameId(null);
      return;
    }

    if (currentFrameIds.length === 0) {
      focusedFrameIdRef.current = null;
      previousFrameIdsRef.current = currentFrameIds;
      setActiveFrameId(null);
      return;
    }

    setActiveFrameId((current) =>
      current && currentFrameIdSet.has(current) ? current : null,
    );

    const previousFrameIds = previousFrameIdsRef.current;
    const previousLatestFrameId = previousFrameIds.at(-1);
    const latestFrameId = currentFrameIds.at(-1);

    if (previousLatestFrameId && previousLatestFrameId !== latestFrameId) {
      setFrameTabIndex(
        frameElementByIdRef.current.get(previousLatestFrameId),
        -1,
      );
    }

    if (latestFrameId) {
      focusFrameById(latestFrameId, false);
    }

    previousFrameIdsRef.current = currentFrameIds;
  }, [enabled, focusFrameById, frameIds]);

  const registerFrame = useCallback(
    (frameId: string, element: HTMLDivElement | null) => {
      if (!element) {
        frameElementByIdRef.current.delete(frameId);
        return;
      }

      frameElementByIdRef.current.set(frameId, element);
      const currentFrameIds = frameIdsRef.current;
      const latestFrameId = currentFrameIds.at(-1);

      if (enabledRef.current) {
        setFrameTabIndex(element, frameId === latestFrameId ? 0 : -1);
      } else {
        clearFrameTabIndex(element);
      }

      setInnerFocusableTabIndex(element, -1);
    },
    [],
  );

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const currentFrameIds = frameIdsRef.current;
      if (!enabledRef.current || currentFrameIds.length === 0) {
        return;
      }

      const focusedFrameId = focusedFrameIdRef.current;
      const currentIndex = focusedFrameId
        ? currentFrameIds.indexOf(focusedFrameId)
        : currentFrameIds.length - 1;
      const safeCurrentIndex =
        currentIndex >= 0 ? currentIndex : currentFrameIds.length - 1;

      if (event.key === KeyBoardEvent.ARROW_DOWN) {
        event.preventDefault();
        focusFrameByIndex(safeCurrentIndex + 1);
        return;
      }

      if (event.key === KeyBoardEvent.ARROW_UP) {
        event.preventDefault();
        focusFrameByIndex(safeCurrentIndex - 1);
        return;
      }

      if (event.key === KeyBoardEvent.PAGE_DOWN) {
        event.preventDefault();
        focusFrameByIndex(safeCurrentIndex + pageStepRef.current);
        return;
      }

      if (event.key === KeyBoardEvent.PAGE_UP) {
        event.preventDefault();
        focusFrameByIndex(safeCurrentIndex - pageStepRef.current);
      }
    },
    [focusFrameByIndex],
  );

  const onExitFrame = useCallback(
    (frameId: string) => {
      setActiveFrameId(null);
      const container = frameElementByIdRef.current.get(frameId);

      requestAnimationFrame(() => {
        if (!container) {
          return;
        }

        setInnerFocusableTabIndex(container, -1);
        focusFrameById(frameId);
      });
    },
    [focusFrameById],
  );

  const onFrameFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>, frameId: string) => {
      if (!enabledRef.current || event.currentTarget !== event.target) {
        return;
      }

      focusFrameById(frameId, false);
    },
    [focusFrameById],
  );

  const onFrameKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, frameId: string) => {
      if (!enabledRef.current || event.key !== KeyBoardEvent.ENTER) {
        return;
      }

      event.preventDefault();
      setActiveFrameId(frameId);
    },
    [],
  );

  const listProps = useMemo<React.HTMLAttributes<HTMLDivElement>>(
    () => ({
      role: enabled ? "list" : undefined,
      tabIndex: enabled ? -1 : undefined,
      "aria-label": enabled ? ariaLabel : undefined,
      onKeyDown: handleListKeyDown,
    }),
    [ariaLabel, enabled, handleListKeyDown],
  );

  return {
    activeFrameId,
    enabled,
    listProps,
    onExitFrame,
    onFrameFocus,
    onFrameKeyDown,
    registerFrame,
  };
};
