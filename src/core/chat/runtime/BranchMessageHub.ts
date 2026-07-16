import type { Message } from "@ag-ui/client";
import type {
  BranchMessageSelector,
  BranchMessageSelectorContext,
  MessageReader,
} from "../contracts/chat-runtime";

export interface BranchMessageScopeOptions<
  TMessage extends Message = Message,
> {
  id: string;
  context: BranchMessageSelectorContext;
  selector?: BranchMessageSelector<TMessage>;
  baselineMessages?: readonly TMessage[];
  inputMessageIds?: readonly string[];
  messageIds?: readonly string[];
  trackNewMessages?: boolean;
}

export interface BranchMessageScope<TMessage extends Message = Message>
  extends MessageReader<TMessage> {
  readonly id: string;
  dispose(): void;
  getMessageIds(options: { includeInput: boolean }): ReadonlySet<string>;
  /** Commits the current source projection and ignores later source changes. */
  stopTracking(): void;
}

export type BranchMessageHubFrameClock = (
  callback: () => void,
) => () => void;

export interface BranchMessageHubOptions {
  scheduleFrame?: BranchMessageHubFrameClock;
}

type SnapshotMode = "initial" | "live" | "terminal";

export class BranchMessageHub<TMessage extends Message = Message> {
  private readonly source: MessageReader<TMessage>;
  private readonly frameScheduler: FrameScheduler;
  private readonly scopes = new Map<
    string,
    InternalBranchMessageScope<TMessage>
  >();
  private readonly trackingScopeIds = new Set<string>();
  private readonly dirtyScopes = new Set<
    InternalBranchMessageScope<TMessage>
  >();
  private messagesById: ReadonlyMap<string, TMessage>;
  private positionsById: ReadonlyMap<string, number>;
  private readonly unsubscribe: () => void;
  private sourceDirty = false;
  private flushing = false;
  private disposed = false;

  constructor(
    source: MessageReader<TMessage>,
    options: BranchMessageHubOptions = {},
  ) {
    this.source = source;
    this.frameScheduler = new FrameScheduler(
      options.scheduleFrame ?? scheduleBrowserFrame,
      this.flushFrame,
    );
    const messages = source.getMessages();
    this.messagesById = createMessageMap(messages);
    this.positionsById = createPositionMap(messages);
    this.unsubscribe = source.subscribe(this.handleSourceChange);
  }

  createScope(
    options: BranchMessageScopeOptions<TMessage>,
  ): BranchMessageScope<TMessage> {
    if (this.disposed) {
      throw new Error("Cannot create a scope on a disposed BranchMessageHub.");
    }

    if (this.scopes.has(options.id)) {
      throw new Error(`Branch message scope "${options.id}" already exists.`);
    }

    // A frame may still be pending when a history scope is restored. Commit
    // that pending source revision before the scope reads the hub index.
    if (this.sourceDirty) {
      this.reconcileSource();
    }

    const scope = new InternalBranchMessageScope<TMessage>(
      options,
      () => this.removeScope(options.id),
      () => this.stopTrackingScope(options.id),
    );
    this.scopes.set(scope.id, scope);
    if (scope.isTracking()) {
      this.trackingScopeIds.add(scope.id);
    }
    this.updateScope(scope, "initial");

    return scope;
  }

  dispose() {
    if (this.disposed) return;

    this.disposed = true;
    this.unsubscribe();
    this.frameScheduler.dispose();
    this.sourceDirty = false;
    this.dirtyScopes.clear();
    [...this.scopes.values()].forEach((scope) => scope.dispose());
    this.scopes.clear();
    this.trackingScopeIds.clear();
  }

  private readonly handleSourceChange = () => {
    if (this.disposed) return;

    this.sourceDirty = true;
    this.scheduleFlush();
  };

  private reconcileSource(terminalScopeId?: string) {
    if (this.disposed) return;

    this.sourceDirty = false;
    const previousMessagesById = this.messagesById;
    const nextMessages = this.source.getMessages();
    const nextMessagesById = createMessageMap(nextMessages);
    const nextPositionsById = createPositionMap(nextMessages);
    const addedMessageIds = nextMessages
      .filter((message) => !previousMessagesById.has(message.id))
      .map((message) => message.id);

    this.messagesById = nextMessagesById;
    this.positionsById = nextPositionsById;

    this.trackingScopeIds.forEach((scopeId) => {
      const scope = this.scopes.get(scopeId);
      if (!scope) return;

      addedMessageIds.forEach((messageId) => {
        scope.trackMessage(messageId);
      });
      this.updateScope(
        scope,
        scope.id === terminalScopeId ? "terminal" : "live",
      );
    });
  }

  private updateScope(
    scope: InternalBranchMessageScope<TMessage>,
    mode: SnapshotMode,
  ) {
    const messages = [...scope.getIndexedMessageIds()]
      .map((messageId) => this.messagesById.get(messageId))
      .filter((message): message is TMessage => Boolean(message))
      .sort(
        (left, right) =>
          (this.positionsById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (this.positionsById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      );
    const selectedMessages = scope.select(messages);
    const liveMessageId = findLatestSelectedMessageId(
      messages,
      selectedMessages,
    );

    if (scope.setSnapshot(selectedMessages, mode, liveMessageId)) {
      this.markScopeDirty(scope);
    }
  }

  private stopTrackingScope(scopeId: string) {
    const scope = this.scopes.get(scopeId);
    if (!scope || !scope.isTracking()) return;

    // Commit the source's current value synchronously. Subscriber delivery is
    // still frame-coalesced, but stop/cancel callers can read the terminal
    // snapshot immediately and no final delta is lost.
    if (this.sourceDirty) {
      this.reconcileSource(scopeId);
    } else {
      this.updateScope(scope, "terminal");
    }
    this.trackingScopeIds.delete(scopeId);
  }

  private markScopeDirty(scope: InternalBranchMessageScope<TMessage>) {
    if (this.disposed || !scope.hasListeners()) return;

    this.dirtyScopes.add(scope);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (
      this.disposed ||
      this.flushing ||
      (!this.sourceDirty && this.dirtyScopes.size === 0)
    ) {
      return;
    }

    this.frameScheduler.request();
  }

  private readonly flushFrame = () => {
    if (this.disposed || this.flushing) return;

    this.flushing = true;
    try {
      if (this.sourceDirty) {
        this.reconcileSource();
      }

      const scopes = [...this.dirtyScopes];
      this.dirtyScopes.clear();
      scopes.forEach((scope) => scope.notify());
    } finally {
      this.flushing = false;
      this.scheduleFlush();
    }
  };

  private removeScope(scopeId: string) {
    const scope = this.scopes.get(scopeId);
    if (!scope) return;

    this.scopes.delete(scopeId);
    this.trackingScopeIds.delete(scopeId);
    this.dirtyScopes.delete(scope);
  }
}

class InternalBranchMessageScope<TMessage extends Message>
  implements BranchMessageScope<TMessage>
{
  public readonly id: string;
  private readonly baselineMessageIds: ReadonlySet<string>;
  private readonly inputMessageIds: ReadonlySet<string>;
  private readonly messageIds = new Set<string>();
  private readonly selector?: BranchMessageSelector<TMessage>;
  private readonly context: BranchMessageSelectorContext;
  private readonly onDispose: () => void;
  private readonly onStopTracking: () => void;
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly TMessage[] = [];
  private messageSignatures: ReadonlyMap<string, string> = new Map();
  private liveMessageId?: string;
  private tracking: boolean;
  private disposed = false;

  constructor(
    options: BranchMessageScopeOptions<TMessage>,
    onDispose: () => void,
    onStopTracking: () => void,
  ) {
    this.id = options.id;
    this.context = options.context;
    this.selector = options.selector;
    this.baselineMessageIds = new Set(
      options.baselineMessages?.map((message) => message.id) ?? [],
    );
    this.inputMessageIds = new Set(options.inputMessageIds ?? []);
    options.messageIds?.forEach((messageId) => {
      this.messageIds.add(messageId);
    });
    this.tracking = options.trackNewMessages ?? false;
    this.onDispose = onDispose;
    this.onStopTracking = onStopTracking;
  }

  subscribe = (listener: () => void) => {
    if (this.disposed) {
      return () => undefined;
    }

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  getMessages = () => this.snapshot;

  getMessageIds({ includeInput }: { includeInput: boolean }) {
    const messageIds = new Set(this.messageIds);

    if (includeInput) {
      this.inputMessageIds.forEach((messageId) => {
        messageIds.add(messageId);
      });
    }

    return messageIds;
  }

  stopTracking() {
    if (!this.tracking || this.disposed) return;

    this.onStopTracking();
    this.tracking = false;
  }

  dispose() {
    if (this.disposed) return;

    this.disposed = true;
    this.tracking = false;
    this.listeners.clear();
    this.onDispose();
  }

  isTracking() {
    return this.tracking;
  }

  hasListeners() {
    return this.listeners.size > 0;
  }

  getIndexedMessageIds() {
    return this.messageIds;
  }

  trackMessage(messageId: string) {
    if (
      this.baselineMessageIds.has(messageId) ||
      this.inputMessageIds.has(messageId) ||
      this.messageIds.has(messageId)
    ) {
      return false;
    }

    this.messageIds.add(messageId);
    return true;
  }

  select(messages: readonly TMessage[]) {
    return this.selector ? this.selector(messages, this.context) : messages;
  }

  setSnapshot(
    messages: readonly TMessage[],
    mode: SnapshotMode,
    liveMessageId: string | undefined,
  ) {
    const materialized = materializeSnapshot(
      this.snapshot,
      this.messageSignatures,
      messages,
      mode,
      this.liveMessageId,
      liveMessageId,
    );
    this.messageSignatures = materialized.signatures;
    this.liveMessageId = liveMessageId;
    if (areMessageListsEqual(this.snapshot, materialized.messages)) {
      return false;
    }

    this.snapshot = materialized.messages;
    return true;
  }

  notify() {
    if (this.disposed) return;

    const listeners = [...this.listeners];
    listeners.forEach((listener) => {
      if (this.listeners.has(listener)) {
        listener();
      }
    });
  }
}

function materializeSnapshot<TMessage extends Message>(
  previous: readonly TMessage[],
  previousSignatures: ReadonlyMap<string, string>,
  next: readonly TMessage[],
  mode: SnapshotMode,
  previousLiveMessageId: string | undefined,
  nextLiveMessageId: string | undefined,
): {
  messages: readonly TMessage[];
  signatures: ReadonlyMap<string, string>;
} {
  if (mode === "initial") {
    const signatures = new Map<string, string>();
    const messages = next.map((message) => {
      const signature = createMessageSignature(message);
      if (signature !== undefined) {
        signatures.set(message.id, signature);
      }
      return cloneMessage(message, signature);
    });

    return {
      messages,
      signatures,
    };
  }

  const previousById = createMessageMap(previous);
  const signatures = new Map<string, string>();

  // AG-UI may clone the full list for one delta. Live frames only materialize
  // the latest source message; the terminal pass uses signatures to keep
  // unchanged identities while accepting a late correction to any message.
  const messages = next.map((message) => {
    const previousMessage = previousById.get(message.id);
    const previousSignature = previousSignatures.get(message.id);
    const isLiveMessage = message.id === nextLiveMessageId;
    const isCompletingPreviousLiveMessage =
      message.id === previousLiveMessageId &&
      previousLiveMessageId !== nextLiveMessageId;
    const shouldRefreshLiveMessage =
      !previousMessage || isLiveMessage || isCompletingPreviousLiveMessage;
    const shouldRefresh = mode === "terminal" || shouldRefreshLiveMessage;
    const nextSignature =
      shouldRefresh ? createMessageSignature(message) : undefined;
    const canReuseMessage =
      shouldRefresh &&
      previousMessage &&
      nextSignature !== undefined &&
      previousSignature === nextSignature;

    if (canReuseMessage) {
      signatures.set(message.id, nextSignature);
      return previousMessage;
    }

    if (shouldRefresh) {
      if (nextSignature !== undefined) {
        signatures.set(message.id, nextSignature);
      }
      return cloneMessage(message, nextSignature);
    }

    if (previousSignature !== undefined) {
      signatures.set(message.id, previousSignature);
    }
    return previousMessage;
  });

  return {
    messages,
    signatures,
  };
}

function cloneMessage<TMessage extends Message>(
  message: TMessage,
  signature?: string,
): TMessage {
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(message);
    } catch {
      // AG-UI messages are normally structured-cloneable. Fall through for
      // custom Message extensions that contain unsupported values.
    }
  }

  if (signature !== undefined) {
    return JSON.parse(signature) as TMessage;
  }

  return { ...message } as TMessage;
}

function findLatestSelectedMessageId<TMessage extends Message>(
  sourceMessages: readonly TMessage[],
  selectedMessages: readonly TMessage[],
) {
  if (sourceMessages === selectedMessages) {
    return sourceMessages.at(-1)?.id;
  }

  const selectedIds = new Set(
    selectedMessages.map((message) => message.id),
  );

  for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
    const message = sourceMessages[index];
    if (message && selectedIds.has(message.id)) {
      return message.id;
    }
  }

  return selectedMessages.at(-1)?.id;
}

function createMessageSignature(message: Message): string | undefined {
  try {
    return JSON.stringify(message);
  } catch {
    return undefined;
  }
}

function createMessageMap<TMessage extends Message>(
  messages: readonly TMessage[],
) {
  return new Map(messages.map((message) => [message.id, message]));
}

function createPositionMap<TMessage extends Message>(
  messages: readonly TMessage[],
) {
  return new Map(messages.map((message, index) => [message.id, index]));
}

function areMessageListsEqual<TMessage extends Message>(
  previous: readonly TMessage[],
  next: readonly TMessage[],
) {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;

  return previous.every((message, index) => message === next[index]);
}

interface ScheduledFrameToken {
  cancel?: () => void;
}

type FrameSchedulerState =
  | { phase: "idle" }
  | { phase: "scheduled"; token: ScheduledFrameToken }
  | { phase: "disposed" };

/**
 * Owns the single pending redraw request. The injected clock follows the
 * requestAnimationFrame contract: registration is synchronous, delivery is
 * asynchronous. Production also uses an asynchronous timer fallback.
 */
class FrameScheduler {
  private state: FrameSchedulerState = { phase: "idle" };

  constructor(
    private readonly scheduleFrame: BranchMessageHubFrameClock,
    private readonly onFrame: () => void,
  ) {}

  request() {
    if (this.state.phase !== "idle") return;

    const token: ScheduledFrameToken = {};
    this.state = { phase: "scheduled", token };

    try {
      const cancel = this.scheduleFrame(() => this.emit(token));
      if (
        this.state.phase === "scheduled" &&
        this.state.token === token
      ) {
        token.cancel = cancel;
      } else {
        cancel();
      }
    } catch (error) {
      if (
        this.state.phase === "scheduled" &&
        this.state.token === token
      ) {
        this.state = { phase: "idle" };
      }
      throw error;
    }
  }

  dispose() {
    if (this.state.phase === "disposed") return;

    const cancel =
      this.state.phase === "scheduled"
        ? this.state.token.cancel
        : undefined;
    this.state = { phase: "disposed" };
    cancel?.();
  }

  private emit(token: ScheduledFrameToken) {
    if (
      this.state.phase !== "scheduled" ||
      this.state.token !== token
    ) {
      return;
    }

    this.state = { phase: "idle" };
    this.onFrame();
  }
}

const scheduleBrowserFrame: BranchMessageHubFrameClock = (callback) => {
  if (typeof globalThis.requestAnimationFrame === "function") {
    const frameId = globalThis.requestAnimationFrame(callback);

    return () => {
      globalThis.cancelAnimationFrame?.(frameId);
    };
  }

  const timeoutId = globalThis.setTimeout(callback, 16);

  return () => {
    globalThis.clearTimeout(timeoutId);
  };
};
