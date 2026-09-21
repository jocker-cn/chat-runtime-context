import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import type { AddToChatController } from "./createAddToChatController";

export interface AddToChatViewProps {
  readonly controller: AddToChatController;
  readonly overlayHost: HTMLElement;
  readonly referenceHost: HTMLElement;
}

export function AddToChatView({
  controller,
  overlayHost,
  referenceHost,
}: AddToChatViewProps) {
  const snapshot = useSyncExternalStore(
    controller.store.subscribe,
    controller.store.getSnapshot,
    controller.store.getSnapshot,
  );

  return (
    <>
      {createPortal(<style>{styles}</style>, overlayHost)}
      {snapshot.selection
        ? createPortal(
            <button
              className="crt-add-to-chat-action"
              type="button"
              style={{
                left: snapshot.selection.anchor.x,
                top: snapshot.selection.anchor.y,
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                controller.addSelection();
                document.getSelection()?.removeAllRanges();
              }}
            >
              Add to chat
            </button>,
            overlayHost,
          )
        : null}
      {createPortal(
        snapshot.references.length > 0 ? (
          <div
            className="crt-add-to-chat-references"
            aria-label="Chat references"
          >
            {snapshot.references.map((reference, index) => (
              <div
                className="crt-add-to-chat-reference"
                key={reference.id}
              >
                <strong>{reference.source.title ?? `Reference ${index + 1}`}</strong>
                <span title={reference.text}>{reference.text}</span>
                <button
                  type="button"
                  aria-label={`Remove reference ${index + 1}`}
                  title={`Remove reference ${index + 1}`}
                  onClick={() => controller.removeReference(reference.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null,
        referenceHost,
      )}
    </>
  );
}

const styles = `
.crt-add-to-chat-action {
  position: fixed;
  z-index: 2147483000;
  transform: translateX(-50%);
  border: 0;
  border-radius: 999px;
  background: #182026;
  box-shadow: 0 6px 18px rgba(24, 32, 38, 0.24);
  color: #fff;
  cursor: pointer;
  font: 600 13px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
  padding: 8px 12px;
}
.crt-add-to-chat-action:focus-visible {
  outline: 3px solid rgba(77, 111, 179, 0.4);
  outline-offset: 2px;
}
.crt-add-to-chat-references {
  display: grid;
  gap: 8px;
  grid-column: 1 / -1;
  min-width: 0;
}
.crt-add-to-chat-reference {
  align-items: center;
  border: 1px solid #cbd3dc;
  border-left: 3px solid #4d6fb3;
  border-radius: 6px;
  color: #526475;
  display: grid;
  font: 13px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
  gap: 8px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  padding: 8px 10px;
}
.crt-add-to-chat-reference strong {
  color: #334e7d;
  white-space: nowrap;
}
.crt-add-to-chat-reference span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crt-add-to-chat-reference button {
  border: 0 !important;
  background: transparent !important;
  color: #66788a !important;
  cursor: pointer;
  font-size: 18px !important;
  line-height: 1 !important;
  padding: 2px 4px !important;
}
@media (prefers-reduced-motion: no-preference) {
  .crt-add-to-chat-action { transition: opacity 100ms ease; }
}
`;
