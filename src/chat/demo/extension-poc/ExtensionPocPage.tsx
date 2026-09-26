import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ChatRuntimeView,
  createChatExtensionStore,
  findChatMessageById,
  type FrameCardProps,
} from "../../../core";
import { demoRenderer, type DemoChatExtensions } from "../demoRenderer";
import { getDemoMessageText } from "../demoMessage";
import {
  createBeComparisonRuntime,
  type BeComparisonRuntimeController,
  type DemoMessage,
} from "../demoRuntime";
import {
  createExtensionDraft,
  extensionKindLabels,
  type AgentExtension,
  type ExtensionCatalog,
  type ExtensionChoice,
  type ExtensionInvocation,
  type ExtensionItem,
  type ExtensionKind,
} from "./extensionModel";
import { createBrowserExtensionRepository } from "./extensionRepository";
import { ExtensionWorkspace, getAgentReferenceField } from "./extensionWorkspace";
import styles from "./ExtensionPocPage.module.css";

const kinds: ExtensionKind[] = ["agent", "skill", "mcp", "plugin"];

export function ExtensionPocPage() {
  const workspace = useMemo(
    () => new ExtensionWorkspace(createBrowserExtensionRepository()),
    [],
  );
  const catalog = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
  );
  const websocketUrl =
    import.meta.env.VITE_COPILOT_WS_URL ?? "ws://localhost:8080/ws/copilot";
  const [controller, setController] = useState<BeComparisonRuntimeController>();
  const [secondaryEnabled, setSecondaryEnabled] = useState(true);
  const [draft, setDraft] = useState<ExtensionItem>(() =>
    cloneItem(catalog.items.find((item) => item.kind === "agent") ?? createExtensionDraft("agent")),
  );
  const [selectedInvocationId, setSelectedInvocationId] = useState<string>();
  const [lastInvocation, setLastInvocation] = useState<ExtensionInvocation>();
  const [reference, setReference] = useState<{ id: string; text: string }>();
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const next = createBeComparisonRuntime({
      websocketUrl,
      threadId: "extension-poc",
    });
    setController(next);
    return () => {
      void next.dispose();
    };
  }, [websocketUrl]);

  useEffect(() => {
    controller?.setSecondaryAgentEnabled(secondaryEnabled);
  }, [controller, secondaryEnabled]);

  const extensions = useMemo<DemoChatExtensions | undefined>(() => {
    if (!controller) return undefined;
    return Object.assign(createChatExtensionStore(), {
      resolveMessageById: (id: string) =>
        findChatMessageById(controller.runtime, id),
      chatFromHere: (message: DemoMessage) =>
        setReference({ id: message.id, text: getDemoMessageText(message) }),
    });
  }, [controller]);

  const selectDraft = (item: ExtensionItem) => {
    setDraft(cloneItem(item));
    setFormError("");
  };

  const saveDraft = () => {
    try {
      setDraft(cloneItem(workspace.save(draft)));
      setFormError("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败。");
    }
  };

  const removeDraft = () => {
    if (!draft.id || !window.confirm(`删除「${draft.name}」？`)) return;
    workspace.remove(draft.id);
    if (selectedInvocationId === draft.id) setSelectedInvocationId(undefined);
    setDraft(createExtensionDraft(draft.kind));
    setFormError("");
  };

  const sendMessage = (text: string): boolean => {
    if (!controller || !text.trim()) return false;
    try {
      const invocation = selectedInvocationId
        ? workspace.buildInvocation(selectedInvocationId, text.trim())
        : undefined;
      controller.queue.enqueue({
        text: text.trim(),
        referencedMessageId: reference?.id,
        data: invocation ? { invocation } : undefined,
      });
      setLastInvocation(invocation);
      setReference(undefined);
      setSelectedInvocationId(undefined);
      return true;
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "调用准备失败。");
      return false;
    }
  };

  const selectedInvocation = catalog.items.find(
    (item) => item.id === selectedInvocationId && item.enabled,
  );

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar} aria-label="扩展目录">
        <div className={styles.sidebarHeader}>
          <span className={styles.overline}>EXTENSION POC</span>
          <h1>你的工作台</h1>
          <p>自定义 Agent、Skill、MCP 和 Plugin</p>
        </div>
        <div className={styles.createGrid} aria-label="新建扩展">
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => selectDraft(createExtensionDraft(kind))}
            >
              + {extensionKindLabels[kind]}
            </button>
          ))}
        </div>
        <div className={styles.catalogList}>
          {kinds.map((kind) => {
            const items = catalog.items.filter((item) => item.kind === kind);
            return (
              <section key={kind} aria-label={extensionKindLabels[kind]}>
                <h2>{extensionKindLabels[kind]}</h2>
                {items.length === 0 ? (
                  <p className={styles.emptyGroup}>尚未创建</p>
                ) : (
                  items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={styles.catalogItem}
                      data-active={draft.id === item.id}
                      onClick={() => selectDraft(item)}
                    >
                      <span>{item.name}</span>
                      {!item.enabled && <small>停用</small>}
                    </button>
                  ))
                )}
              </section>
            );
          })}
        </div>
        <a className={styles.backLink} href="/">返回原 demo</a>
      </aside>

      <section className={styles.chatColumn} aria-label="Compare Agent POC">
        <header className={styles.chatHeader}>
          <div>
            <span className={styles.overline}>COMPARE AGENT RUNTIME</span>
            <h2>Chat 工作区</h2>
            <p>Agent A 始终运行；Agent B 可按轮次关闭，不重建会话。</p>
          </div>
          <label className={styles.agentToggle}>
            <input
              type="checkbox"
              checked={secondaryEnabled}
              onChange={(event) => setSecondaryEnabled(event.target.checked)}
            />
            <span>Agent B {secondaryEnabled ? "开启" : "关闭"}</span>
          </label>
        </header>

        <div className={styles.chatViewport}>
          {controller && extensions ? (
            <ChatRuntimeView
              runtime={controller.runtime}
              renderer={demoRenderer}
              extensions={extensions}
              renderInput={renderDemoInput}
              classNames={{
                root: styles.runtime,
                branch: styles.branch,
              }}
              empty={<p className={styles.chatEmpty}>从下方输入框开始对话。</p>}
              loadingIndicator={<p className={styles.loading}>正在生成回复…</p>}
            />
          ) : (
            <p className={styles.chatEmpty}>正在初始化 Compare Agent…</p>
          )}
        </div>

        <div className={styles.composerArea}>
          <p className={styles.pocNote}>
            扩展配置和 / 调用目前仅在 UI 层生成 invocation；实际 Agent 指令、Skill、MCP、Plugin 尚未发送给 BE 执行。
          </p>
          <ExtensionComposer
            workspace={workspace}
            catalog={catalog}
            selected={selectedInvocation}
            reference={reference}
            disabled={!controller}
            onSelect={setSelectedInvocationId}
            onClearReference={() => setReference(undefined)}
            onSend={sendMessage}
          />
          {lastInvocation && (
            <details className={styles.invocationPreview}>
              <summary>最近一次调用的 UI 层 POJO</summary>
              <pre>{JSON.stringify(lastInvocation, null, 2)}</pre>
            </details>
          )}
        </div>
      </section>

      <aside className={styles.inspector} aria-label="扩展设置">
        <ExtensionEditor
          draft={draft}
          catalog={catalog}
          error={formError}
          onChange={setDraft}
          onSave={saveDraft}
          onRemove={removeDraft}
        />
      </aside>
    </main>
  );
}

function ExtensionEditor({
  draft,
  catalog,
  error,
  onChange,
  onSave,
  onRemove,
}: {
  draft: ExtensionItem;
  catalog: ExtensionCatalog;
  error: string;
  onChange(item: ExtensionItem): void;
  onSave(): void;
  onRemove(): void;
}) {
  const update = (patch: Partial<ExtensionItem>) =>
    onChange({ ...draft, ...patch } as ExtensionItem);
  const toggleRef = (kind: ExtensionKind, id: string) => {
    if (draft.kind !== "agent") return;
    const field = getAgentReferenceField(kind);
    if (!field) return;
    const values = draft[field];
    onChange({
      ...draft,
      [field]: values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    } as AgentExtension);
  };

  return (
    <div className={styles.editorPanel}>
      <span className={styles.overline}>EXTENSION EDITOR</span>
      <h2>{draft.id ? "编辑" : "新建"}{extensionKindLabels[draft.kind]}</h2>
      <p>配置保存在浏览器本地；数据源可替换。</p>
      <label className={styles.field}>
        名称
        <input
          value={draft.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder={`例如：我的${extensionKindLabels[draft.kind]}`}
        />
      </label>
      <label className={styles.field}>
        描述
        <input
          value={draft.description}
          onChange={(event) => update({ description: event.target.value })}
          placeholder="用于 / 菜单搜索和说明"
        />
      </label>
      <label className={styles.enabledField}>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        在 / 菜单中启用
      </label>

      {draft.kind === "agent" && (
        <>
          <label className={styles.field}>
            自定义 Prompt
            <textarea
              rows={6}
              value={draft.prompt}
              onChange={(event) => update({ prompt: event.target.value } as Partial<ExtensionItem>)}
              placeholder="设定这个 Agent 的职责和行为…"
            />
          </label>
          {(["skill", "mcp", "plugin"] as const).map((kind) => {
            const field = getAgentReferenceField(kind)!;
            const available = catalog.items.filter((item) => item.kind === kind);
            return (
              <fieldset className={styles.referenceGroup} key={kind}>
                <legend>关联 {extensionKindLabels[kind]}</legend>
                {available.length === 0 ? (
                  <p>先在左侧新建 {extensionKindLabels[kind]}。</p>
                ) : (
                  available.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={draft[field].includes(item.id)}
                        onChange={() => toggleRef(kind, item.id)}
                      />
                      {item.name}
                    </label>
                  ))
                )}
              </fieldset>
            );
          })}
        </>
      )}
      {draft.kind === "skill" && (
        <label className={styles.field}>
          Skill 指令
          <textarea
            rows={9}
            value={draft.instructions}
            onChange={(event) => update({ instructions: event.target.value } as Partial<ExtensionItem>)}
            placeholder="描述何时使用，以及具体执行步骤…"
          />
        </label>
      )}
      {draft.kind === "mcp" && (
        <label className={styles.field}>
          MCP Endpoint（仅配置）
          <input
            value={draft.endpoint}
            onChange={(event) => update({ endpoint: event.target.value } as Partial<ExtensionItem>)}
            placeholder="https://example.com/mcp"
          />
        </label>
      )}
      {draft.kind === "plugin" && (
        <label className={styles.field}>
          Plugin Manifest URL（仅配置）
          <input
            value={draft.manifestUrl}
            onChange={(event) => update({ manifestUrl: event.target.value } as Partial<ExtensionItem>)}
            placeholder="https://example.com/plugin.json"
          />
        </label>
      )}
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.editorActions}>
        <button type="button" onClick={onSave}>保存配置</button>
        {draft.id && <button type="button" onClick={onRemove}>删除</button>}
      </div>
    </div>
  );
}

function ExtensionComposer({
  workspace,
  catalog,
  selected,
  reference,
  disabled,
  onSelect,
  onClearReference,
  onSend,
}: {
  workspace: ExtensionWorkspace;
  catalog: ExtensionCatalog;
  selected?: ExtensionItem;
  reference?: { id: string; text: string };
  disabled: boolean;
  onSelect(id?: string): void;
  onClearReference(): void;
  onSend(text: string): boolean;
}) {
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [activeChoice, setActiveChoice] = useState(0);
  const [text, setText] = useState("");
  const choices = useMemo(
    () => workspace.choices(slashQuery ?? ""),
    [workspace, catalog, slashQuery],
  );
  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: styles.tiptapEditor,
        "aria-label": "消息输入框，输入 / 选择扩展",
      },
    },
    onUpdate: ({ editor: current }) => {
      setText(current.getText({ blockSeparator: "\n" }));
      syncSlashQuery(current, setSlashQuery);
    },
    onSelectionUpdate: ({ editor: current }) =>
      syncSlashQuery(current, setSlashQuery),
  });

  const selectChoice = (choice: ExtensionChoice) => {
    if (!editor) return;
    const before = editor.state.selection.$from.parent.textBetween(
      0,
      editor.state.selection.$from.parentOffset,
    );
    const match = before.match(/\/[^\s/]*$/);
    if (match) {
      editor.chain().focus().deleteRange({
        from: editor.state.selection.from - match[0].length,
        to: editor.state.selection.from,
      }).run();
    }
    onSelect(choice.id);
    setSlashQuery(null);
    setActiveChoice(0);
    editor.commands.focus();
  };

  const submit = () => {
    const message = editor?.getText({ blockSeparator: "\n" }).trim() ?? "";
    if (!message || disabled) return;
    if (!onSend(message)) return;
    editor?.commands.clearContent();
    setText("");
    setSlashQuery(null);
  };

  return (
    <div className={styles.composer}>
      {slashQuery !== null && (
        <div className={styles.slashMenu} role="listbox" aria-label="选择扩展">
          <div className={styles.slashTitle}>调用扩展 · /{slashQuery}</div>
          {choices.length === 0 ? (
            <p>没有匹配的扩展。可先在左侧新建。</p>
          ) : (
            choices.map((choice, index) => (
              <button
                key={choice.id}
                type="button"
                role="option"
                aria-selected={index === activeChoice}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectChoice(choice)}
              >
                <span className={styles.choiceKind}>{extensionKindLabels[choice.kind]}</span>
                <span className={styles.choiceText}>
                  <strong>{choice.name}</strong>
                  <small>{choice.description || "无描述"}</small>
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {reference && (
        <div className={styles.selectedChip}>
          <strong>Chat from here</strong>
          <span title={reference.text}>{reference.text}</span>
          <button type="button" onClick={onClearReference} aria-label="移除引用">×</button>
        </div>
      )}
      {selected && (
        <div className={styles.selectedChip}>
          <strong>{extensionKindLabels[selected.kind]}</strong>
          <span>{selected.name}</span>
          <button type="button" onClick={() => onSelect(undefined)} aria-label="移除扩展">×</button>
        </div>
      )}
      <div
        className={styles.editorFrame}
        onKeyDownCapture={(event) => {
          if (slashQuery !== null) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              setActiveChoice((value) => (value + 1) % Math.max(choices.length, 1));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              event.stopPropagation();
              setActiveChoice((value) => (value - 1 + Math.max(choices.length, 1)) % Math.max(choices.length, 1));
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setSlashQuery(null);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              if (choices[activeChoice]) selectChoice(choices[activeChoice]);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            submit();
          }
        }}
      >
        {!text && <span className={styles.placeholder} aria-hidden="true">输入消息，或输入 / 调用扩展…</span>}
        <EditorContent editor={editor} />
      </div>
      <div className={styles.composerFooter}>
        <button
          type="button"
          className={styles.slashButton}
          onClick={() => editor?.chain().focus().insertContent("/").run()}
          aria-label="打开扩展命令菜单"
        >
          /
        </button>
        <span>Enter 发送 · Shift + Enter 换行</span>
        <button type="button" className={styles.sendButton} disabled={disabled || !text.trim()} onClick={submit}>
          发送 ↑
        </button>
      </div>
    </div>
  );
}

function syncSlashQuery(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  setQuery: (query: string | null) => void,
) {
  const before = editor.state.selection.$from.parent.textBetween(
    0,
    editor.state.selection.$from.parentOffset,
  );
  const match = before.match(/(?:^|\s)\/([^\s/]*)$/);
  setQuery(match ? match[1] : null);
}

function cloneItem(item: ExtensionItem): ExtensionItem {
  return item.kind === "agent"
    ? {
        ...item,
        skillIds: [...item.skillIds],
        mcpIds: [...item.mcpIds],
        pluginIds: [...item.pluginIds],
      }
    : { ...item };
}

function renderDemoInput(props: FrameCardProps<DemoMessage>) {
  const Card = demoRenderer.getCard(props.message, props.context);
  return <Card {...props} />;
}
