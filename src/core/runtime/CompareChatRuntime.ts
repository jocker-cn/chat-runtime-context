import type { Message } from "@ag-ui/client";
import type {
  ChatBranch,
  ChatBranchSelectionInput,
  ChatMetadata,
  ChatRunHandle,
  ChatRunOptions,
  ChatTurn,
} from "../contracts/chat-runtime";
import type {
  AnswerSourceConfig,
  ChatSourceRunContext,
} from "../source/answer-source";
import type { MessageStore } from "../source/message-store";
import { createMessageStore } from "../source/message-store";
import { BaseChatRuntime, createInitialChatRuntimeSnapshot } from "./BaseChatRuntime";

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
  getTurnMetadata?: (
    input: TInput,
    options?: ChatRunOptions<TMessage>,
  ) => TTurnMetadata | undefined;
  getBranchMetadata?: (
    source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    index: number,
  ) => TBranchMetadata | undefined;
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
      const messageReader =
        entry.source.source.messageReader ??
        createMessageStore<TMessage>();

      return {
        ...entry,
        messageReader,
        messageStore: isMessageStore<TMessage>(messageReader)
          ? messageReader
          : undefined,
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
      }) => [
        branchId,
        {
          id: branchId,
          turnId,
          label: source.label ?? source.source.label,
          sourceId: source.sourceId ?? source.source.id ?? sourceBranchId,
          anchorMessageId: inputMessage?.id,
          messageReader,
          selectMessages: source.source.selectMessages,
          status: "idle",
          metadata: (
            this.getBranchMetadata?.(source, index) ?? source.metadata
          ) as TBranchMetadata | undefined,
        } satisfies ChatBranch<TMessage, TBranchMetadata>,
      ]),
    );

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
    }) => {
      this.startBranchRun(
        input,
        branchId,
        source,
        controller,
        context,
        messageStore,
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
      void run.source.source.cancel?.(run.context);
      this.activeRuns.delete(branchId);
      this.updateBranch(branchId, {
        status: "cancelled",
      });
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

    this.sources.forEach(({ source }) => {
      void source.dispose?.();
    });

    super.dispose();
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

  private startBranchRun(
    input: TInput,
    branchId: string,
    source: AnswerSourceConfig<TInput, TMessage, TSourceMetadata>,
    controller: AbortController,
    context: ChatSourceRunContext<TSourceMetadata>,
    messageStore?: MessageStore<TMessage>,
  ) {
    this.activeRuns.set(branchId, {
      source,
      context,
      controller,
      messageStore,
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
      this.activeRuns.delete(branchId);
      this.refreshRuntimeStatus();
    }
  }

  private updateBranch(
    branchId: string,
    patch: Partial<ChatBranch<TMessage, TBranchMetadata>>,
  ) {
    const branch = this.snapshot.branchesById[branchId];
    if (!branch) return;

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
    const branches = Object.values(this.snapshot.branchesById);
    const hasRunningBranch = branches.some(
      (branch) => branch.status === "running" || branch.status === "idle",
    );
    const hasError = branches.some((branch) => branch.status === "error");

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
