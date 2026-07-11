import type { Message } from "@ag-ui/client";
import type {
  ChatBranch,
  ChatBranchSelectionInput,
  ChatMetadata,
  ChatRunHandle,
  ChatRunOptions,
  ChatRuntimeResetOptions,
  ChatTurn,
  MessageReader,
} from "../contracts/chat-runtime";
import type {
  AnswerSourceConfig,
  ChatSourceRunContext,
} from "../source/answer-source";
import type { MessageStore } from "../source/message-store";
import { createMessageStore } from "../source/message-store";
import { BaseChatRuntime, createInitialChatRuntimeSnapshot } from "./BaseChatRuntime";
import type { BranchMessageScope } from "./BranchMessageHub";
import { BranchMessageHub } from "./BranchMessageHub";

export type ChatInputMessageFactory<
  TInput,
  TMessage extends Message,
> = (input: TInput, turnId: string) => TMessage | undefined;

export interface CompareChatRuntimeOptions<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
  TSourceMetadata extends ChatMetadata = ChatMetadata,
> {
  threadId?: string;
  sources: readonly AnswerSourceConfig<TInput, TMessage, TSourceMetadata>[];
  createInputMessage?: ChatInputMessageFactory<TInput, TMessage>;
  createTurnId?: () => string;
  createBranchId?: (
    source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    index: number,
  ) => string;
  historyTurns?: readonly CompareChatRuntimeHistoryTurn<
    TMessage,
    TTurnMetadata,
    TBranchMetadata
  >[];
  getTurnMetadata?: (
    input: TInput,
    options?: ChatRunOptions<TMessage>,
  ) => TTurnMetadata | undefined;
  getBranchMetadata?: (
    source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    index: number,
  ) => TBranchMetadata | undefined;
}

export interface CompareChatRuntimeHistoryTurn<
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
> {
  id: string;
  sourceBranchId?: string;
  inputMessage?: TMessage;
  inputMessageId?: string;
  messageIds: readonly string[];
  createdAt?: number;
  metadata?: TTurnMetadata;
  branchLabel?: string;
  branchMetadata?: TBranchMetadata;
  selection?: ChatBranchSelectionInput<TBranchMetadata>;
}

interface ActiveBranchRun<
  TInput,
  TMessage extends Message,
  TSourceMetadata extends ChatMetadata,
> {
  source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>;
  context: ChatSourceRunContext<TSourceMetadata>;
  controller: AbortController;
  messageStore?: MessageStore<TMessage>;
  messageScope?: BranchMessageScope<TMessage>;
}

export interface RemoveChatTurnOptions {
  deleteMessages?: boolean;
  includeInput?: boolean;
}

export class CompareChatRuntime<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
  TSourceMetadata extends ChatMetadata = ChatMetadata,
> extends BaseChatRuntime<TInput, TMessage, TTurnMetadata, TBranchMetadata> {
  private readonly sources: readonly AnswerSourceConfig<
    TInput,
    TMessage,
    TSourceMetadata
  >[];
  private readonly createInputMessage?: ChatInputMessageFactory<
    TInput,
    TMessage
  >;
  private readonly createTurnId: () => string;
  private readonly createBranchId: (
    source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    index: number,
  ) => string;
  private readonly getTurnMetadata?: (
    input: TInput,
    options?: ChatRunOptions<TMessage>,
  ) => TTurnMetadata | undefined;
  private readonly getBranchMetadata?: (
    source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    index: number,
  ) => TBranchMetadata | undefined;
  private readonly activeRuns = new Map<
    string,
    ActiveBranchRun<TInput, TMessage, TSourceMetadata>
  >();
  private readonly branchMessageScopesById = new Map<
    string,
    BranchMessageScope<TMessage>
  >();
  private readonly branchSourcesById = new Map<
    string,
    AnswerSourceConfig<TInput, TMessage, TSourceMetadata>
  >();
  private readonly messageHubs = new Map<
    MessageReader<TMessage>,
    BranchMessageHub<TMessage>
  >();

  constructor(
    options: CompareChatRuntimeOptions<
      TInput,
      TMessage,
      TTurnMetadata,
      TBranchMetadata,
      TSourceMetadata
    >,
  ) {
    super(
      createInitialChatRuntimeSnapshot<
        TMessage,
        TTurnMetadata,
        TBranchMetadata
      >({
        mode: options.sources.length > 1 ? "compare" : "single",
        threadId: options.threadId,
      }),
    );

    this.sources = options.sources;
    this.createInputMessage = options.createInputMessage;
    this.createTurnId = options.createTurnId ?? createDefaultId("turn");
    this.createBranchId =
      options.createBranchId ??
      ((source, index) => source.branchId ?? source.source.id ?? `branch-${index + 1}`);
    this.getTurnMetadata = options.getTurnMetadata;
    this.getBranchMetadata = options.getBranchMetadata;

    if (options.historyTurns?.length) {
      this.initializeHistoryTurns(options.historyTurns);
    }
  }

  public async send(
    input: TInput,
    options: ChatRunOptions<TMessage> = {},
  ): Promise<ChatRunHandle> {
    this.assertNotDisposed();

    const turnId = options.turnId ?? this.createTurnId();
    const sourceEntries = this.resolveSourceEntries(options.branchIds);
    const inputMessage =
      options.inputMessage ?? this.createInputMessage?.(input, turnId);
    const branchEntries = sourceEntries.map((entry) => ({
      ...entry,
      branchId: createRuntimeBranchId(turnId, entry.sourceBranchId),
    }));
    const branchIds = branchEntries.map(({ branchId }) => branchId);

    const turn: ChatTurn<TMessage, TTurnMetadata> = {
      id: turnId,
      inputMessage,
      inputMessageId: inputMessage?.id,
      branchIds,
      createdAt: Date.now(),
      metadata: this.getTurnMetadata?.(input, options),
    };

    const branchRunEntries = branchEntries.map((entry) => {
      const controller = new AbortController();
      const context: ChatSourceRunContext<TSourceMetadata> = {
        threadId: this.snapshot.threadId,
        turnId,
        branchId: entry.branchId,
        sourceId: entry.source.sourceId ?? entry.source.source.id,
        inputMessage,
        signal: controller.signal,
        metadata: entry.source.metadata,
      };
      const sourceMessageReader = entry.source.source.messageReader;
      const messageStore = sourceMessageReader
        ? undefined
        : createMessageStore<TMessage>();
      const messageScope = sourceMessageReader
        ? this.getMessageHub(sourceMessageReader).createScope({
            id: entry.branchId,
            context: {
              threadId: this.snapshot.threadId,
              turnId,
              branchId: entry.branchId,
              anchorMessageId: inputMessage?.id,
            },
            selector: entry.source.source.selectMessages,
            baselineMessages: sourceMessageReader.getMessages(),
            inputMessageIds: inputMessage ? [inputMessage.id] : [],
            trackNewMessages: true,
          })
        : undefined;
      const messageReader = messageScope ?? messageStore!;

      return {
        ...entry,
        messageReader,
        messageStore,
        messageScope,
        selectMessages: messageScope
          ? undefined
          : entry.source.source.selectMessages,
        controller,
        context,
      };
    });

    const branches = Object.fromEntries(
      branchRunEntries.map(({
        source,
        sourceBranchId,
        branchId,
        index,
        messageReader,
        selectMessages,
      }) => [
        branchId,
        {
          id: branchId,
          turnId,
          label: source.label ?? source.source.label,
          sourceId: source.sourceId ?? source.source.id ?? sourceBranchId,
          anchorMessageId: inputMessage?.id,
          messageReader,
          selectMessages,
          status: "idle",
          metadata: (
            this.getBranchMetadata?.(source, index) ?? source.metadata
          ) as TBranchMetadata | undefined,
        } satisfies ChatBranch<TMessage, TBranchMetadata>,
      ]),
    );

    branchRunEntries.forEach(({ branchId, source, messageScope }) => {
      this.branchSourcesById.set(branchId, source);
      if (messageScope) {
        this.branchMessageScopesById.set(branchId, messageScope);
      }
    });

    this.patchSnapshot({
      status: "running",
      error: undefined,
      activeTurnId: turnId,
      turnIds: [...this.snapshot.turnIds, turnId],
      turnsById: {
        ...this.snapshot.turnsById,
        [turnId]: turn,
      },
      branchesById: {
        ...this.snapshot.branchesById,
        ...branches,
      },
    });

    branchRunEntries.forEach(({
      source,
      branchId,
      messageStore,
      controller,
      context,
      messageScope,
    }) => {
      this.startBranchRun(
        input,
        branchId,
        source,
        controller,
        context,
        messageStore,
        messageScope,
      );
    });

    return {
      turnId,
      branchIds,
    };
  }

  public override cancel(target?: {
    turnId?: string;
    branchId?: string;
  }): void {
    this.assertNotDisposed();

    const runs = [...this.activeRuns.entries()].filter(
      ([branchId, run]) =>
        (!target?.branchId || branchId === target.branchId) &&
        (!target?.turnId || run.context.turnId === target.turnId),
    );

    runs.forEach(([branchId, run]) => {
      run.controller.abort();
      run.messageScope?.stopTracking();
      void run.source.source.cancel?.(run.context);
      this.activeRuns.delete(branchId);
      this.updateBranch(branchId, {
        status: "cancelled",
      });
    });

    this.refreshRuntimeStatus();
  }

  public removeTurn(
    turnId: string,
    options: RemoveChatTurnOptions = {},
  ): void {
    this.assertNotDisposed();

    const turn = this.snapshot.turnsById[turnId];
    if (!turn) {
      return;
    }

    this.cancel({ turnId });

    if (options.deleteMessages) {
      this.deleteTurnMessages(turn, {
        includeInput: options.includeInput ?? true,
      });
    }

    const turnsById = { ...this.snapshot.turnsById };
    const branchesById = { ...this.snapshot.branchesById };

    delete turnsById[turnId];
    turn.branchIds.forEach((branchId) => {
      delete branchesById[branchId];
      this.branchMessageScopesById.get(branchId)?.dispose();
      this.branchMessageScopesById.delete(branchId);
      this.branchSourcesById.delete(branchId);
    });

    this.patchSnapshot({
      turnIds: this.snapshot.turnIds.filter((id) => id !== turnId),
      turnsById,
      branchesById,
      activeTurnId:
        this.snapshot.activeTurnId === turnId
          ? undefined
          : this.snapshot.activeTurnId,
    });
    this.refreshRuntimeStatus();
  }

  public override selectBranch(
    turnId: string,
    branchId: string,
    selection: ChatBranchSelectionInput = {},
  ): void {
    this.assertNotDisposed();

    const turn = this.snapshot.turnsById[turnId];
    const branch = this.snapshot.branchesById[branchId];

    if (!turn) {
      throw new Error(`Turn "${turnId}" does not exist.`);
    }

    if (!branch || branch.turnId !== turnId || !turn.branchIds.includes(branchId)) {
      throw new Error(`Branch "${branchId}" does not belong to turn "${turnId}".`);
    }

    this.patchSnapshot({
      turnsById: {
        ...this.snapshot.turnsById,
        [turnId]: {
          ...turn,
          selectedBranchId: branchId,
          selection: {
            ...selection,
            branchId,
            selectedAt: Date.now(),
          },
        },
      },
    });
  }

  public override dispose(): void {
    [...this.activeRuns.keys()].forEach((branchId) => {
      this.cancel({ branchId });
    });

    this.branchMessageScopesById.forEach((scope) => scope.dispose());
    this.branchMessageScopesById.clear();
    this.messageHubs.forEach((hub) => hub.dispose());
    this.messageHubs.clear();

    this.sources.forEach(({ source }) => {
      void source.dispose?.();
    });

    super.dispose();
  }

  public override reset(options: ChatRuntimeResetOptions = {}): void {
    this.cancel();
    this.branchMessageScopesById.forEach((scope) => scope.dispose());
    this.branchMessageScopesById.clear();
    this.branchSourcesById.clear();
    super.reset(options);
  }

  private resolveSourceEntries(branchIds?: readonly string[]) {
    return this.sources
      .map((source, index) => ({
        source,
        index,
        sourceBranchId: this.createBranchId(source, index),
      }))
      .filter(
        ({ sourceBranchId }) =>
          !branchIds || branchIds.includes(sourceBranchId),
      );
  }

  private initializeHistoryTurns(
    historyTurns: readonly CompareChatRuntimeHistoryTurn<
      TMessage,
      TTurnMetadata,
      TBranchMetadata
    >[],
  ) {
    const sourceEntries = this.resolveSourceEntries();
    const turnIds = [...this.snapshot.turnIds];
    const turnsById = { ...this.snapshot.turnsById };
    const branchesById = { ...this.snapshot.branchesById };

    historyTurns.forEach((historyTurn) => {
      const sourceEntry = historyTurn.sourceBranchId
        ? sourceEntries.find(
            (entry) => entry.sourceBranchId === historyTurn.sourceBranchId,
          )
        : sourceEntries[0];

      if (!sourceEntry) {
        throw new Error(
          `Cannot initialize history turn "${historyTurn.id}" without a matching source.`,
        );
      }

      const branchId = createRuntimeBranchId(
        historyTurn.id,
        sourceEntry.sourceBranchId,
      );
      const inputMessageId =
        historyTurn.inputMessage?.id ?? historyTurn.inputMessageId;
      const sourceMessageReader = sourceEntry.source.source.messageReader;
      const messageScope = sourceMessageReader
        ? this.getMessageHub(sourceMessageReader).createScope({
            id: branchId,
            context: {
              threadId: this.snapshot.threadId,
              turnId: historyTurn.id,
              branchId,
              anchorMessageId: inputMessageId,
            },
            selector: sourceEntry.source.source.selectMessages,
            inputMessageIds: inputMessageId ? [inputMessageId] : [],
            messageIds: historyTurn.messageIds,
          })
        : undefined;
      const messageReader =
        messageScope ?? createMessageStore<TMessage>();
      const sourceId =
        sourceEntry.source.sourceId ??
        sourceEntry.source.source.id ??
        sourceEntry.sourceBranchId;

      this.branchSourcesById.set(branchId, sourceEntry.source);
      if (messageScope) {
        this.branchMessageScopesById.set(branchId, messageScope);
      }
      turnIds.push(historyTurn.id);
      turnsById[historyTurn.id] = {
        id: historyTurn.id,
        inputMessage: historyTurn.inputMessage,
        inputMessageId,
        branchIds: [branchId],
        selectedBranchId: branchId,
        selection: historyTurn.selection
          ? {
              ...historyTurn.selection,
              branchId,
              selectedAt: Date.now(),
            }
          : undefined,
        createdAt: historyTurn.createdAt ?? Date.now(),
        metadata: historyTurn.metadata,
      };
      branchesById[branchId] = {
        id: branchId,
        turnId: historyTurn.id,
        label:
          historyTurn.branchLabel ??
          sourceEntry.source.label ??
          sourceEntry.source.source.label,
        sourceId,
        anchorMessageId: inputMessageId,
        messageReader,
        selectMessages: messageScope
          ? undefined
          : sourceEntry.source.source.selectMessages,
        status: "completed",
        metadata:
          historyTurn.branchMetadata ??
          (sourceEntry.source.metadata as TBranchMetadata | undefined),
      };
    });

    this.commitSnapshot({
      ...this.snapshot,
      turnIds,
      turnsById,
      branchesById,
    });
  }

  private startBranchRun(
    input: TInput,
    branchId: string,
    source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    controller: AbortController,
    context: ChatSourceRunContext<TSourceMetadata>,
    messageStore?: MessageStore<TMessage>,
    messageScope?: BranchMessageScope<TMessage>,
  ) {
    this.activeRuns.set(branchId, {
      source,
      context,
      controller,
      messageStore,
      messageScope,
    });

    void this.consumeSource(input, branchId, source, context, messageStore);
  }

  private async consumeSource(
    input: TInput,
    branchId: string,
    sourceConfig: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    context: ChatSourceRunContext<TSourceMetadata>,
    messageStore?: MessageStore<TMessage>,
  ) {
    try {
      for await (const event of sourceConfig.source.run(input, context)) {
        if (context.signal.aborted) {
          return;
        }

        if (event.type === "branch-started") {
          this.updateBranch(branchId, {
            status: "running",
            error: undefined,
          });
          continue;
        }

        if (event.type === "message") {
          messageStore?.appendMessage(event.message);
          continue;
        }

        if (event.type === "messages") {
          messageStore?.setMessages(event.messages);
          continue;
        }

        if (event.type === "branch-completed") {
          this.updateBranch(branchId, {
            status: "completed",
          });
          continue;
        }

        this.updateBranch(branchId, {
          status: "error",
          error: event.error,
        });
      }
    } catch (error) {
      if (!context.signal.aborted) {
        this.updateBranch(branchId, {
          status: "error",
          error,
        });
      }
    } finally {
      const activeRun = this.activeRuns.get(branchId);
      if (activeRun) {
        activeRun.messageScope?.stopTracking();
        this.activeRuns.delete(branchId);
        this.refreshRuntimeStatus();
      }
    }
  }

  private deleteTurnMessages(
    turn: ChatTurn<TMessage, TTurnMetadata>,
    options: {
      includeInput: boolean;
    },
  ) {
    turn.branchIds.forEach((branchId) => {
      const branch = this.snapshot.branchesById[branchId];
      const source = this.branchSourcesById.get(branchId);
      const messageScope = this.branchMessageScopesById.get(branchId);
      const messageIds =
        messageScope?.getMessageIds({
          includeInput: options.includeInput,
        }) ?? new Set<string>();

      if (branch && source && messageIds.size > 0) {
        void source.source.deleteMessages?.([...messageIds], {
          threadId: this.snapshot.threadId,
          turnId: turn.id,
          branchId,
          sourceId: branch.sourceId ?? source.sourceId ?? source.source.id,
        });
      }

      if (branch && isMessageStore<TMessage>(branch.messageReader)) {
        branch.messageReader.setMessages([]);
      }
    });
  }

  private getMessageHub(messageReader: MessageReader<TMessage>) {
    const existingHub = this.messageHubs.get(messageReader);
    if (existingHub) {
      return existingHub;
    }

    const hub = new BranchMessageHub(messageReader);
    this.messageHubs.set(messageReader, hub);
    return hub;
  }

  private updateBranch(
    branchId: string,
    patch: Partial<ChatBranch<TMessage, TBranchMetadata>>,
  ) {
    const branch = this.snapshot.branchesById[branchId];
    if (!branch) return;

    const patchKeys = Object.keys(patch) as Array<
      keyof ChatBranch<TMessage, TBranchMetadata>
    >;
    if (patchKeys.every((key) => Object.is(branch[key], patch[key]))) {
      return;
    }

    this.patchSnapshot({
      branchesById: {
        ...this.snapshot.branchesById,
        [branchId]: {
          ...branch,
          ...patch,
        },
      },
    });
  }

  private refreshRuntimeStatus() {
    const activeTurnId = this.snapshot.activeTurnId;
    const activeTurn = activeTurnId
      ? this.snapshot.turnsById[activeTurnId]
      : undefined;
    const activeTurnBranches = activeTurn?.branchIds
      .map((branchId) => this.snapshot.branchesById[branchId])
      .filter((branch): branch is ChatBranch<TMessage, TBranchMetadata> =>
        Boolean(branch),
      ) ?? [];
    const hasRunningBranch = this.activeRuns.size > 0;
    const hasError = activeTurnBranches.some(
      (branch) => branch.status === "error",
    );

    this.patchSnapshot({
      status: hasRunningBranch ? "running" : hasError ? "error" : "idle",
      activeTurnId: hasRunningBranch ? this.snapshot.activeTurnId : undefined,
    });
  }
}

function createDefaultId(prefix: string) {
  return () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
}

function createRuntimeBranchId(turnId: string, sourceBranchId: string) {
  return `${turnId}:${sourceBranchId}`;
}

function isMessageStore<TMessage extends Message>(
  reader: unknown,
): reader is MessageStore<TMessage> {
  return (
    typeof reader === "object" &&
    reader !== null &&
    "appendMessage" in reader &&
    "setMessages" in reader
  );
}
