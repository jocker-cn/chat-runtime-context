import {
  useId,
  useEffect,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useChatTurnNavigationContext } from "./ChatTurnNavigationProvider";

export interface ChatTurnNavigationRailProps {
  className?: string;
  markerClassName?: string;
  tooltipClassName?: string;
  ariaLabel?: string;
}

export function ChatTurnNavigationRail({
  className,
  markerClassName,
  tooltipClassName,
  ariaLabel = "User messages",
}: ChatTurnNavigationRailProps) {
  const {
    store,
    viewportAdapter,
    onUserNavigate,
    getPreview,
    subscribePreview,
  } =
    useChatTurnNavigationContext();
  const tooltipId = useId();
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

  useEffect(() => {
    if (!previewedItem || !subscribePreview) {
      return;
    }

    return subscribePreview(previewedItem, () => {
      setPreviewRevision((revision) => revision + 1);
    });
  }, [previewedItem, subscribePreview]);

  if (items.length === 0) {
    return null;
  }

  const preview = previewedItem && getPreview
    ? getPreview(previewedItem)
    : undefined;

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
            onClick={() => {
              void viewportAdapter.revealItem(
                {
                  item,
                  element: store.getAnchor(item.turnId),
                },
                {
                  behavior: "smooth",
                  align: "start",
                },
              );
              onUserNavigate?.(item);
            }}
          />
        ))}
      </nav>
      {preview ? (
        <div
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
