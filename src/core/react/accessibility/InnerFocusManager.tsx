import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
} from "react";
import { KEYBOARD_FOCUS } from "./constants";

const focusableSelector =
  'a[href], button, input, textarea, select, [tabindex], [contenteditable="true"], [role="button"]';

function getFocusableElements(
  container: Element | null,
  excludeFirst = false,
) {
  if (!container) {
    return [];
  }

  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true",
  );

  return excludeFirst ? elements.slice(1) : elements;
}

export function setInnerFocusableTabIndex(
  container: Element | null,
  value: number,
) {
  getFocusableElements(container).forEach((element) => {
    element.tabIndex = value;
  });
}

export type InnerFocusManagerProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
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
  onFocusCapture,
  onKeyDownCapture,
  ...props
}: InnerFocusManagerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const focusedIndexRef = useRef(0);
  const originalTabIndexRef = useRef(new Map<HTMLElement, string | null>());

  const getItems = useCallback(
    () => getFocusableElements(rootRef.current, excludeOuterFocusable),
    [excludeOuterFocusable],
  );

  const focusItem = useCallback(
    (requestedIndex: number) => {
      const items = getItems();
      if (items.length === 0) {
        return;
      }

      const index =
        ((requestedIndex % items.length) + items.length) % items.length;
      const next = items[index];
      if (!next) {
        return;
      }

      focusedElementRef.current?.classList.remove(KEYBOARD_FOCUS);
      next.focus();
      next.classList.add(KEYBOARD_FOCUS);
      focusedElementRef.current = next;
      focusedIndexRef.current = index;
    },
    [getItems],
  );

  useLayoutEffect(() => {
    const items = getItems();

    if (!enabled) {
      originalTabIndexRef.current.forEach((tabIndex, element) => {
        if (tabIndex === null) {
          element.removeAttribute("tabindex");
        } else {
          element.setAttribute("tabindex", tabIndex);
        }
      });
      originalTabIndexRef.current.clear();
      return;
    }

    items.forEach((element) => {
      if (!originalTabIndexRef.current.has(element)) {
        originalTabIndexRef.current.set(
          element,
          element.hasAttribute("tabindex")
            ? element.getAttribute("tabindex")
            : null,
        );
      }
      element.tabIndex = active ? 0 : -1;
    });
  });

  useEffect(() => {
    if (!enabled || !active) {
      focusedElementRef.current?.classList.remove(KEYBOARD_FOCUS);
      focusedElementRef.current = null;
      focusedIndexRef.current = 0;
      return;
    }

    const frame = requestAnimationFrame(() => focusItem(focusedIndexRef.current));
    return () => cancelAnimationFrame(frame);
  }, [active, enabled, focusItem]);

  useEffect(
    () => () => {
      originalTabIndexRef.current.forEach((tabIndex, element) => {
        if (tabIndex === null) {
          element.removeAttribute("tabindex");
        } else {
          element.setAttribute("tabindex", tabIndex);
        }
        element.classList.remove(KEYBOARD_FOCUS);
      });
      originalTabIndexRef.current.clear();
    },
    [],
  );

  const handleFocusCapture = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      onFocusCapture?.(event);
      if (!active || event.defaultPrevented) {
        return;
      }

      const target = event.target as HTMLElement;
      const index = getItems().indexOf(target);
      if (index < 0) {
        return;
      }

      focusedElementRef.current?.classList.remove(KEYBOARD_FOCUS);
      target.classList.add(KEYBOARD_FOCUS);
      focusedElementRef.current = target;
      focusedIndexRef.current = index;
    },
    [active, getItems, onFocusCapture],
  );

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDownCapture?.(event);
      if (!enabled || !active || event.defaultPrevented) {
        return;
      }

      const target = event.target as HTMLElement;
      const editable =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onExit();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (editable) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        focusItem(focusedIndexRef.current + 1);
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        focusItem(focusedIndexRef.current - 1);
        return;
      }

      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        if (
          target.tagName === "BUTTON" ||
          target.tagName === "A" ||
          target.getAttribute("role") === "button"
        ) {
          target.click();
        }
        requestAnimationFrame(() => focusItem(focusedIndexRef.current));
      }
    },
    [active, enabled, focusItem, onExit, onKeyDownCapture],
  );

  return (
    <div
      {...props}
      ref={rootRef}
      tabIndex={enabled && active ? -1 : props.tabIndex}
      onFocusCapture={handleFocusCapture}
      onKeyDownCapture={handleKeyDownCapture}
    >
      {children}
    </div>
  );
}
