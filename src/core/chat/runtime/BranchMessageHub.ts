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
  stopTracking(): void;
}

export class BranchMessageHub<TMessage extends Message = Message> {
  private readonly source: MessageReader<TMessage>;
  private readonly scopes = new Map<
    string,
    InternalBranchMessageScope<TMessage>
  >();
  private readonly trackingScopeIds = new Set<string>();
  private readonly scopeIdsByMessageId = new Map<string, Set<string>>();
  private messages: readonly TMessage[];
  private messagesById: ReadonlyMap<string, TMessage>;
  private positionsById: ReadonlyMap<string, number>;
  private readonly unsubscribe: () => void;

  constructor(source: MessageReader<TMessage>) {
    this.source = source;
    this.messages = source.getMessages();
    this.messagesById = createMessageMap(this.messages);
    this.positionsById = createPositionMap(this.messages);
    this.unsubscribe = source.subscribe(this.handleSourceChange);
  }

  createScope(
    options: BranchMessageScopeOptions<TMessage>,
  ): BranchMessageScope<TMessage> {
    if (this.scopes.has(options.id)) {
      throw new Error(`Branch message scope "${options.id}" already exists.`);
    }

    const scope = new InternalBranchMessageScope<TMessage>(
      options,
      () => this.removeScope(options.id),
      () => this.trackingScopeIds.delete(options.id),
    );
    this.scopes.set(scope.id, scope);
    if (scope.isTracking()) {
      this.trackingScopeIds.add(scope.id);
    }
    scope.getIndexedMessageIds().forEach((messageId) => {
      this.attachMessage(scope.id, messageId);
    });
    this.updateScope(scope);

    return scope;
  }

  dispose() {
    this.unsubscribe();
    [...this.scopes.values()].forEach((scope) => scope.dispose());
    this.scopes.clear();
    this.trackingScopeIds.clear();
    this.scopeIdsByMessageId.clear();
  }

  private readonly handleSourceChange = () => {
    const previousMessages = this.messages;
    const previousMessagesById = this.messagesById;
    const previousPositionsById = this.positionsById;
    const nextMessages = this.source.getMessages();
    const nextMessagesById = createMessageMap(nextMessages);
    const nextPositionsById = createPositionMap(nextMessages);
    const affectedScopeIds = new Set<string>();
    const addedMessageIds: string[] = [];

    nextMessages.forEach((message, index) => {
      const previousMessage = previousMessagesById.get(message.id);

      if (!previousMessage) {
        addedMessageIds.push(message.id);
      }

      if (
        previousMessage !== message ||
        previousPositionsById.get(message.id) !== index
      ) {
        this.addAffectedScopes(message.id, affectedScopeIds);
      }
    });

    previousMessages.forEach((message) => {
      if (!nextMessagesById.has(message.id)) {
        this.addAffectedScopes(message.id, affectedScopeIds);
      }
    });

    this.trackingScopeIds.forEach((scopeId) => {
      const scope = this.scopes.get(scopeId);
      if (!scope) return;

      // Active messages may be mutated in place by an external store, so an
      // upstream notification always invalidates the active projection.
      affectedScopeIds.add(scope.id);

      addedMessageIds.forEach((messageId) => {
        if (scope.trackMessage(messageId)) {
          this.attachMessage(scope.id, messageId);
        }
      });
    });

    this.messages = nextMessages;
    this.messagesById = nextMessagesById;
    this.positionsById = nextPositionsById;

    affectedScopeIds.forEach((scopeId) => {
      const scope = this.scopes.get(scopeId);
      if (scope) {
        this.updateScope(scope);
      }
    });
  };

  private updateScope(scope: InternalBranchMessageScope<TMessage>) {
    const messages = [...scope.getIndexedMessageIds()]
      .map((messageId) => this.messagesById.get(messageId))
      .filter((message): message is TMessage => Boolean(message))
      .sort(
        (left, right) =>
          (this.positionsById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (this.positionsById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      );
    const selectedMessages = scope.select(messages);

    scope.setSnapshot(selectedMessages);
  }

  private attachMessage(scopeId: string, messageId: string) {
    const scopeIds = this.scopeIdsByMessageId.get(messageId) ?? new Set();
    scopeIds.add(scopeId);
    this.scopeIdsByMessageId.set(messageId, scopeIds);
  }

  private addAffectedScopes(messageId: string, target: Set<string>) {
    this.scopeIdsByMessageId.get(messageId)?.forEach((scopeId) => {
      target.add(scopeId);
    });
  }

  private removeScope(scopeId: string) {
    const scope = this.scopes.get(scopeId);
    if (!scope) return;

    this.scopes.delete(scopeId);
    this.trackingScopeIds.delete(scopeId);
    scope.getIndexedMessageIds().forEach((messageId) => {
      const scopeIds = this.scopeIdsByMessageId.get(messageId);
      if (!scopeIds) return;

      scopeIds.delete(scopeId);
      if (scopeIds.size === 0) {
        this.scopeIdsByMessageId.delete(messageId);
      }
    });
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
  private tracking: boolean;
  private disposed = false;
  private notificationScheduled = false;

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
    if (!this.tracking) return;

    this.tracking = false;
    this.onStopTracking();
  }

  dispose() {
    if (this.disposed) return;

    this.disposed = true;
    this.stopTracking();
    this.listeners.clear();
    this.onDispose();
  }

  isTracking() {
    return this.tracking;
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

  setSnapshot(messages: readonly TMessage[]) {
    if (areMessageListsEqual(this.snapshot, messages)) return;

    this.snapshot = messages;
    this.scheduleNotification();
  }

  private scheduleNotification() {
    if (this.notificationScheduled || this.listeners.size === 0) return;

    this.notificationScheduled = true;
    queueMicrotask(() => {
      this.notificationScheduled = false;
      if (this.disposed) return;

      [...this.listeners].forEach((listener) => listener());
    });
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
