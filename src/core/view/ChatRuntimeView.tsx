import type { Message } from "@ag-ui/client";
import type React from "react";
import { useMemo } from "react";
import { ChatProvider, useChatSelector } from "../context/ChatContext";
import type { ChatRuntime } from "../contracts/chat-runtime";
import type { ChatRuntimeStatus } from "../contracts/chat-runtime";
import type { ChatExtensionStore } from "../extensions/ChatExtensionStore";
import { createChatExtensionStore } from "../extensions/ChatExtensionStore";
import type { FrameRenderer } from "../frame/createFrameRenderer";
import { TurnView } from "./TurnView";
import type { TurnInputRenderer } from "./TurnView";

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
  className?: string;
  turnClassName?: string;
  inputClassName?: string;
  branchesClassName?: string;
  branchClassName?: string;
  frameListClassName?: string;
  frameClassName?: string;
  slotClassName?: string;
  showOnlySelectedBranch?: boolean;
  empty?: React.ReactNode;
  loadingIndicator?: React.ReactNode;
}

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
  className,
  turnClassName,
  inputClassName,
  branchesClassName,
  branchClassName,
  frameListClassName,
  frameClassName,
  slotClassName,
  showOnlySelectedBranch,
  empty = null,
  loadingIndicator = null,
}: ChatRuntimeViewProps<TInput, TMessage, TExtensions>) {
  const internalExtensions = useMemo(
    () => createChatExtensionStore(),
    [],
  );
  const resolvedExtensions =
    extensions ?? (internalExtensions as TExtensions);
  const resolvedClassNames = resolveClassNames({
    classNames,
    unstyled,
    className,
    turnClassName,
    inputClassName,
    branchesClassName,
    branchClassName,
    frameListClassName,
    frameClassName,
    slotClassName,
  });

  return (
    <ChatProvider runtime={runtime} extensions={resolvedExtensions}>
      <ChatRuntimeContent
        renderer={renderer}
        renderInput={renderInput}
        className={resolvedClassNames.root}
        turnClassName={resolvedClassNames.turn}
        inputClassName={resolvedClassNames.input}
        branchesClassName={resolvedClassNames.branches}
        branchClassName={resolvedClassNames.branch}
        frameListClassName={resolvedClassNames.frameList}
        frameClassName={resolvedClassNames.frame}
        slotClassName={resolvedClassNames.slot}
        showOnlySelectedBranch={showOnlySelectedBranch}
        empty={empty}
        loadingIndicator={loadingIndicator}
      />
    </ChatProvider>
  );
}

function ChatRuntimeContent<TMessage extends Message>({
  renderer,
  renderInput,
  className,
  turnClassName,
  inputClassName,
  branchesClassName,
  branchClassName,
  frameListClassName,
  frameClassName,
  slotClassName,
  showOnlySelectedBranch,
  empty,
  loadingIndicator,
}: Omit<
  ChatRuntimeViewProps<unknown, TMessage>,
  "runtime" | "extensions"
>) {
  const { status, turnIds } = useChatSelector(
    (snapshot) => ({
      status: snapshot.status,
      turnIds: snapshot.turnIds,
    }),
    areRuntimeViewStatesEqual,
  );

  return (
    <section className={className} data-runtime-status={status}>
      {turnIds.length === 0
        ? empty
        : turnIds.map((turnId) => (
            <TurnView
              key={turnId}
              turnId={turnId}
              renderer={renderer}
              renderInput={renderInput}
              className={turnClassName}
              inputClassName={inputClassName}
              branchesClassName={branchesClassName}
              branchClassName={branchClassName}
              frameListClassName={frameListClassName}
              frameClassName={frameClassName}
              slotClassName={slotClassName}
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

function resolveClassNames({
  classNames,
  unstyled,
  className,
  turnClassName,
  inputClassName,
  branchesClassName,
  branchClassName,
  frameListClassName,
  frameClassName,
  slotClassName,
}: {
  classNames?: Partial<ChatRuntimeClassNames>;
  unstyled: boolean;
  className?: string;
  turnClassName?: string;
  inputClassName?: string;
  branchesClassName?: string;
  branchClassName?: string;
  frameListClassName?: string;
  frameClassName?: string;
  slotClassName?: string;
}): ChatRuntimeClassNames {
  const base = unstyled ? emptyClassNames : chatRuntimeClassNames;

  return {
    root: cx(base.root, classNames?.root, className),
    turn: cx(base.turn, classNames?.turn, turnClassName),
    input: cx(base.input, classNames?.input, inputClassName),
    branches: cx(base.branches, classNames?.branches, branchesClassName),
    branch: cx(base.branch, classNames?.branch, branchClassName),
    frameList: cx(base.frameList, classNames?.frameList, frameListClassName),
    frame: cx(base.frame, classNames?.frame, frameClassName),
    slot: cx(base.slot, classNames?.slot, slotClassName),
  };
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

function cx(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

export const CoreRuntimeView = ChatRuntimeView;
