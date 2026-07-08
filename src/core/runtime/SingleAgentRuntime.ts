import type { Message } from "@ag-ui/client";
import type { ChatMetadata } from "../contracts/chat-runtime";
import type { AnswerSource } from "../source/answer-source";
import { CompareChatRuntime } from "./CompareChatRuntime";
import type {
  ChatInputMessageFactory,
  CompareChatRuntimeOptions,
} from "./CompareChatRuntime";

export interface SingleAgentRuntimeOptions<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
  TSourceMetadata extends ChatMetadata = ChatMetadata,
> extends Omit<
    CompareChatRuntimeOptions<
      TInput,
      TMessage,
      TTurnMetadata,
      TBranchMetadata,
      TSourceMetadata
    >,
    "sources"
  > {
  source: AnswerSource<TInput, TMessage, TSourceMetadata>;
  branchId?: string;
  branchLabel?: string;
}

export class SingleAgentRuntime<
  TInput = unknown,
  TMessage extends Message = Message,
  TTurnMetadata extends ChatMetadata = ChatMetadata,
  TBranchMetadata extends ChatMetadata = ChatMetadata,
  TSourceMetadata extends ChatMetadata = ChatMetadata,
> extends CompareChatRuntime<
  TInput,
  TMessage,
  TTurnMetadata,
  TBranchMetadata,
  TSourceMetadata
> {
  constructor(
    options: SingleAgentRuntimeOptions<
      TInput,
      TMessage,
      TTurnMetadata,
      TBranchMetadata,
      TSourceMetadata
    >,
  ) {
    super({
      ...options,
      sources: [
        {
          source: options.source,
          branchId: options.branchId ?? "main",
          label: options.branchLabel ?? options.source.label,
        },
      ],
    });
  }
}

export type { ChatInputMessageFactory };
