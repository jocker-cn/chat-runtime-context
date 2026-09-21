export interface ContextReference {
  readonly id: string;
  readonly type: "text-selection";
  readonly text: string;
  readonly source: ContextReferenceSource;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ContextReferenceSource {
  readonly type: string;
  readonly title?: string;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly branchId?: string;
  readonly frameId?: string;
  readonly messageId?: string;
  readonly pluginId?: string;
  readonly targetId?: string;
}

export interface AddToChatAnchor {
  readonly x: number;
  readonly y: number;
}

export interface AddToChatSelection {
  readonly text: string;
  readonly source: ContextReferenceSource;
  readonly anchor: AddToChatAnchor;
}

export interface AddToChatSnapshot {
  readonly selection?: AddToChatSelection;
  readonly references: readonly ContextReference[];
}

export interface AddToChatRegistration {
  readonly id: string;
  getReferences(): readonly ContextReference[];
  clearReferences(): void;
  subscribeReferences(listener: () => void): () => void;
}

export type AddToChatElementTarget =
  | string
  | (() => HTMLElement | null);

export interface AddToChatSourceContext {
  readonly range: Range;
  readonly root: HTMLElement;
  readonly startElement: Element;
  readonly endElement: Element;
}

export interface RegisterAddToChatOptions {
  readonly id: string;
  readonly selectionRoot: AddToChatElementTarget;
  readonly referenceHost: AddToChatElementTarget;
  readonly overlayHost?: AddToChatElementTarget;
  readonly resolveSource?: (
    context: AddToChatSourceContext,
  ) => ContextReferenceSource | null;
  readonly createReferenceId?: () => string;
}
