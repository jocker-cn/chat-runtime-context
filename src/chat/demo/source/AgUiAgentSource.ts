import type {
  AbstractAgent,
  AgentSubscriber,
  Message,
  RunAgentParameters,
} from "@ag-ui/client";
import type {
  BranchMessageSelector,
  ChatMetadata,
  MessageReader,
} from "../../../core/contracts/chat-runtime";
import type {
  AnswerSource,
  ChatSourceEvent,
  ChatSourceRunContext,
} from "../../../core/source/answer-source";
import { AsyncQueue } from "../../../core/source/asyncQueue";

export type AgUiAgentInput =
  | string
  | Message
  | readonly Message[]
  | AgUiAgentInputConfig;

interface AgUiAgentInputConfig {
  message?: Message;
  messages?: readonly Message[];
  parameters?: RunAgentParameters;
}

export interface AgUiAgentSourceOptions {
  id?: string;
  label?: string;
  agent: AbstractAgent;
  createUserMessage?: (content: string) => Message;
  parameters?: RunAgentParameters | (() => RunAgentParameters);
}

export class AgUiAgentSource<
  TInput extends AgUiAgentInput = AgUiAgentInput,
  TMetadata extends ChatMetadata = ChatMetadata,
> implements AnswerSource<TInput, Message, TMetadata>
{
  public readonly id: string;
  public readonly label?: string;
  public readonly agent: AbstractAgent;
  public readonly messageReader: MessageReader<Message>;
  public readonly selectMessages: BranchMessageSelector<Message>;
  private readonly createUserMessage: (content: string) => Message;
  private readonly parameters?: RunAgentParameters | (() => RunAgentParameters);
  private readonly branchStatesById = new Map<string, BranchRunMessageState>();
  private readonly agentMessageReader: AgentMessageReader;
  private readonly unsubscribeAgent: () => void;

  constructor(options: AgUiAgentSourceOptions) {
    this.agent = options.agent;
    this.id = options.id ?? options.agent.agentId ?? "ag-ui-agent";
    this.label = options.label ?? options.agent.description;
    this.parameters = options.parameters;
    this.agentMessageReader = new AgentMessageReader(this.agent);
    this.messageReader = this.agentMessageReader;
    this.selectMessages = (messages, context) =>
      this.branchStatesById.get(context.branchId)?.select(messages) ?? [];
    this.createUserMessage =
      options.createUserMessage ??
      ((content) => ({
        id: crypto.randomUUID(),
        role: "user",
        content,
      }));
    this.unsubscribeAgent = this.agent.subscribe({
      onMessagesChanged: () => {
        this.agentMessageReader.notify();
      },
    }).unsubscribe;
  }

  run(
    input: TInput,
    context: ChatSourceRunContext<TMetadata>,
  ): AsyncIterable<ChatSourceEvent<Message>> {
    const queue = new AsyncQueue<ChatSourceEvent<Message>>();
    const messages = this.resolveInputMessages(input, context.inputMessage);
    const branchState = new BranchRunMessageState(
      this.agent.messages,
      getInputMessageIds(context.inputMessage),
    );
    this.branchStatesById.set(context.branchId, branchState);

    if (messages.length > 0) {
      branchState.excludeMessages(messages);
      this.agent.addMessages([...messages]);
      this.syncBranchState(context);
    }

    const subscriber: AgentSubscriber = {
      onRunStartedEvent: () => {
        queue.push({ type: "branch-started" });
      },
      onMessagesChanged: () => {
        this.syncBranchState(context);
      },
      onRunErrorEvent: ({ event }) => {
        queue.push({
          type: "branch-error",
          error: event.message,
        });
      },
      onRunFinishedEvent: () => {
        this.syncBranchState(context);
        queue.push({ type: "branch-completed" });
      },
    };

    const parameters = this.resolveParameters(input);

    void this.agent
      .runAgent(parameters, subscriber)
      .then(() => {
        this.syncBranchState(context);
        queue.close();
      })
      .catch((error: unknown) => {
        queue.push({
          type: "branch-error",
          error,
        });
        queue.close();
      });

    context.signal.addEventListener(
      "abort",
      () => {
        this.agent.abortRun();
        queue.close();
      },
      { once: true },
    );

    return queue;
  }

  cancel(): void {
    this.agent.abortRun();
  }

  dispose(): void {
    this.agent.abortRun();
    this.unsubscribeAgent();
    const maybeClose = this.agent as AbstractAgent & {
      close?: () => void;
    };
    maybeClose.close?.();
  }

  private syncBranchState(context: ChatSourceRunContext<TMetadata>) {
    this.branchStatesById
      .get(context.branchId)
      ?.syncFromMessages(this.agent.messages);
    this.agentMessageReader.notify();
  }

  private resolveInputMessages(
    input: TInput,
    inputMessage?: Message,
  ): readonly Message[] {
    if (typeof input === "string") {
      return [inputMessage ?? this.createUserMessage(input)];
    }

    if (Array.isArray(input)) {
      return input;
    }

    if (isMessage(input)) {
      return [input];
    }

    if (isInputConfig(input)) {
      return (
        input.messages ??
        (input.message ? [input.message] : inputMessage ? [inputMessage] : [])
      );
    }

    return inputMessage ? [inputMessage] : [];
  }

  private resolveParameters(input: TInput): RunAgentParameters | undefined {
    const base =
      typeof this.parameters === "function"
        ? this.parameters()
        : this.parameters;

    if (
      typeof input === "object" &&
      isInputConfig(input)
    ) {
      return {
        ...base,
        ...input.parameters,
      };
    }

    return base;
  }
}

class AgentMessageReader implements MessageReader<Message> {
  private readonly agent: AbstractAgent;
  private readonly listeners = new Set<() => void>();

  constructor(agent: AbstractAgent) {
    this.agent = agent;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  getMessages = () => this.agent.messages;

  notify = () => {
    this.listeners.forEach((listener) => listener());
  };
}

class BranchRunMessageState {
  private readonly baselineMessageIds: ReadonlySet<string>;
  private readonly inputMessageIds: Set<string>;
  private readonly messageIds = new Set<string>();

  constructor(
    initialMessages: readonly Message[],
    inputMessageIds: ReadonlySet<string>,
  ) {
    this.inputMessageIds = new Set(inputMessageIds);
    this.baselineMessageIds = new Set(
      initialMessages.map((message) => message.id),
    );
  }

  select(messages: readonly Message[]) {
    return messages.filter((message) => this.messageIds.has(message.id));
  }

  excludeMessages(messages: readonly Message[]) {
    messages.forEach((message) => {
      this.inputMessageIds.add(message.id);
    });
  }

  syncFromMessages(messages: readonly Message[]) {
    messages.forEach((message) => {
      if (
        this.baselineMessageIds.has(message.id) ||
        this.inputMessageIds.has(message.id)
      ) {
        return;
      }

      this.messageIds.add(message.id);
    });
  }
}

function getInputMessageIds(inputMessage?: Message) {
  return new Set(inputMessage ? [inputMessage.id] : []);
}

function isMessage(input: unknown): input is Message {
  return (
    typeof input === "object" &&
    input !== null &&
    "role" in input &&
    "id" in input
  );
}

function isInputConfig(input: unknown): input is AgUiAgentInputConfig {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    !isMessage(input)
  );
}
