import type {
  AbstractAgent,
  AgentSubscriber,
  Message,
  RunAgentParameters,
} from "@ag-ui/client";
import type {
  ChatMetadata,
  MessageReader,
} from "../contracts/chat-runtime";
import { ListenerSet } from "../../internal/ListenerSet";
import type {
  AnswerSource,
  ChatSourceEvent,
  ChatSourceMessageContext,
  ChatSourceRunContext,
  DeleteSourceMessagesContext,
} from "./answer-source";
import { AsyncQueue } from "./asyncQueue";

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
  private readonly createUserMessage: (content: string) => Message;
  private readonly parameters?: RunAgentParameters | (() => RunAgentParameters);
  private readonly agentMessageReader: AgentMessageReader;
  private readonly unsubscribeAgent: () => void;

  constructor(options: AgUiAgentSourceOptions) {
    this.agent = options.agent;
    this.id = options.id ?? options.agent.agentId ?? "ag-ui-agent";
    this.label = options.label ?? options.agent.description;
    this.parameters = options.parameters;
    this.agentMessageReader = new AgentMessageReader(this.agent);
    this.messageReader = this.agentMessageReader;
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

    if (messages.length > 0) {
      this.agent.addMessages([...messages]);
    }

    const subscriber: AgentSubscriber = {
      onRunStartedEvent: () => {
        queue.push({ type: "branch-started" });
      },
      onRunErrorEvent: ({ event }) => {
        queue.push({
          type: "branch-error",
          error: event.message,
        });
      },
      onRunFinishedEvent: () => {
        queue.push({ type: "branch-completed" });
      },
    };

    const parameters = this.resolveParameters(input);

    void this.agent
      .runAgent(parameters, subscriber)
      .then(() => {
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

  addLocalMessage(
    message: Message,
    _context: ChatSourceMessageContext<TMetadata>,
  ): void {
    this.agent.addMessage(message);
  }

  cancel(): void {
    this.agent.abortRun();
  }

  deleteMessages(
    messageIds: readonly string[],
    _context: DeleteSourceMessagesContext,
  ): void {
    if (messageIds.length === 0) {
      return;
    }

    const messageIdSet = new Set(messageIds);
    this.agent.setMessages(
      this.agent.messages.filter((message) => !messageIdSet.has(message.id)),
    );
  }

  dispose(): void {
    this.agent.abortRun();
    this.unsubscribeAgent();
    const maybeClose = this.agent as AbstractAgent & {
      close?: () => void;
    };
    maybeClose.close?.();
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

export function createAgUiAgentSource<
  TInput extends AgUiAgentInput = AgUiAgentInput,
  TMetadata extends ChatMetadata = ChatMetadata,
>(options: AgUiAgentSourceOptions) {
  return new AgUiAgentSource<TInput, TMetadata>(options);
}

class AgentMessageReader implements MessageReader<Message> {
  private readonly agent: AbstractAgent;
  private readonly listeners = new ListenerSet();

  constructor(agent: AbstractAgent) {
    this.agent = agent;
  }

  subscribe = (listener: () => void) => {
    return this.listeners.add(listener);
  };

  getMessages = () => this.agent.messages;

  notify = () => {
    this.listeners.emit();
  };
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
