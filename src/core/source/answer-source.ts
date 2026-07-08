import type { Message } from "@ag-ui/client";
import type {
  BranchMessageSelector,
  ChatMetadata,
  MessageReader,
} from "../contracts/chat-runtime";

export interface ChatSourceRunContext<
  TMetadata extends ChatMetadata = ChatMetadata,
> {
  threadId?: string;
  turnId: string;
  branchId: string;
  sourceId: string;
  inputMessage?: Message;
  signal: AbortSignal;
  metadata?: TMetadata;
}

export interface DeleteSourceMessagesContext {
  threadId?: string;
  turnId: string;
  branchId: string;
  sourceId: string;
}

export type ChatSourceEvent<TMessage extends Message = Message> =
  | {
      type: "branch-started";
    }
  | {
      type: "message";
      message: TMessage;
    }
  | {
      type: "messages";
      messages: readonly TMessage[];
    }
  | {
      type: "branch-completed";
    }
  | {
      type: "branch-error";
      error: unknown;
    };

export interface AnswerSource<
  TInput = unknown,
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
> {
  readonly id: string;
  readonly label?: string;
  readonly messageReader?: MessageReader<TMessage>;
  readonly selectMessages?: BranchMessageSelector<TMessage>;

  run(
    input: TInput,
    context: ChatSourceRunContext<TMetadata>,
  ): AsyncIterable<ChatSourceEvent<TMessage>>;

  cancel?(context: ChatSourceRunContext<TMetadata>): Promise<void> | void;

  deleteMessages?(
    messageIds: readonly string[],
    context: DeleteSourceMessagesContext,
  ): Promise<void> | void;

  dispose?(): Promise<void> | void;
}

export interface AnswerSourceConfig<
  TInput = unknown,
  TMessage extends Message = Message,
  TMetadata extends ChatMetadata = ChatMetadata,
> {
  source: AnswerSource<TInput, TMessage, TMetadata>;
  branchId?: string;
  label?: string;
  sourceId?: string;
  metadata?: TMetadata;
}
