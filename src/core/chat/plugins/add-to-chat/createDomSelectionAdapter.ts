import type { AddToChatController } from "./createAddToChatController";
import type {
  AddToChatSourceContext,
  ContextReferenceSource,
} from "./contracts";

export interface ObserveDomSelectionOptions {
  readonly root: HTMLElement;
  readonly controller: AddToChatController;
  readonly resolveSource?: (
    context: AddToChatSourceContext,
  ) => ContextReferenceSource | null;
}

export function observeDomSelection({
  root,
  controller,
  resolveSource = resolveDefaultSource,
}: ObserveDomSelectionOptions): () => void {
  let disposed = false;
  let frame = 0;

  const sync = () => {
    if (disposed) return;

    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      controller.setSelection(undefined);
      return;
    }

    const range = selection.getRangeAt(0);
    const startElement = toElement(range.startContainer);
    const endElement = toElement(range.endContainer);
    if (
      !startElement ||
      !endElement ||
      !root.contains(startElement) ||
      !root.contains(endElement) ||
      !hasUnambiguousSource(startElement, endElement)
    ) {
      controller.setSelection(undefined);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      controller.setSelection(undefined);
      return;
    }

    const source = resolveSource({
      range,
      root,
      startElement,
      endElement,
    });
    if (!source) {
      controller.setSelection(undefined);
      return;
    }

    const rect = getRangeRect(range);
    controller.setSelection({
      text,
      source,
      anchor: {
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      },
    });
  };

  const scheduleSync = () => {
    cancelFrame(frame);
    frame = requestFrame(sync);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    document.getSelection()?.removeAllRanges();
    controller.setSelection(undefined);
  };

  document.addEventListener("selectionchange", scheduleSync);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", scheduleSync);
  window.addEventListener("scroll", scheduleSync, true);
  scheduleSync();

  return () => {
    disposed = true;
    cancelFrame(frame);
    document.removeEventListener("selectionchange", scheduleSync);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", scheduleSync);
    window.removeEventListener("scroll", scheduleSync, true);
    controller.setSelection(undefined);
  };
}

function requestFrame(callback: FrameRequestCallback): number {
  return typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : window.setTimeout(() => callback(performance.now()), 0);
}

function cancelFrame(frame: number): void {
  if (!frame) return;
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frame);
  } else {
    window.clearTimeout(frame);
  }
}

function resolveDefaultSource({
  root,
  startElement,
}: AddToChatSourceContext): ContextReferenceSource | null {
  const frame = startElement.closest<HTMLElement>("[data-frame-id]");
  const branch = startElement.closest<HTMLElement>("[data-branch-id]");
  const turn = startElement.closest<HTMLElement>("[data-turn-id]");
  const thread =
    startElement.closest<HTMLElement>("[data-chat-thread-id]") ??
    root.closest<HTMLElement>("[data-chat-thread-id]");
  if (!frame && !turn) return null;

  return {
    type: frame ? "chat-frame" : "chat-turn",
    threadId: thread?.dataset.chatThreadId,
    turnId: turn?.dataset.turnId,
    branchId: branch?.dataset.branchId,
    frameId: frame?.dataset.frameId,
  };
}

function hasUnambiguousSource(start: Element, end: Element) {
  const startFrame = start.closest<HTMLElement>("[data-frame-id]");
  const endFrame = end.closest<HTMLElement>("[data-frame-id]");
  if (startFrame || endFrame) return startFrame === endFrame;

  const startTurn = start.closest<HTMLElement>("[data-turn-id]");
  const endTurn = end.closest<HTMLElement>("[data-turn-id]");
  return Boolean(startTurn && startTurn === endTurn);
}

function toElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

function getRangeRect(range: Range): DOMRect {
  if (typeof range.getBoundingClientRect === "function") {
    return range.getBoundingClientRect();
  }

  return {
    x: 0,
    y: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  };
}
