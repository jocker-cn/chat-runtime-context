import {
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { ChatTurnNavigationController } from "./useChatTurnNavigation";

export interface ChatTurnNavigationRailProps {
  navigation: ChatTurnNavigationController;
  className?: string;
  markerClassName?: string;
  tooltipClassName?: string;
  ariaLabel?: string;
}

export function ChatTurnNavigationRail({
  navigation,
  className,
  markerClassName,
  tooltipClassName,
  ariaLabel = "User messages",
}: ChatTurnNavigationRailProps) {
  const { store, getPreview, subscribePreview, viewportAdapter } = navigation;
  const tooltipId = useId();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [previewState, setPreviewState] = useState<{
    itemId: string;
    top: number;
  }>();
  const items = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const previewedItem = items.find((item) => item.id === previewState?.itemId);
  const [, setPreviewRevision] = useState(0);
  const [visibleTurnIds, setVisibleTurnIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setVisibleTurnIds(new Set());
    const viewport = viewportAdapter.getScrollElement();
    if (!viewport || items.length === 0 || typeof IntersectionObserver === "undefined") return;

    const turnIds = new Set(items.map((item) => item.turnId));
    const observed = new Map<Element, boolean>();
    let active = true;
    const publish = () => {
      const next = new Set<string>();
      for (const [element, visible] of observed) {
        if (visible) next.add(element.getAttribute("data-turn-id")!);
      }
      setVisibleTurnIds((current) => current.size === next.size &&
        [...next].every((id) => current.has(id)) ? current : next);
    };
    const observer = new IntersectionObserver((entries) => {
      if (!active) return;
      for (const entry of entries) {
        if (observed.has(entry.target)) {
          observed.set(entry.target, entry.isIntersecting &&
            entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0);
        }
      }
      publish();
    }, { root: viewport, threshold: [0, 0.000001] });

    const syncElements = () => {
      const elements = new Set(
        [...viewport.querySelectorAll("[data-turn-id]")]
          .filter((element) => turnIds.has(element.getAttribute("data-turn-id")!)),
      );
      for (const element of observed.keys()) {
        if (!elements.has(element)) {
          observer.unobserve(element);
          observed.delete(element);
        }
      }
      for (const element of elements) {
        if (!observed.has(element)) {
          observed.set(element, false);
          observer.observe(element);
        }
      }
      publish();
    };
    syncElements();
    const mutations = new MutationObserver((records) => {
      // Only rescan when Turn containers mount/unmount, not for streamed text.
      if (records.some((record) => [...record.addedNodes, ...record.removedNodes]
        .some((node) => node instanceof Element &&
          (node.matches("[data-turn-id]") || node.querySelector("[data-turn-id]"))))) {
        syncElements();
      }
    });
    mutations.observe(viewport, { childList: true, subtree: true });
    return () => {
      active = false;
      mutations.disconnect();
      observer.disconnect();
    };
  }, [items, viewportAdapter]);

  useEffect(() => {
    if (!previewedItem || !subscribePreview) {
      return;
    }

    return subscribePreview(previewedItem, () => {
      setPreviewRevision((revision) => revision + 1);
    });
  }, [previewedItem, subscribePreview]);

  const preview = previewedItem && getPreview
    ? getPreview(previewedItem)
    : undefined;

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip || !previewState) return;

    const layout = tooltip.offsetParent ?? tooltip.parentElement;
    if (!(layout instanceof HTMLElement)) return;

    const layoutHeight = layout.getBoundingClientRect().height;
    const tooltipHeight = tooltip.getBoundingClientRect().height;
    if (layoutHeight <= 0 || tooltipHeight <= 0) return;

    const edgePadding = 8;
    const halfTooltipHeight = tooltipHeight / 2;
    const minimumTop = halfTooltipHeight + edgePadding;
    const maximumTop = layoutHeight - halfTooltipHeight - edgePadding;
    const nextTop = minimumTop <= maximumTop
      ? Math.min(maximumTop, Math.max(minimumTop, previewState.top))
      : layoutHeight / 2;

    if (Math.abs(nextTop - previewState.top) > 0.5) {
      setPreviewState((current) => current
        ? { ...current, top: nextTop }
        : current);
    }
  }, [preview, previewState]);

  if (items.length === 0) {
    return null;
  }

  const showPreview = (
    itemId: string,
    event: ReactMouseEvent<HTMLButtonElement> | ReactFocusEvent<HTMLButtonElement>,
  ) => {
    const markerRect = event.currentTarget.getBoundingClientRect();
    const layoutRect = event.currentTarget.parentElement?.parentElement
      ?.getBoundingClientRect();
    setPreviewState({
      itemId,
      top: layoutRect
        ? markerRect.top - layoutRect.top + markerRect.height / 2
        : markerRect.top + markerRect.height / 2,
    });
  };

  const scrollRail = (event: ReactWheelEvent<HTMLElement>) => {
    const rail = event.currentTarget;
    if (rail.scrollHeight <= rail.clientHeight) {
      return;
    }

    const previousScrollTop = rail.scrollTop;
    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * rail.clientHeight
        : event.deltaY;
    rail.scrollTop += delta;

    if (rail.scrollTop !== previousScrollTop) {
      event.preventDefault();
      event.stopPropagation();
      setPreviewState(undefined);
    }
  };

  return (
    <>
      <nav
        className={className}
        aria-label={ariaLabel}
        onMouseLeave={() => setPreviewState(undefined)}
        onWheel={scrollRail}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            className={markerClassName}
            type="button"
            aria-label={`Jump to user message ${index + 1}`}
            data-visible={visibleTurnIds.has(item.turnId) ? "true" : undefined}
            aria-current={visibleTurnIds.has(item.turnId) ? "true" : undefined}
            aria-describedby={
              previewState?.itemId === item.id && preview ? tooltipId : undefined
            }
            onMouseEnter={(event) => showPreview(item.id, event)}
            onMouseMove={(event) => {
              if (previewState?.itemId !== item.id) {
                showPreview(item.id, event);
              }
            }}
            onFocus={(event) => showPreview(item.id, event)}
            onBlur={() => setPreviewState(undefined)}
            onClick={() => navigation.navigate(item)}
          />
        ))}
      </nav>
      {preview ? (
        <div
          ref={tooltipRef}
          id={tooltipId}
          className={tooltipClassName}
          role="tooltip"
          aria-label={preview.ariaLabel}
          style={{ top: previewState?.top }}
        >
          <strong>{preview.title}</strong>
          {preview.body ? <div>{preview.body}</div> : null}
        </div>
      ) : null}
    </>
  );
}
