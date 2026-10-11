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

const controlSelector =
  'a[href], button, input, textarea, select, [contenteditable="true"], [role="button"]';
const focusableSelector = `${controlSelector}, [tabindex]`;

function getFocusableElements(
  container: Element | null,
  excludeOuter = false,
) {
  if (!container) {
    return [];
  }

  const outerElement = excludeOuter ? container.firstElementChild : null;
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter(
    (element) =>
      element !== outerElement &&
      !element.hasAttribute("disabled") &&
      !element.closest('[hidden], [aria-hidden="true"], [inert]'),
  );

  return elements;
}

export function hasInnerFocusableElements(container: Element | null) {
  return getFocusableElements(container).length > 0;
}

function restoreTabIndex(
  element: HTMLElement,
  originalTabIndex: string | null,
) {
  if (originalTabIndex === null) {
    element.removeAttribute("tabindex");
  } else {
    element.setAttribute("tabindex", originalTabIndex);
  }
  element.classList.remove(KEYBOARD_FOCUS);
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
    () => getFocusableElements(rootRef.current, excludeOuterFocusable).filter(
      // A tabindex added by this manager must not keep a former link/control interactive.
      (element) => originalTabIndexRef.current.get(element) !== null ||
        element.matches(controlSelector),
    ),
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
    const root = rootRef.current;
    if (!root) return;
    const syncItems = () => {
      const items = getItems();
      const currentItems = new Set(items);
      const focused = focusedElementRef.current;

      originalTabIndexRef.current.forEach((tabIndex, element) => {
        if (!currentItems.has(element)) {
          restoreTabIndex(element, tabIndex);
          originalTabIndexRef.current.delete(element);
        }
      });

      if (!enabled) {
        originalTabIndexRef.current.forEach((tabIndex, element) => {
          restoreTabIndex(element, tabIndex);
        });
        originalTabIndexRef.current.clear();
        return;
      }

      items.forEach((element) => {
        if (!originalTabIndexRef.current.has(element)) {
          originalTabIndexRef.current.set(element, element.getAttribute("tabindex"));
        }
        const nextTabIndex = active ? 0 : -1;
        if (element.tabIndex !== nextTabIndex) element.tabIndex = nextTabIndex;
      });

      if (focused && currentItems.has(focused)) {
        focusedIndexRef.current = items.indexOf(focused);
      } else if (focused) {
        focused.classList.remove(KEYBOARD_FOCUS);
        focusedElementRef.current = null;
        const currentFocus = root.ownerDocument.activeElement;
        // Recover a removed/disabled control, but never steal focus from another UI.
        if (active && (currentFocus === root.ownerDocument.body || root.contains(currentFocus))) {
          if (items.length > 0) focusItem(Math.min(focusedIndexRef.current, items.length - 1));
          else onExit();
        }
      }
    };
    syncItems();
    if (!enabled) return;

    const observer = new MutationObserver((records) => {
      const changes = records.filter((record) => {
        if (record.type === "childList") {
          return [...record.addedNodes, ...record.removedNodes].some((node) =>
            node instanceof Element &&
            (node.matches(focusableSelector) || node.querySelector(focusableSelector)),
          );
        }
        if (record.attributeName === "tabindex") {
          const element = record.target as HTMLElement;
          if (element === root || (excludeOuterFocusable && element === root.firstElementChild)) return false;
          // Ignore our own writes; retain business changes for eventual restoration.
          if (element.getAttribute("tabindex") === String(active ? 0 : -1)) return false;
          if (originalTabIndexRef.current.has(element)) {
            originalTabIndexRef.current.set(element, element.getAttribute("tabindex"));
          }
        }
        return true;
      });
      if (changes.length > 0) syncItems();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["tabindex", "href", "disabled", "hidden", "aria-hidden", "inert", "contenteditable", "role"],
    });
    return () => observer.disconnect();
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
        restoreTabIndex(element, tabIndex);
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
