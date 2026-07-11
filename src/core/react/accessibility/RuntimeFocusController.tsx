import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefCallback,
} from "react";
import {
  hasInnerFocusableElements,
  InnerFocusManager,
} from "./InnerFocusManager";

interface RuntimeFocusGroupEntry {
  element: HTMLElement;
  id: string;
  token: symbol;
}

class RuntimeFocusRegistry {
  private readonly groups = new Map<string, RuntimeFocusGroupEntry>();
  private rememberedGroupId: string | null = null;
  private root: HTMLElement | null = null;

  readonly setRoot: RefCallback<HTMLElement> = (element) => {
    this.root = element;
    if (element) {
      this.reconcileTabStops();
    }
  };

  registerGroup(
    id: string,
    element: HTMLElement,
    token: symbol,
  ) {
    const current = this.groups.get(id);
    if (
      current?.element === element &&
      current.token === token
    ) {
      return;
    }

    if (current) {
      this.clearGroupAttributes(current);
    }

    this.groups.set(id, { element, id, token });
    element.dataset.runtimeFocusGroupId = id;
    this.reconcileTabStops();
  }

  unregisterGroup(id: string, token: symbol) {
    const current = this.groups.get(id);
    if (!current || current.token !== token) {
      return;
    }

    this.groups.delete(id);
    this.clearGroupAttributes(current);
    this.reconcileTabStops();
  }

  readonly handleFocusCapture = (
    event: ReactFocusEvent<HTMLElement>,
  ) => {
    const entry = this.findGroupForTarget(event.target);
    if (entry) {
      this.setCurrentGroup(entry.id, undefined, true);
    }
  };

  readonly handleKeyDownCapture = (
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (event.defaultPrevented) {
      return;
    }

    const groups = this.getOrderedGroups();
    const target = event.target as HTMLElement;
    const currentIndex = groups.findIndex(
      (entry) => entry.element === target,
    );
    if (currentIndex < 0) {
      return;
    }

    const offset =
      event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowUp"
          ? -1
          : 0;
    if (offset === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const nextIndex = Math.max(
      0,
      Math.min(currentIndex + offset, groups.length - 1),
    );
    const next = groups[nextIndex];
    if (!next) {
      return;
    }

    this.setCurrentGroup(next.id, groups, true);
    next.element.focus();
  };

  private findGroupForTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return undefined;
    }

    return this.getOrderedGroups().find(
      (entry) =>
        entry.element === target || entry.element.contains(target),
    );
  }

  private getOrderedGroups() {
    const root = this.root;
    if (!root) {
      return [];
    }

    return Array.from(this.groups.values())
      .filter(
        (entry) =>
          entry.element.isConnected && root.contains(entry.element),
      )
      .sort((left, right) => {
        if (left.element === right.element) {
          return 0;
        }

        const position = left.element.compareDocumentPosition(right.element);
        return position & 4 ? -1 : 1;
      });
  }

  private reconcileTabStops() {
    const groups = this.getOrderedGroups();
    if (groups.length === 0) {
      return;
    }

    groups.forEach((entry, index) => {
      entry.element.setAttribute("aria-posinset", String(index + 1));
      entry.element.setAttribute("aria-setsize", String(groups.length));
    });

    const remembered = groups.find(
      (entry) => entry.id === this.rememberedGroupId,
    );
    const next = remembered ?? groups.at(-1);
    if (next) {
      this.setCurrentGroup(next.id, groups);
    }
  }

  private setCurrentGroup(
    id: string,
    groups = this.getOrderedGroups(),
    remember = false,
  ) {
    if (remember) {
      this.rememberedGroupId = id;
    }
    groups.forEach((entry) => {
      entry.element.tabIndex = entry.id === id ? 0 : -1;
    });
  }

  private clearGroupAttributes(entry: RuntimeFocusGroupEntry) {
    if (entry.element.dataset.runtimeFocusGroupId === entry.id) {
      delete entry.element.dataset.runtimeFocusGroupId;
    }
    entry.element.removeAttribute("aria-posinset");
    entry.element.removeAttribute("aria-setsize");
  }
}

const RuntimeFocusContext = createContext<RuntimeFocusRegistry | null>(null);

interface RuntimeFocusControllerProps {
  children: ReactNode;
}

export function RuntimeFocusController({
  children,
}: RuntimeFocusControllerProps) {
  const registryRef = useRef<RuntimeFocusRegistry | null>(null);
  registryRef.current ??= new RuntimeFocusRegistry();

  return (
    <RuntimeFocusContext.Provider value={registryRef.current}>
      {children}
    </RuntimeFocusContext.Provider>
  );
}

export function useRuntimeFocusRootProps() {
  const registry = useContext(RuntimeFocusContext);
  if (!registry) {
    throw new Error(
      "useRuntimeFocusRootProps must be used within RuntimeFocusController",
    );
  }

  return useMemo(
    () => ({
      ref: registry.setRoot,
      role: "list" as const,
      "aria-label": "Chat messages",
      onFocusCapture: registry.handleFocusCapture,
      onKeyDownCapture: registry.handleKeyDownCapture,
    }),
    [registry],
  );
}

function useRuntimeFocusGroup(
  groupId: string,
  enabled = true,
) {
  const registry = useContext(RuntimeFocusContext);
  const token = useMemo(() => Symbol(groupId), [groupId]);
  const ref = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      if (!registry || !enabled) {
        return;
      }

      if (element) {
        registry.registerGroup(groupId, element, token);
      } else {
        registry.unregisterGroup(groupId, token);
      }
    },
    [enabled, groupId, registry, token],
  );

  return {
    managed: Boolean(registry && enabled),
    ref,
  };
}

interface RuntimeFocusGroupProps
  extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  enabled?: boolean;
  groupId: string;
}

export function RuntimeFocusGroup({
  children,
  enabled = true,
  groupId,
  onKeyDown,
  role = "listitem",
  tabIndex,
  "aria-label": ariaLabel = "Message",
  "aria-keyshortcuts": ariaKeyShortcuts =
    "ArrowUp ArrowDown Enter Escape",
  ...props
}: RuntimeFocusGroupProps) {
  const [active, setActive] = useState(false);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const runtimeGroup = useRuntimeFocusGroup(groupId, enabled);
  const setElement = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      elementRef.current = element;
      runtimeGroup.ref(element);
    },
    [runtimeGroup.ref],
  );

  useEffect(() => {
    if (!enabled) {
      setActive(false);
    }
  }, [enabled]);

  const handleExit = useCallback(() => {
    setActive(false);
    requestAnimationFrame(() => elementRef.current?.focus());
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (
        event.defaultPrevented ||
        !enabled ||
        event.key !== "Enter" ||
        !hasInnerFocusableElements(elementRef.current)
      ) {
        return;
      }

      event.preventDefault();
      setActive(true);
    },
    [enabled, onKeyDown],
  );

  return (
    <InnerFocusManager
      enabled={enabled}
      active={active}
      onExit={handleExit}
      excludeOuterFocusable
    >
      <div
        {...props}
        ref={setElement}
        data-active-runtime-group={active ? "true" : undefined}
        data-runtime-focus-group-id={groupId}
        role={role}
        aria-label={ariaLabel}
        aria-keyshortcuts={ariaKeyShortcuts}
        tabIndex={
          enabled
            ? runtimeGroup.managed
              ? -1
              : 0
            : tabIndex
        }
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </InnerFocusManager>
  );
}
