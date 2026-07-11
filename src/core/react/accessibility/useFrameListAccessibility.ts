import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";

export interface FrameListAccessibilityOptions {
  enabled?: boolean;
  ariaLabel?: string;
  pageStep?: number;
}

interface UseFrameListAccessibilityOptions {
  accessibility?: FrameListAccessibilityOptions;
  frameIds: readonly string[];
  manageTabOrder?: boolean;
}

function setTabIndex(element: HTMLElement | undefined, value: number) {
  if (element) {
    element.tabIndex = value;
  }
}

function clearTabIndex(element: HTMLElement) {
  element.removeAttribute("tabindex");
}

export interface FrameListAccessibilityApi {
  activeFrameId: string | null;
  enabled: boolean;
  listProps: HTMLAttributes<HTMLDivElement>;
  onExitFrame: (frameId: string) => void;
  onFrameFocus: (
    event: FocusEvent<HTMLDivElement>,
    frameId: string,
  ) => void;
  onFrameKeyDown: (
    event: KeyboardEvent<HTMLElement>,
    frameId: string,
  ) => void;
  registerFrame: (frameId: string, element: HTMLDivElement | null) => void;
}

export function useFrameListAccessibility({
  accessibility,
  frameIds,
  manageTabOrder = true,
}: UseFrameListAccessibilityOptions): FrameListAccessibilityApi {
  const enabled = accessibility?.enabled ?? true;
  const ariaLabel = accessibility?.ariaLabel ?? "chat";
  const pageStep = accessibility?.pageStep ?? 4;
  const enabledRef = useRef(enabled);
  const frameIdsRef = useRef(frameIds);
  const pageStepRef = useRef(pageStep);
  const manageTabOrderRef = useRef(manageTabOrder);
  const elementsRef = useRef(new Map<string, HTMLDivElement>());
  const focusedFrameIdRef = useRef<string | null>(null);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);

  enabledRef.current = enabled;
  frameIdsRef.current = frameIds;
  pageStepRef.current = pageStep;
  manageTabOrderRef.current = manageTabOrder;

  const focusFrame = useCallback((frameId: string, moveFocus = true) => {
    if (!enabledRef.current) {
      return;
    }

    const next = elementsRef.current.get(frameId);
    if (!next) {
      return;
    }

    const previousId = focusedFrameIdRef.current;
    if (
      manageTabOrderRef.current &&
      previousId &&
      previousId !== frameId
    ) {
      setTabIndex(elementsRef.current.get(previousId), -1);
    }

    focusedFrameIdRef.current = frameId;
    if (manageTabOrderRef.current) {
      setTabIndex(next, 0);
    }

    if (moveFocus) {
      requestAnimationFrame(() => next.focus());
    }
  }, []);

  const focusFrameByIndex = useCallback(
    (index: number) => {
      const currentIds = frameIdsRef.current;
      if (!enabledRef.current || currentIds.length === 0) {
        return;
      }

      const nextId = currentIds[
        Math.max(0, Math.min(index, currentIds.length - 1))
      ];
      if (nextId) {
        focusFrame(nextId);
      }
    },
    [focusFrame],
  );

  useEffect(() => {
    const currentIds = new Set(frameIds);
    elementsRef.current.forEach((_element, frameId) => {
      if (!currentIds.has(frameId)) {
        elementsRef.current.delete(frameId);
      }
    });

    if (!enabled) {
      elementsRef.current.forEach(clearTabIndex);
      focusedFrameIdRef.current = null;
      setActiveFrameId(null);
      return;
    }

    const latestId = frameIds.at(-1);
    if (manageTabOrder) {
      elementsRef.current.forEach((element, frameId) => {
        setTabIndex(element, frameId === latestId ? 0 : -1);
      });
    }
    focusedFrameIdRef.current = latestId ?? null;
    setActiveFrameId((current) =>
      current && currentIds.has(current) ? current : null,
    );
  }, [enabled, frameIds, manageTabOrder]);

  const registerFrame = useCallback(
    (frameId: string, element: HTMLDivElement | null) => {
      if (!element) {
        elementsRef.current.delete(frameId);
        return;
      }

      elementsRef.current.set(frameId, element);
      if (!enabledRef.current) {
        clearTabIndex(element);
        return;
      }

      if (manageTabOrderRef.current) {
        setTabIndex(element, frameId === frameIdsRef.current.at(-1) ? 0 : -1);
      }
    },
    [],
  );

  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const currentIds = frameIdsRef.current;
      if (!enabledRef.current || currentIds.length === 0) {
        return;
      }

      const currentIndex = Math.max(
        0,
        currentIds.indexOf(focusedFrameIdRef.current ?? ""),
      );
      const offset =
        event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowUp"
            ? -1
            : event.key === "PageDown"
              ? pageStepRef.current
              : event.key === "PageUp"
                ? -pageStepRef.current
                : 0;

      if (offset === 0) {
        return;
      }

      event.preventDefault();
      focusFrameByIndex(currentIndex + offset);
    },
    [focusFrameByIndex],
  );

  const onExitFrame = useCallback(
    (frameId: string) => {
      setActiveFrameId(null);
      requestAnimationFrame(() => focusFrame(frameId));
    },
    [focusFrame],
  );

  const onFrameFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>, frameId: string) => {
      if (event.currentTarget === event.target) {
        focusFrame(frameId, false);
      }
    },
    [focusFrame],
  );

  const onFrameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, frameId: string) => {
      if (!enabledRef.current || event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      setActiveFrameId(frameId);
    },
    [],
  );

  const listProps = useMemo<HTMLAttributes<HTMLDivElement>>(
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
}
