import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface AddToChatProps {
  children: ReactNode;
  onAdd(text: string): void;
}

interface TextSelection {
  text: string;
  left: number;
  top: number;
}

export function AddToChat({ children, onAdd }: AddToChatProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<TextSelection>();

  const readSelection = useCallback(() => {
    const root = rootRef.current;
    const browserSelection = window.getSelection();

    if (
      !root ||
      !browserSelection ||
      browserSelection.isCollapsed ||
      browserSelection.rangeCount === 0
    ) {
      setSelection(undefined);
      return;
    }

    const range = browserSelection.getRangeAt(0);
    if (
      !root.contains(range.startContainer) ||
      !root.contains(range.endContainer)
    ) {
      setSelection(undefined);
      return;
    }

    const text = browserSelection.toString().trim();
    if (!text) {
      setSelection(undefined);
      return;
    }

    const rect = range.getBoundingClientRect();
    setSelection({
      text,
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [readSelection]);

  return (
    <div ref={rootRef}>
      {children}
      {selection
        ? createPortal(
            <button
              type="button"
              aria-label="Add selected text to chat"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                onAdd(selection.text);
                window.getSelection()?.removeAllRanges();
                setSelection(undefined);
              }}
              style={{
                position: "fixed",
                zIndex: 1000,
                left: selection.left,
                top: selection.top,
                transform: "translate(-50%, calc(-100% - 8px))",
                border: "1px solid #cbd3dc",
                borderRadius: 8,
                background: "#182026",
                color: "#fff",
                boxShadow: "0 4px 14px rgba(24, 32, 38, 0.2)",
                cursor: "pointer",
                font: "inherit",
                fontSize: 13,
                fontWeight: 700,
                padding: "7px 10px",
                whiteSpace: "nowrap",
              }}
            >
              Add to chat
            </button>,
            document.body,
          )
        : null}
    </div>
  );
}
