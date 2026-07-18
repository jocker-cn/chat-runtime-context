import type { Message } from "@ag-ui/client";
import type {
  ChatBranch,
  ChatBranchSelectionInput,
  ChatLocalMessageOptions,
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
> = (input: TInput, turnId: string) => TMessage;

export interface CompareChatRuntimeOptions<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
  TSourceMetadata extends ChatMetadata = ChatMetadata,
> {
  threadId?: string;
  sources: readonly AnswerSourceConfig<TInput, TMessage, TSourceMetadata>[];
  createInputMessage: ChatInputMessageFactory<TInput, TMessage>;
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
  /** IDs projected from the matching Source messageReader. */
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
  messageScope?: BranchMessageScope<TMessage>;
  phase: "running" | "cancelling";
  cancellation?: Promise<void>;
}

interface ResolvedSourceEntry<
  TInput,
  TMessage extends Message,
  TSourceMetadata extends ChatMetadata,
> {
  source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>;
  index: number;
  sourceBranchId: string;
}

type BranchRunOutcome =
  | { status: "completed" }
  | { status: "error"; error: unknown };

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
  private readonly sourceEntries: readonly ResolvedSourceEntry<
    TInput,
    TMessage,
    TSourceMetadata
  >[];
  private readonly createInputMessage: ChatInputMessageFactory<
    TInput,
    TMessage
  >;
  private readonly createTurnId: () => string;
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
  private lifecyclePhase: "open" | "resetting" | "disposing" | "closed" =
    "open";
  private resetPromise?: Promise<void>;
  private disposePromise?: Promise<void>;

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

    if (options.sources.length === 0) {
      throw new Error("ChatRuntime requires at least one answer source.");
    }
    if (typeof options.createInputMessage !== "function") {
      throw new Error("ChatRuntime requires createInputMessage.");
    }

    this.sources = [...options.sources];
    this.createInputMessage = options.createInputMessage;
    this.createTurnId = options.createTurnId ?? createDefaultId("turn");
    const createBranchId =
      options.createBranchId ??
      ((source, index) => source.branchId ?? source.source.id ?? `branch-${index + 1}`);
    this.sourceEntries = this.sources.map((source, index) => ({
      source,
      index,
      sourceBranchId: createBranchId(source, index),
    }));
    assertUniqueSourceBranchIds(this.sourceEntries);
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
    const { turnId, sourceEntries } = this.prepareTurnStart(options);
    const inputMessage =
      options.inputMessage ?? this.createInputMessage(input, turnId);
    if (!inputMessage) {
      throw new Error("createInputMessage must return a message.");
    }

    const trackedTurn = this.openTrackedTurn({
      turnId,
      sourceEntries,
      inputMessage,
      metadata: this.getTurnMetadata?.(input, options),
    });

    trackedTurn.branchRunEntries.forEach(({
      source,
      branchId,
      messageStore,
      context,
    }) => {
      if (this.activeRuns.get(branchId)?.phase === "running") {
        void this.consumeSource(
          input,
          branchId,
          source,
          context,
          messageStore,
        );
      }
    });

    return trackedTurn.handle;
  }

  public override async sendLocalMessage(
    message: TMessage,
    options: ChatLocalMessageOptions<TTurnMetadata> = {},
  ): Promise<ChatRunHandle> {
    this.assertOperational();
    const sourceBranchId = this.resolveLocalSourceBranchId(options.branchId);
    const { turnId, sourceEntries } = this.prepareTurnStart({
      turnId: options.turnId,
      branchIds: [sourceBranchId],
    });
    const sourceEntry = sourceEntries[0]!;
    if (!sourceEntry.source.source.addLocalMessage) {
      throw new Error(
        `Source branch "${sourceBranchId}" does not support local messages.`,
      );
    }
    if (!sourceEntry.source.source.messageReader) {
      throw new Error(
        `Source branch "${sourceBranchId}" requires a messageReader for local messages.`,
      );
    }

    const trackedTurn = this.openTrackedTurn({
      turnId,
      sourceEntries,
      inputMessage: options.placement === "input" ? message : undefined,
      metadata: options.metadata,
    });
    const branchRun = trackedTurn.branchRunEntries[0]!;
    if (this.activeRuns.get(branchRun.branchId)?.phase !== "running") {
      return trackedTurn.handle;
    }

    this.updateBranch(branchRun.branchId, {
      status: "running",
      error: undefined,
    });
    if (this.activeRuns.get(branchRun.branchId)?.phase !== "running") {
      return trackedTurn.handle;
    }

    let outcome: BranchRunOutcome = { status: "completed" };
    try {
      sourceEntry.source.source.addLocalMessage(message, branchRun.context);
    } catch (error) {
      outcome = { status: "error", error };
    }
    this.finishActiveBranch(branchRun.branchId, outcome);

    return trackedTurn.handle;
  }

  private prepareTurnStart(options: {
    turnId?: string;
    branchIds?: readonly string[];
  }) {
    this.assertOperational();

    if (this.snapshot.status === "running") {
      throw new Error(
        "ChatRuntime cannot send while a turn is running. Queue the input until the active turn finishes.",
      );
    }

    const turnId = options.turnId ?? this.createTurnId();
    if (this.snapshot.turnsById[turnId]) {
      throw new Error(`Turn "${turnId}" already exists.`);
    }

    const sourceEntries = this.resolveSourceEntries(options.branchIds);

    return { turnId, sourceEntries };
  }

  private openTrackedTurn({
    turnId,
    sourceEntries,
    inputMessage,
    metadata,
  }: {
    turnId: string;
    sourceEntries: readonly ResolvedSourceEntry<
      TInput,
      TMessage,
      TSourceMetadata
    >[];
    inputMessage: TMessage | undefined;
    metadata: TTurnMetadata | undefined;
  }) {
    const branchEntries = sourceEntries.map((entry) => ({
      ...entry,
      branchId: createRuntimeBranchId(turnId, entry.sourceBranchId),
    }));
    const branchIds = branchEntries.map(({ branchId }) => branchId);
    const existingBranchId = branchIds.find(
      (branchId) => this.snapshot.branchesById[branchId],
    );
    if (existingBranchId) {
      throw new Error(`Branch "${existingBranchId}" already exists.`);
    }

    const turn: ChatTurn<TMessage, TTurnMetadata> = {
      id: turnId,
      branchIds,
      selectedBranchId:
        branchIds.length === 1 ? branchIds[0] : undefined,
      createdAt: Date.now(),
      ...(inputMessage
        ? {
            inputMessage,
            inputMessageId: inputMessage.id,
          }
        : {}),
      ...(metadata !== undefined ? { metadata } : {}),
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

    branchRunEntries.forEach(({
      branchId,
      source,
      controller,
      context,
      messageScope,
    }) => {
      this.branchSourcesById.set(branchId, source);
      if (messageScope) {
        this.branchMessageScopesById.set(branchId, messageScope);
      }
      this.activeRuns.set(branchId, {
        source,
        context,
        controller,
        messageScope,
        phase: "running",
      });
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

    return {
      handle: {
        turnId,
        branchIds,
      },
      branchRunEntries,
    };
  }

  public override async cancel(target?: {
    turnId?: string;
    branchId?: string;
  }): Promise<void> {
    this.assertOperational();
    await this.cancelRuns(target);
  }

  private async cancelRuns(target?: {
    turnId?: string;
    branchId?: string;
  }): Promise<void> {
    const runs = [...this.activeRuns.entries()].filter(
      ([branchId, run]) =>
        (!target?.branchId || branchId === target.branchId) &&
        (!target?.turnId || run.context.turnId === target.turnId),
    );
    const results = await Promise.allSettled(
      runs.map(([branchId, run]) =>
        this.cancelBranchRun(branchId, run),
      ),
    );

    this.refreshRuntimeStatus();
    throwRejectedResults(results, "Failed to cancel chat source runs.");
  }

  private cancelBranchRun(
    branchId: string,
    run: ActiveBranchRun<TInput, TMessage, TSourceMetadata>,
  ) {
    if (run.cancellation) {
      return run.cancellation;
    }

    run.phase = "cancelling";
    const cancellation = Promise.resolve().then(async () => {
      try {
        run.controller.abort();
        await run.source.source.cancel?.(run.context);
      } finally {
        if (this.activeRuns.get(branchId) === run) {
          run.messageScope?.stopTracking();
          this.activeRuns.delete(branchId);
          this.updateBranch(branchId, {
            status: "cancelled",
          });
          this.refreshRuntimeStatus();
        }
      }
    });
    run.cancellation = cancellation;
    return cancellation;
  }

  public async removeTurn(
    turnId: string,
    options: RemoveChatTurnOptions = {},
  ): Promise<void> {
    this.assertOperational();

    const turn = this.snapshot.turnsById[turnId];
    if (!turn) {
      return;
    }

    const errors: unknown[] = [];
    try {
      await this.cancelRuns({ turnId });
    } catch (error) {
      errors.push(error);
    }

    if (options.deleteMessages) {
      try {
        await this.deleteTurnMessages(turn, {
          includeInput: options.includeInput ?? true,
        });
      } catch (error) {
        errors.push(error);
      }
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
    throwCollectedErrors(errors, `Failed to remove turn "${turnId}".`);
  }

  public override selectBranch(
    turnId: string,
    branchId: string,
    selection: ChatBranchSelectionInput = {},
  ): void {
    this.assertOperational();

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

  public override dispose(): Promise<void> {
    if (!this.disposePromise) {
      const pendingReset = this.resetPromise;
      this.lifecyclePhase = "disposing";
      this.disposePromise = this.disposeAfterReset(pendingReset);
    }

    return this.disposePromise;
  }

  private async disposeAfterReset(pendingReset?: Promise<void>) {
    const errors: unknown[] = [];
    if (pendingReset) {
      try {
        await pendingReset;
      } catch (error) {
        errors.push(error);
      }
    }

    try {
      await this.disposeRuntime();
    } catch (error) {
      errors.push(error);
    } finally {
      this.lifecyclePhase = "closed";
    }

    throwCollectedErrors(errors, "Failed to dispose ChatRuntime.");
  }

  private async disposeRuntime() {
    const errors: unknown[] = [];
    try {
      await this.cancelRuns();
    } catch (error) {
      errors.push(error);
    }

    this.branchMessageScopesById.forEach((scope) => scope.dispose());
    this.branchMessageScopesById.clear();
    this.branchSourcesById.clear();
    this.messageHubs.forEach((hub) => hub.dispose());
    this.messageHubs.clear();

    const sources = [...new Set(this.sources.map(({ source }) => source))];
    const disposeResults = await Promise.allSettled(
      sources.map((source) =>
        Promise.resolve().then(() => source.dispose?.()),
      ),
    );
    collectRejectedResults(disposeResults, errors);

    try {
      super.dispose();
    } catch (error) {
      errors.push(error);
    }

    throwCollectedErrors(errors, "Failed to dispose ChatRuntime.");
  }

  public override async reset(
    options: ChatRuntimeResetOptions = {},
  ): Promise<void> {
    this.assertOperational();
    this.lifecyclePhase = "resetting";
    const resetPromise = this.resetRuntime(options);
    this.resetPromise = resetPromise;

    await resetPromise;
  }

  private async resetRuntime(options: ChatRuntimeResetOptions) {
    const errors: unknown[] = [];
    try {
      try {
        await this.cancelRuns();
      } catch (error) {
        errors.push(error);
      }

      this.branchMessageScopesById.forEach((scope) => scope.dispose());
      this.branchMessageScopesById.clear();
      this.branchSourcesById.clear();
      super.reset(options);
      throwCollectedErrors(errors, "Failed to reset ChatRuntime.");
    } finally {
      this.resetPromise = undefined;
      if (this.lifecyclePhase === "resetting") {
        this.lifecyclePhase = "open";
      }
    }
  }

  private resolveSourceEntries(branchIds?: readonly string[]) {
    if (branchIds === undefined) {
      return this.sourceEntries;
    }

    if (branchIds.length === 0) {
      throw new Error("Chat run must target at least one source branch.");
    }

    const requestedBranchIds = new Set(branchIds);
    if (requestedBranchIds.size !== branchIds.length) {
      throw new Error("Chat run source branch IDs must be unique.");
    }

    const knownBranchIds = new Set(
      this.sourceEntries.map(({ sourceBranchId }) => sourceBranchId),
    );
    const unknownBranchIds = branchIds.filter(
      (branchId) => !knownBranchIds.has(branchId),
    );
    if (unknownBranchIds.length > 0) {
      throw new Error(
        `Unknown source branch ID${unknownBranchIds.length === 1 ? "" : "s"}: ${unknownBranchIds.join(", ")}.`,
      );
    }

    return this.sourceEntries.filter(({ sourceBranchId }) =>
      requestedBranchIds.has(sourceBranchId),
    );
  }

  private resolveLocalSourceBranchId(branchId?: string) {
    if (branchId !== undefined) {
      return branchId;
    }

    if (this.sourceEntries.length === 1) {
      return this.sourceEntries[0]!.sourceBranchId;
    }

    throw new Error(
      "sendLocalMessage requires branchId when the Runtime has multiple Sources.",
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
    const seenTurnIds = new Set(turnIds);
    const seenBranchIds = new Set(Object.keys(branchesById));
    const historyEntries = historyTurns.map((historyTurn) => {
      if (seenTurnIds.has(historyTurn.id)) {
        throw new Error(`History turn "${historyTurn.id}" is duplicated.`);
      }

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
      if (seenBranchIds.has(branchId)) {
        throw new Error(`History branch "${branchId}" is duplicated.`);
      }

      seenTurnIds.add(historyTurn.id);
      seenBranchIds.add(branchId);
      return { historyTurn, sourceEntry, branchId };
    });

    historyEntries.forEach(({ historyTurn, sourceEntry, branchId }) => {
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

  private async consumeSource(
    input: TInput,
    branchId: string,
    sourceConfig: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    context: ChatSourceRunContext<TSourceMetadata>,
    messageStore?: MessageStore<TMessage>,
  ) {
    let outcome: BranchRunOutcome | undefined;

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
          outcome ??= { status: "completed" };
          continue;
        }

        outcome = {
          status: "error",
          error: event.error,
        };
      }
    } catch (error) {
      if (!context.signal.aborted) {
        outcome = {
          status: "error",
          error,
        };
      }
    } finally {
      this.finishActiveBranch(
        branchId,
        outcome ?? { status: "completed" },
      );
    }
  }

  private finishActiveBranch(branchId: string, outcome: BranchRunOutcome) {
    const activeRun = this.activeRuns.get(branchId);
    if (activeRun?.phase !== "running") {
      return;
    }

    // Read the Source synchronously before closing the tracking scope. AG-UI
    // may deliver onMessagesChanged after addMessage/run finalization returns.
    activeRun.messageScope?.stopTracking();
    this.activeRuns.delete(branchId);
    this.updateBranch(
      branchId,
      outcome.status === "error"
        ? {
            status: "error",
            error: outcome.error,
          }
        : {
            status: "completed",
            error: undefined,
          },
    );
    this.refreshRuntimeStatus();
  }

  private async deleteTurnMessages(
    turn: ChatTurn<TMessage, TTurnMetadata>,
    options: {
      includeInput: boolean;
    },
  ) {
    const results = await Promise.allSettled(
      turn.branchIds.map(async (branchId) => {
        const branch = this.snapshot.branchesById[branchId];
        const source = this.branchSourcesById.get(branchId);
        const messageScope = this.branchMessageScopesById.get(branchId);
        const messageIds =
          messageScope?.getMessageIds({
            includeInput: options.includeInput,
          }) ?? new Set<string>();

        if (branch && source && messageIds.size > 0) {
          await source.source.deleteMessages?.([...messageIds], {
            threadId: this.snapshot.threadId,
            turnId: turn.id,
            branchId,
            sourceId:
              branch.sourceId ?? source.sourceId ?? source.source.id,
          });
        }

        if (branch && isMessageStore<TMessage>(branch.messageReader)) {
          branch.messageReader.setMessages([]);
        }
      }),
    );

    throwRejectedResults(
      results,
      `Failed to delete messages for turn "${turn.id}".`,
    );
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

  private assertOperational() {
    this.assertNotDisposed();
    if (this.lifecyclePhase !== "open") {
      throw new Error(`ChatRuntime is ${this.lifecyclePhase}.`);
    }
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

function assertUniqueSourceBranchIds<
  TInput,
  TMessage extends Message,
  TSourceMetadata extends ChatMetadata,
>(
  sourceEntries: readonly ResolvedSourceEntry<
    TInput,
    TMessage,
    TSourceMetadata
  >[],
) {
  const branchIds = new Set<string>();

  sourceEntries.forEach(({ sourceBranchId }) => {
    if (!sourceBranchId) {
      throw new Error("Source branch IDs must not be empty.");
    }
    if (branchIds.has(sourceBranchId)) {
      throw new Error(`Source branch ID "${sourceBranchId}" is duplicated.`);
    }
    branchIds.add(sourceBranchId);
  });
}

function collectRejectedResults(
  results: readonly PromiseSettledResult<unknown>[],
  errors: unknown[],
) {
  results.forEach((result) => {
    if (result.status === "rejected") {
      errors.push(result.reason);
    }
  });
}

function throwRejectedResults(
  results: readonly PromiseSettledResult<unknown>[],
  message: string,
) {
  const errors: unknown[] = [];
  collectRejectedResults(results, errors);
  throwCollectedErrors(errors, message);
}

function throwCollectedErrors(errors: readonly unknown[], message: string) {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];

  throw new AggregateError(errors, message);
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
