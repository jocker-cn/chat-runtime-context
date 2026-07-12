import type { Message } from "@ag-ui/client";
import type {
  AnswerSource,
  ChatMetadata,
  ChatSourceEvent,
  ChatSourceRunContext,
} from "../../../core";

export type StaticAnswerSourceResolver<
  TInput,
  TMessage extends Message,
  TMetadata extends ChatMetadata,
> = (
  input: TInput,
  context: ChatSourceRunContext<TMetadata>,
) => readonly TMessage[] | Promise<readonly TMessage[]>;

export interface StaticAnswerSourceOptions<
  TInput = unknown,
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
> {
  id: string;
  label?: string;
  resolve: StaticAnswerSourceResolver<TInput, TMessage, TMetadata>;
}

export class StaticAnswerSource<
  TInput = unknown,
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
> implements AnswerSource<TInput, TMessage, TMetadata>
{
  public readonly id: string;
  public readonly label?: string;
  private readonly resolve: StaticAnswerSourceResolver<
    TInput,
    TMessage,
    TMetadata
  >;

  constructor(
    options: StaticAnswerSourceOptions<TInput, TMessage, TMetadata>,
  ) {
    this.id = options.id;
    this.label = options.label;
    this.resolve = options.resolve;
  }

  async *run(
    input: TInput,
    context: ChatSourceRunContext<TMetadata>,
  ): AsyncIterable<ChatSourceEvent<TMessage>> {
    yield { type: "branch-started" };

    const messages = await this.resolve(input, context);
    if (context.signal.aborted) {
      return;
    }

    for (const message of messages) {
      yield {
        type: "message",
        message,
      };
    }

    yield { type: "branch-completed" };
  }
}
