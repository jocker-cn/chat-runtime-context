import type { Message } from "@ag-ui/client";
import type {
  ChatCancelTarget,
  ChatBranchSelectionInput,
  ChatMetadata,
  ChatMode,
  ChatRunHandle,
  ChatRunOptions,
  ChatRuntime,
  ChatRuntimeResetOptions,
  ChatRuntimeSnapshot,
} from "../contracts/chat-runtime";
import { ListenerSet } from "../internal/ListenerSet";

export interface CreateChatRuntimeSnapshotOptions {
  mode?: ChatMode;
  threadId?: string;
}

export function createInitialChatRuntimeSnapshot<
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
>(
  options: CreateChatRuntimeSnapshotOptions = {},
): ChatRuntimeSnapshot<TMessage, TTurnMetadata, TBranchMetadata> {
  return {
    mode: options.mode ?? "single",
    threadId: options.threadId,
    status: "idle",
    activeTurnId: undefined,
    turnIds: [],
    turnsById: {},
    branchesById: {},
    error: undefined,
  };
}

export abstract class BaseChatRuntime<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> implements ChatRuntime<TInput, TMessage, TTurnMetadata, TBranchMetadata>
{
  private readonly listeners = new ListenerSet();
  private disposed = false;

  protected snapshot: ChatRuntimeSnapshot<
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >;

  protected constructor(
    initialSnapshot: ChatRuntimeSnapshot<
      TMessage,
      TTurnMetadata,
      TBranchMetadata
    >,
  ) {
    this.snapshot = initialSnapshot;
  }

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.assertNotDisposed();
    return this.listeners.add(listener);
  };

  public readonly getSnapshot = (): ChatRuntimeSnapshot<
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  > => {
    return this.snapshot;
  };

  public abstract send(
    input: TInput,
    options?: ChatRunOptions<TMessage>,
  ): Promise<ChatRunHandle>;

  public cancel(_target?: ChatCancelTarget): Promise<void> | void {
    this.assertNotDisposed();
  }

  public selectBranch(
    _turnId: string,
    _branchId: string,
    _selection: ChatBranchSelectionInput = {},
  ): Promise<void> | void {
    this.assertNotDisposed();
  }

  public reset(options: ChatRuntimeResetOptions = {}): Promise<void> | void {
    this.assertNotDisposed();
    this.commitSnapshot(
      createInitialChatRuntimeSnapshot<
        TMessage,
        TTurnMetadata,
        TBranchMetadata
      >({
        mode: options.mode ?? this.snapshot.mode,
        threadId: options.threadId ?? this.snapshot.threadId,
      }),
    );
  }

  public dispose(): Promise<void> | void {
    if (this.disposed) return;

    this.disposed = true;
    this.listeners.clear();
    this.snapshot = {
      ...this.snapshot,
      status: "closed",
    };
  }

  protected commitSnapshot(
    nextSnapshot: ChatRuntimeSnapshot<
      TMessage,
      TTurnMetadata,
      TBranchMetadata
    >,
  ) {
    this.assertNotDisposed();

    if (Object.is(nextSnapshot, this.snapshot)) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.emit();
  }

  protected updateSnapshot(
    updater: (
      previous: ChatRuntimeSnapshot<
        TMessage,
        TTurnMetadata,
        TBranchMetadata
      >,
    ) => ChatRuntimeSnapshot<TMessage, TTurnMetadata, TBranchMetadata>,
  ) {
    this.commitSnapshot(updater(this.snapshot));
  }

  protected patchSnapshot(
    patch: Partial<
      ChatRuntimeSnapshot<TMessage, TTurnMetadata, TBranchMetadata>
    >,
  ) {
    const keys = Object.keys(patch) as Array<
      keyof ChatRuntimeSnapshot<TMessage, TTurnMetadata, TBranchMetadata>
    >;

    if (
      keys.every((key) => Object.is(this.snapshot[key], patch[key]))
    ) {
      return;
    }

    this.commitSnapshot({
      ...this.snapshot,
      ...patch,
    });
  }

  protected assertNotDisposed() {
    if (this.disposed) {
      throw new Error("ChatRuntime has been disposed.");
    }
  }

  private emit() {
    this.listeners.emit();
  }
}
