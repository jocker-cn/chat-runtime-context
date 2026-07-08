import type {
  AbstractAgent,
  AgentSubscriber,
  Message,
  RunAgentParameters,
} from "@ag-ui/client";
import type {
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
  private readonly createUserMessage: (content: string) => Message;
  private readonly parameters?: RunAgentParameters | (() => RunAgentParameters);
  private readonly listeners = new Set<() => void>();

  constructor(options: AgUiAgentSourceOptions) {
    this.agent = options.agent;
    this.id = options.id ?? options.agent.agentId ?? "ag-ui-agent";
    this.label = options.label ?? options.agent.description;
    this.parameters = options.parameters;
    this.createUserMessage =
      options.createUserMessage ??
      ((content) => ({
        id: crypto.randomUUID(),
        role: "user",
        content,
      }));
    this.messageReader = {
      subscribe: (listener) => {
        this.listeners.add(listener);

        return () => {
          this.listeners.delete(listener);
        };
      },
      getMessages: () => this.agent.messages,
    };
  }

  run(
    input: TInput,
    context: ChatSourceRunContext<TMetadata>,
  ): AsyncIterable<ChatSourceEvent<Message>> {
    const queue = new AsyncQueue<ChatSourceEvent<Message>>();
    const messages = this.resolveInputMessages(input, context.inputMessage);

    if (messages.length > 0) {
      this.agent.addMessages([...messages]);
      this.notifyMessageReaders();
    }

    const subscriber: AgentSubscriber = {
      onRunStartedEvent: () => {
        queue.push({ type: "branch-started" });
      },
      onMessagesChanged: () => {
        this.notifyMessageReaders();
      },
      onRunErrorEvent: ({ event }) => {
        queue.push({
          type: "branch-error",
          error: event.message,
        });
      },
      onRunFinishedEvent: () => {
        this.notifyMessageReaders();
        queue.push({ type: "branch-completed" });
      },
    };

    const parameters = this.resolveParameters(input);

    void this.agent
      .runAgent(parameters, subscriber)
      .then(() => {
        this.notifyMessageReaders();
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
    const maybeClose = this.agent as AbstractAgent & {
      close?: () => void;
    };
    maybeClose.close?.();
  }

  private notifyMessageReaders() {
    this.listeners.forEach((listener) => listener());
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
