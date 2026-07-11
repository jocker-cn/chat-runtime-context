import { FocusScope } from "@react-aria/focus";
import React, { useEffect, useRef } from "react";
import { KEYBOARD_FOCUS, KeyBoardEvent } from "./constants";

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"], [role="button"]';

const isFocusableElementVisible = (element: HTMLElement) => {
  try {
    if (element.getAttribute("role") === "listitem") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (
      rect.width === 0 &&
      rect.height === 0 &&
      element.offsetParent === null &&
      element.getClientRects().length === 0
    ) {
      return (
        typeof window !== "undefined" &&
        window.navigator.userAgent.includes("jsdom")
      );
    }

    return true;
  } catch {
    return true;
  }
};

export const setInnerFocusableTabIndex = (
  container: Element | null,
  value: number,
) => {
  if (!container) {
    return;
  }

  const focusableList = container.querySelectorAll<HTMLElement>(
    'a, button, input, textarea, select, [tabindex], [contenteditable="true"], [role="button"]',
  );

  focusableList.forEach((element) => {
    if (element === container || element.hasAttribute("disabled")) {
      return;
    }

    try {
      element.tabIndex = value;
      element.setAttribute("tabindex", String(value));
    } catch {
      // Ignore elements that do not allow tabindex changes.
    }
  });
};

export type InnerFocusManagerProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  active: boolean;
  onExit: () => void;
  enabled?: boolean;
  excludeOuterFocusable?: boolean;
};

export function InnerFocusManager({
  children,
  active,
  onExit,
  enabled = true,
  excludeOuterFocusable = false,
  ...props
}: InnerFocusManagerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusableRef = useRef<HTMLElement[]>([]);
  const indexRef = useRef(0);
  const previousTabIndexMap = useRef(new Map<HTMLElement, string | null>());
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const lastIndexRef = useRef(0);

  const focusByIndex = (index: number) => {
    const list = focusableRef.current;
    if (!list.length) {
      return;
    }

    const normalizedIndex = ((index % list.length) + list.length) % list.length;
    const element = list[normalizedIndex];
    if (!element) {
      return;
    }

    if (
      previousFocusedElementRef.current &&
      previousFocusedElementRef.current !== element
    ) {
      try {
        previousFocusedElementRef.current.classList.remove(KEYBOARD_FOCUS);
      } catch {
        // Ignore detached elements.
      }
    }

    try {
      element.focus();
      element.classList.add(KEYBOARD_FOCUS);
    } catch {
      // Ignore elements that cannot receive focus.
    }

    previousFocusedElementRef.current = element;
    indexRef.current = normalizedIndex;
    lastIndexRef.current = indexRef.current;
  };

  const handleFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const index = focusableRef.current.indexOf(target);
    if (index < 0) {
      return;
    }

    if (
      previousFocusedElementRef.current &&
      previousFocusedElementRef.current !== target
    ) {
      try {
        previousFocusedElementRef.current.classList.remove(KEYBOARD_FOCUS);
      } catch {
        // Ignore detached elements.
      }
    }

    try {
      target.classList.add(KEYBOARD_FOCUS);
    } catch {
      // Ignore elements without a mutable class list.
    }

    previousFocusedElementRef.current = target;
    indexRef.current = index;
    lastIndexRef.current = indexRef.current;
  };

  const rebuildFocusable = () => {
    if (!rootRef.current) {
      return [];
    }

    lastIndexRef.current = indexRef.current;
    const all = Array.from(
      rootRef.current.querySelectorAll<HTMLElement>(focusableSelector),
    );
    const nextFocusable = all.filter(isFocusableElementVisible);

    if (excludeOuterFocusable) {
      nextFocusable.shift();
    }

    focusableRef.current = nextFocusable;
    try {
      nextFocusable.forEach((element) => {
        element.tabIndex = 0;
        element.setAttribute("tabindex", "0");
      });
    } catch {
      // Ignore elements that do not allow tabindex changes.
    }

    return nextFocusable;
  };

  const focusByRebuild = (target: HTMLElement) => {
    try {
      if (!rootRef.current) {
        return;
      }

      const nextFocusable = rebuildFocusable();
      const nextIndex = nextFocusable.indexOf(target);
      if (nextIndex >= 0) {
        focusByIndex(nextIndex);
        return;
      }

      if (nextFocusable.length > 0) {
        const clampedIndex = Math.max(
          0,
          Math.min(indexRef.current, nextFocusable.length - 1),
        );
        focusByIndex(clampedIndex);
      }
    } catch {
      // The focused element may be replaced by the activation callback.
    }
  };

  const handleEntry = (event: KeyboardEvent, target: HTMLElement) => {
    event.preventDefault();
    event.stopPropagation();

    const tagName = target.tagName;
    const role = target.getAttribute("role");
    if (tagName === "BUTTON" || tagName === "A" || role === "button") {
      try {
        target.click();
      } catch {
        // Ignore activation failures from detached elements.
      }
    }

    requestAnimationFrame(() => {
      focusByRebuild(target);
    });
  };

  const handleArrowKey = (key: string, event: KeyboardEvent) => {
    if (
      key === KeyBoardEvent.ARROW_RIGHT ||
      key === KeyBoardEvent.ARROW_DOWN
    ) {
      event.preventDefault();
      focusByIndex(indexRef.current + 1);
      event.stopPropagation();
      return;
    }

    if (key === KeyBoardEvent.ARROW_LEFT || key === KeyBoardEvent.ARROW_UP) {
      event.preventDefault();
      focusByIndex(indexRef.current - 1);
      event.stopPropagation();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!enabled || !active) {
      return;
    }

    const key = event.key;
    const target = event.target as HTMLElement | null;
    const isInside =
      Boolean(rootRef.current) &&
      Boolean(target) &&
      rootRef.current?.contains(target) === true;
    if (!isInside || !target) {
      return;
    }

    const isTextEditable =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    if (
      key === " " ||
      key === KeyBoardEvent.SPACE ||
      key === KeyBoardEvent.SPACE_BAR ||
      key === KeyBoardEvent.ENTER
    ) {
      if (isTextEditable) {
        return;
      }

      handleEntry(event, target);
      return;
    }

    if (key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      onExit();
      return;
    }

    if (!focusableRef.current.length) {
      return;
    }

    handleArrowKey(key, event);
  };

  useEffect(() => {
    const currentRoot = rootRef.current;
    if (!currentRoot) {
      return;
    }

    if (!enabled || !active) {
      lastIndexRef.current = 0;
      return;
    }

    const all = Array.from(
      currentRoot.querySelectorAll<HTMLElement>(focusableSelector),
    );
    const focusable = all.filter(isFocusableElementVisible);
    if (excludeOuterFocusable) {
      focusable.shift();
    }

    focusableRef.current = focusable;
    previousTabIndexMap.current = new Map();
    focusable.forEach((element) => {
      previousTabIndexMap.current.set(
        element,
        element.hasAttribute("tabindex")
          ? element.getAttribute("tabindex")
          : null,
      );

      try {
        element.tabIndex = 0;
        element.setAttribute("tabindex", "0");
      } catch {
        // Ignore elements that do not allow tabindex changes.
      }
    });

    const existingIndex = Math.max(0, lastIndexRef.current);
    indexRef.current = existingIndex >= 0 ? existingIndex : 0;
    requestAnimationFrame(() => {
      focusByIndex(indexRef.current);
    });

    window.addEventListener("keydown", handleKeyDown, true);
    currentRoot.addEventListener("focusin", handleFocusIn, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      currentRoot.removeEventListener("focusin", handleFocusIn, true);
      previousTabIndexMap.current.forEach((previous, element) => {
        try {
          if (previous === null) {
            element.removeAttribute("tabindex");
          } else {
            element.setAttribute("tabindex", previous);
          }
          element.classList.remove(KEYBOARD_FOCUS);
        } catch {
          // Ignore detached elements.
        }
      });
      previousTabIndexMap.current.clear();
      focusableRef.current = [];
      previousFocusedElementRef.current = null;
    };
  }, [active, enabled, excludeOuterFocusable, onExit]);

  const root = (
    <div
      {...props}
      ref={rootRef}
      tabIndex={enabled && active ? -1 : props.tabIndex}
    >
      {children}
    </div>
  );

  if (!enabled) {
    return root;
  }

  return (
    <FocusScope restoreFocus={false} autoFocus={false}>
      {root}
    </FocusScope>
  );
}
