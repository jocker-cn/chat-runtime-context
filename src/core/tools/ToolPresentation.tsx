import {
  createContext, useCallback, useContext, useEffect, useId, useMemo,
  useRef, useState, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./ToolPresentation.module.css";

export interface ToolDialogHandle {
  close(): void;
}

/** Runtime React composition, not a persisted tool definition. */
export interface ToolDialogRequest {
  title: string;
  size?: "small" | "medium" | "large";
  render(handle: ToolDialogHandle): ReactNode;
}

export interface ToolPresentationAPI {
  openDialog(request: ToolDialogRequest): ToolDialogHandle;
}

const Context = createContext<ToolPresentationAPI | null>(null);

export function useToolPresentation() {
  const api = useContext(Context);
  if (!api) throw new Error("useToolPresentation requires ToolPresentationProvider.");
  return api;
}

/** Optional shared shell. Tools own their content, validation and confirmation. */
export function ToolPresentationProvider({ children }: { children: ReactNode }) {
  const nextDialogId = useRef(0);
  const [dialog, setDialog] = useState<{
    id: number;
    request: ToolDialogRequest;
    handle: ToolDialogHandle;
  }>();
  const openDialog = useCallback((request: ToolDialogRequest) => {
    const handle: ToolDialogHandle = {
      close: () => setDialog((current) => current?.handle === handle ? undefined : current),
    };
    setDialog({ id: ++nextDialogId.current, request, handle });
    return handle;
  }, []);
  const api = useMemo(() => ({ openDialog }), [openDialog]);
  return (
    <Context.Provider value={api}>
      {children}
      {dialog && <ToolDialog key={dialog.id} request={dialog.request} handle={dialog.handle} />}
    </Context.Provider>
  );
}

function ToolDialog({ request, handle }: {
  request: ToolDialogRequest;
  handle: ToolDialogHandle;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    panel?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handle.close();
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), [tabindex="0"], [contenteditable="true"]',
      )].filter((element) => !element.hidden && !element.closest('[hidden], [inert]'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault(); first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (panel && event.target instanceof Node && !panel.contains(event.target)) panel.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [handle]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.backdrop} onClick={(event) => {
      if (event.target === event.currentTarget) handle.close();
    }}>
      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1} className={styles.dialog} data-size={request.size ?? "medium"}
      >
        <header className={styles.header}>
          <h2 id={titleId}>{request.title}</h2>
          <button type="button" onClick={handle.close} aria-label="关闭工具弹窗">×</button>
        </header>
        <div className={styles.content}>{request.render(handle)}</div>
      </div>
    </div>, document.body,
  );
}
