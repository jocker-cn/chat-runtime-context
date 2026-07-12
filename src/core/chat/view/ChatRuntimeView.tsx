import type { Message } from "@ag-ui/client";
import { useMemo, type ReactNode } from "react";
import { ChatProvider, useChatSelector } from "../context/ChatContext";
import type {
  ChatRuntime,
  ChatRuntimeStatus,
} from "../contracts/chat-runtime";
import {
  createChatExtensionStore,
  type ChatExtensionStore,
} from "../extensions/ChatExtensionStore";
import type { FrameRenderer } from "../frame/createFrameRenderer";
import {
  RuntimeFocusController,
  useRuntimeFocusRootProps,
} from "../../react/accessibility/RuntimeFocusController";
import { TurnView, type TurnInputRenderer } from "./TurnView";

export interface ChatRuntimeClassNames {
  root: string;
  turn: string;
  input: string;
  branches: string;
  branch: string;
  frameList: string;
  frame: string;
  slot: string;
}

export const chatRuntimeClassNames: ChatRuntimeClassNames = {
  root: "crt-runtime",
  turn: "crt-turn",
  input: "crt-turn-input",
  branches: "crt-turn-branches",
  branch: "crt-branch",
  frameList: "crt-frame-list",
  frame: "crt-frame-list-item",
  slot: "crt-frame-slot",
};

export interface ChatRuntimeViewProps<
  TInput = unknown,
  TMessage extends Message = Message,
  TExtensions = ChatExtensionStore,
> {
  runtime: ChatRuntime<TInput, TMessage>;
  renderer: FrameRenderer<TMessage>;
  renderInput?: TurnInputRenderer<TMessage>;
  extensions?: TExtensions;
  classNames?: Partial<ChatRuntimeClassNames>;
  unstyled?: boolean;
  showOnlySelectedBranch?: boolean;
  empty?: ReactNode;
  loadingIndicator?: ReactNode;
}

export function ChatRuntimeView<
  TInput = unknown,
  TMessage extends Message = Message,
  TExtensions = ChatExtensionStore,
>({
  runtime,
  renderer,
  renderInput,
  extensions,
  classNames,
  unstyled = false,
  showOnlySelectedBranch,
  empty = null,
  loadingIndicator = null,
}: ChatRuntimeViewProps<TInput, TMessage, TExtensions>) {
  const internalExtensions = useMemo(() => createChatExtensionStore(), []);
  const resolvedExtensions = extensions ?? (internalExtensions as TExtensions);
  const resolvedClassNames = resolveClassNames(classNames, unstyled);

  return (
    <ChatProvider runtime={runtime} extensions={resolvedExtensions}>
      <RuntimeFocusController>
        <ChatRuntimeContent
          renderer={renderer}
          renderInput={renderInput}
          classNames={resolvedClassNames}
          showOnlySelectedBranch={showOnlySelectedBranch}
          empty={empty}
          loadingIndicator={loadingIndicator}
        />
      </RuntimeFocusController>
    </ChatProvider>
  );
}

interface ChatRuntimeContentProps<TMessage extends Message> {
  renderer: FrameRenderer<TMessage>;
  renderInput?: TurnInputRenderer<TMessage>;
  classNames: ChatRuntimeClassNames;
  showOnlySelectedBranch?: boolean;
  empty: ReactNode;
  loadingIndicator: ReactNode;
}

function ChatRuntimeContent<TMessage extends Message>({
  renderer,
  renderInput,
  classNames,
  showOnlySelectedBranch,
  empty,
  loadingIndicator,
}: ChatRuntimeContentProps<TMessage>) {
  const runtimeFocusRootProps = useRuntimeFocusRootProps();
  const { status, turnIds } = useChatSelector(
    (snapshot) => ({
      status: snapshot.status,
      turnIds: snapshot.turnIds,
    }),
    areRuntimeViewStatesEqual,
  );

  return (
    <section
      {...runtimeFocusRootProps}
      className={classNames.root}
      data-runtime-status={status}
    >
      {turnIds.length === 0
        ? empty
        : turnIds.map((turnId) => (
            <TurnView
              key={turnId}
              turnId={turnId}
              renderer={renderer}
              renderInput={renderInput}
              className={classNames.turn}
              inputClassName={classNames.input}
              branchesClassName={classNames.branches}
              branchClassName={classNames.branch}
              frameListClassName={classNames.frameList}
              frameClassName={classNames.frame}
              slotClassName={classNames.slot}
              showOnlySelectedBranch={showOnlySelectedBranch}
            />
          ))}
      {status === "running" ? loadingIndicator : null}
    </section>
  );
}

function areRuntimeViewStatesEqual(
  previous: {
    status: ChatRuntimeStatus;
    turnIds: readonly string[];
  },
  next: {
    status: ChatRuntimeStatus;
    turnIds: readonly string[];
  },
) {
  return previous.status === next.status && previous.turnIds === next.turnIds;
}

function resolveClassNames(
  overrides: Partial<ChatRuntimeClassNames> | undefined,
  unstyled: boolean,
): ChatRuntimeClassNames {
  const base = unstyled ? emptyClassNames : chatRuntimeClassNames;

  return Object.fromEntries(
    Object.keys(base).map((key) => {
      const name = key as keyof ChatRuntimeClassNames;
      return [name, [base[name], overrides?.[name]].filter(Boolean).join(" ")];
    }),
  ) as unknown as ChatRuntimeClassNames;
}

const emptyClassNames: ChatRuntimeClassNames = {
  root: "",
  turn: "",
  input: "",
  branches: "",
  branch: "",
  frameList: "",
  frame: "",
  slot: "",
};
