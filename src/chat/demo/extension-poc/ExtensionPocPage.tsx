import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { ExtensionReferenceNode } from "./extensionReferenceNode";
import {
  createDemoChatSessions,
  createPocChatSession,
  nameChatSessionFromMessage,
  type PocChatSession,
} from "./chatSessionModel";
import styles from "./ExtensionPocPage.module.css";
import { ToolMenu, useToolMenu } from "../../../core/tools";
import { createExtensionToolMenu } from "./extensionToolMenu";
import { createIndexedDbAiRepository, SkillWorkspace, type AiDefinitionRepository } from "../../../features/ai-config";
import { SkillLibrary } from "../../../features/ai-config/ui/SkillLibrary";
import { DefinitionDirectory, DefinitionEditor, DefinitionManager } from "../../../features/ai-config/ui/DefinitionManager";
import managerStyles from "../../../features/ai-config/ui/DefinitionManager.module.css";
import "../../../theme/tokens.css";

const kinds: ExtensionKind[] = ["agent", "skill", "mcp", "plugin"];

export function ExtensionPocPage({ skillRepository }: { skillRepository?: AiDefinitionRepository } = {}) {
  const [skills] = useState(() => new SkillWorkspace(skillRepository ?? createIndexedDbAiRepository()));
  const workspace = useMemo(
    () => new ExtensionWorkspace(createBrowserExtensionRepository(), () => skills.getSnapshot().published),
    [skills],
  );
  const legacyCatalog = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
  );
  const skillSnapshot = useSyncExternalStore(skills.subscribe, skills.getSnapshot);
  const lifecycle = useRef(0);
  useEffect(() => {
    const version = ++lifecycle.current;
    void skills.start();
    return () => { queueMicrotask(() => { if (lifecycle.current === version) skills.repository.close(); }); };
  }, [skills]);
  const catalog = useMemo<ExtensionCatalog>(() => ({ version: 1, items: [
    ...legacyCatalog.items.filter((item) => item.kind !== "skill"),
    ...skillSnapshot.published.map((item) => ({ ...item, kind: "skill" as const, instructions: "" })),
  ] }), [legacyCatalog, skillSnapshot.published]);
  const [sessions, setSessions] = useState(createDemoChatSessions);
  const [activeChatId, setActiveChatId] = useState("extension-poc");
  const [activeFeature, setActiveFeature] = useState<ExtensionKind | null>(null);
  const [skillLibraryVisited, setSkillLibraryVisited] = useState(false);
  const [draft, setDraft] = useState<ExtensionItem>(() =>
    cloneItem(catalog.items.find((item) => item.kind === "agent") ?? createExtensionDraft("agent")),
  );
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const originalDraft = catalog.items.find((item) => item.id === draft.id) ?? createExtensionDraft(draft.kind);
  const draftDirty = JSON.stringify(draft) !== JSON.stringify(originalDraft);
  const canDiscardDraft = () => activeFeature === null || activeFeature === "skill" || !draftDirty || window.confirm("尚有未保存的配置修改，确定放弃吗？");

  const selectDraft = (item: ExtensionItem, force = false) => {
    if (!force && !canDiscardDraft()) return false;
    setDraft(cloneItem(item));
    setFormError("");
    setFormNotice("");
    return true;
  };
  const openFeature = (kind: ExtensionKind) => {
    if (activeFeature === kind) return;
    if (!selectDraft(catalog.items.find((item) => item.kind === kind) ?? createExtensionDraft(kind))) return;
    if (kind === "skill") setSkillLibraryVisited(true);
    setActiveFeature(kind);
    setDirectoryQuery("");
  };
  const openChat = (id: string, discardChecked = false) => {
    if (!discardChecked && !canDiscardDraft()) return;
    if (activeFeature && activeFeature !== "skill") selectDraft(originalDraft, true);
    setActiveChatId(id);
    setActiveFeature(null);
  };
  const newChat = () => {
    if (!canDiscardDraft()) return;
    const session = createPocChatSession();
    setSessions((current) => [session, ...current]);
    openChat(session.id, true);
  };
  const saveDraft = () => {
    try {
      setDraft(cloneItem(workspace.save(draft)));
      setFormError("");
      setFormNotice("配置已保存。");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "保存失败。");
    }
  };
  const removeDraft = () => {
    if (!draft.id || !window.confirm(`删除「${draft.name}」？`)) return;
    workspace.remove(draft.id);
    selectDraft(createExtensionDraft(draft.kind), true);
  };
  const directoryItems = catalog.items.filter((item) => item.kind === draft.kind);
  const filteredItems = directoryItems.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(directoryQuery.trim().toLocaleLowerCase()));

  return (
    <main className={styles.page} data-skill-status={skillSnapshot.status}>
      <aside className={styles.sidebar} aria-label="工作台导航">
        <div className={styles.sidebarHeader}>
          <span className={styles.overline}>AI WORKSPACE</span>
          <h1>你的工作台</h1>
        </div>
        <button className={styles.newChatButton} type="button" onClick={newChat}>
          <span aria-hidden="true">＋</span> 新建对话
        </button>
        <nav className={styles.featureNav} aria-label="功能选择">
          <h2>功能</h2>
          {kinds.map((kind) => (
            <button key={kind} type="button"
              aria-current={activeFeature === kind ? "page" : undefined}
              onClick={() => openFeature(kind)}>
              <span className={styles.featureIcon} aria-hidden="true">
                {kind === "agent" ? "A" : kind === "skill" ? "S" : kind === "mcp" ? "M" : "P"}
              </span>
              自定义 {extensionKindLabels[kind]}
            </button>
          ))}
        </nav>
        <section className={styles.historySection} aria-label="聊天历史">
          <h2>聊天历史</h2>
          <div className={styles.historyList}>
            {sessions.map((session) => (
              <button key={session.id} type="button" className={styles.historyItem}
                title={session.title}
                aria-current={!activeFeature && activeChatId === session.id ? "page" : undefined}
                onClick={() => openChat(session.id)}>
                <span>{session.title}</span>
              </button>
            ))}
          </div>
        </section>
        <footer className={styles.sidebarFooter}>
          <small>会话保留在当前页面，刷新后重置。</small>
          <a className={styles.backLink} href="/">返回原 demo ↗</a>
        </footer>
      </aside>

      <div className={styles.contentArea}>
        {sessions.map((session) => (
          <ChatSession key={session.id} session={session} workspace={workspace} catalog={catalog} skills={skills}
            hidden={activeFeature !== null || activeChatId !== session.id}
            onMessage={(text) => setSessions((current) => nameChatSessionFromMessage(current, session.id, text))}
          />
        ))}
        <section className={styles.settingsPage} aria-label="扩展管理页面" hidden={activeFeature === null}>
          {skillLibraryVisited && <div className={styles.skillPage} hidden={activeFeature !== "skill"}>
            <SkillLibrary workspace={skills} legacySkills={legacyCatalog.items.filter((item) => item.kind === "skill")} />
          </div>}
          {activeFeature !== "skill" && <DefinitionManager label={`${extensionKindLabels[draft.kind]} 配置管理`} directory={
            <DefinitionDirectory title={extensionKindLabels[draft.kind]} count={directoryItems.length}
              tools={<button type="button" onClick={() => selectDraft(createExtensionDraft(draft.kind))}>
                  + {extensionKindLabels[draft.kind]}
                </button>}
              search={<input type="search" aria-label={`搜索 ${extensionKindLabels[draft.kind]}`} placeholder="搜索名称或描述" value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} />}>
              {filteredItems.map((item) => (
                <button key={item.id} type="button" className={managerStyles.entry} aria-label={item.name}
                  aria-pressed={draft.id === item.id} onClick={() => selectDraft(item)}>
                  <strong>{item.name}</strong><small>{item.description || "暂无描述"}</small><small>{item.enabled ? "已启用" : "已停用"}</small>
                </button>
              ))}
              {filteredItems.length === 0 && <p className={managerStyles.empty}>{directoryItems.length ? "没有匹配的配置，试试其他关键词。" : "尚未创建。点击上方新建，或直接填写右侧表单。"}</p>}
            </DefinitionDirectory>
          }>
            <ExtensionEditor draft={draft} catalog={catalog} error={formError} notice={formNotice} dirty={draftDirty}
              onChange={(next) => { setDraft(next); setFormError(""); setFormNotice(""); }} onSave={saveDraft} onRemove={removeDraft} />
          </DefinitionManager>}
        </section>
      </div>
    </main>
  );
}

/** Stay mounted while hidden, retaining this chat's Runtime, drafts and scroll position. */
function ChatSession({ session, workspace, catalog, skills, hidden, onMessage }: {
  session: PocChatSession;
  workspace: ExtensionWorkspace;
  catalog: ExtensionCatalog;
  skills: SkillWorkspace;
  hidden: boolean;
  onMessage(text: string): void;
}) {
  const websocketUrl =
    import.meta.env.VITE_COPILOT_WS_URL ?? "ws://localhost:8080/ws/copilot";
  const [controller, setController] = useState<BeComparisonRuntimeController>();
  const [secondaryEnabled, setSecondaryEnabled] = useState(true);
  const [selectedInvocationId, setSelectedInvocationId] = useState<string>();
  const [selectedSkillRevision, setSelectedSkillRevision] = useState<number>();
  const [lastInvocation, setLastInvocation] = useState<ExtensionInvocation>();
  const [reference, setReference] = useState<{ id: string; text: string }>();
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const next = createBeComparisonRuntime({
      websocketUrl,
      threadId: session.id,
      includeDemoHistory: session.includeDemoHistory,
    });
    setController(next);
    return () => {
      void next.dispose();
    };
  }, [websocketUrl, session.id, session.includeDemoHistory]);

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

  const sendMessage = (text: string): boolean => {
    if (!controller || !text.trim()) return false;
    try {
      const selection = catalog.items.find((item) => item.id === selectedInvocationId && item.enabled);
      if (selectedInvocationId && !selection) throw new Error("所选能力已停用或归档，请重新选择。");
      const invocation: ExtensionInvocation | undefined = selection?.kind === "skill"
        ? { target: { kind: "skill", id: selection.id, revision: selectedSkillRevision ?? selection.revision }, message: text.trim() }
        : selectedInvocationId ? workspace.buildInvocation(selectedInvocationId, text.trim()) : undefined;
      controller.queue.enqueue({
        text: text.trim(),
        referencedMessageId: reference?.id,
        data: invocation ? { invocation } : undefined,
      });
      setLastInvocation(invocation);
      setReference(undefined);
      setSelectedInvocationId(undefined);
      setSelectedSkillRevision(undefined);
      setFormError("");
      onMessage(text);
      return true;
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "调用准备失败。");
      return false;
    }
  };

  const currentSelection = catalog.items.find(
    (item) => item.id === selectedInvocationId && item.enabled,
  );
  const selectedInvocation = currentSelection?.kind === "skill" ? { ...currentSelection, revision: selectedSkillRevision ?? currentSelection.revision } : currentSelection;

  return (
      <section className={styles.chatColumn} aria-label={`聊天：${session.title}`} hidden={hidden}>
        <header className={styles.chatHeader}>
          <div>
            <span className={styles.overline}>COMPARE AGENT RUNTIME</span>
            <h2>{session.title}</h2>
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
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <ExtensionComposer
            catalog={catalog}
            skills={skills}
            selected={selectedInvocation}
            reference={reference}
            disabled={!controller}
            onSelect={(id, revision) => { setSelectedInvocationId(id); setSelectedSkillRevision(revision); }}
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
  );
}

function ExtensionEditor({
  draft,
  catalog,
  error,
  notice,
  dirty,
  onChange,
  onSave,
  onRemove,
}: {
  draft: ExtensionItem;
  catalog: ExtensionCatalog;
  error: string;
  notice: string;
  dirty: boolean;
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
    <DefinitionEditor label="扩展设置" title={draft.name || `新建 ${extensionKindLabels[draft.kind]}`}
      status={dirty ? "未保存修改" : draft.id ? "已保存" : "新建配置"}
      actions={<>
        <button type="button" className={managerStyles.primary} onClick={onSave}>保存配置</button>
        {draft.id && <button type="button" className={managerStyles.danger} onClick={onRemove}>删除</button>}
      </>}>
      {error && <p className={`${managerStyles.feedback} ${managerStyles.error}`} role="alert">{error}</p>}
      {notice && <p className={managerStyles.feedback} role="status">{notice}</p>}
      <div className={styles.editorPanel}>
      <section className={managerStyles.section} aria-label="基本信息">
      <h3>基本信息</h3>
      <div className={styles.basicFields}>
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
      </div>
      <label className={styles.enabledField}>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        在 / 菜单中启用
      </label>
      </section>

      {draft.kind === "agent" && (
        <>
          <section className={managerStyles.section} aria-label="Agent 行为指令">
          <h3>行为指令</h3>
          <label className={styles.field}>
            自定义 Prompt
            <textarea
              rows={8}
              value={draft.prompt}
              onChange={(event) => update({ prompt: event.target.value } as Partial<ExtensionItem>)}
              placeholder="设定这个 Agent 的职责和行为…"
            />
          </label>
          </section>
          <section className={managerStyles.section} aria-label="Agent 关联能力">
          <h3>关联能力</h3>
          <p className={managerStyles.hint}>选择这个 Agent 可以使用的 Skill、MCP 和 Plugin。</p>
          {(["skill", "mcp", "plugin"] as const).map((kind) => {
            const field = getAgentReferenceField(kind)!;
            const available = catalog.items.filter((item) => item.kind === kind);
            return (
              <fieldset className={styles.referenceGroup} key={kind}>
                <legend>关联 {extensionKindLabels[kind]}</legend>
                {available.length === 0 ? (
                  <p>先从左侧进入 {extensionKindLabels[kind]} 页面新建。</p>
                ) : (
                  available.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={draft[field].includes(item.id)}
                        onChange={() => toggleRef(kind, item.id)}
                      />
                       <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span>
                    </label>
                  ))
                )}
              </fieldset>
            );
          })}
          </section>
        </>
      )}
      {draft.kind === "mcp" && (
        <section className={managerStyles.section} aria-label="MCP 连接配置">
        <h3>连接配置</h3>
        <label className={styles.field}>
          MCP Endpoint（仅配置）
          <input
            value={draft.endpoint}
            onChange={(event) => update({ endpoint: event.target.value } as Partial<ExtensionItem>)}
            placeholder="https://example.com/mcp"
          />
        </label>
        <p className={managerStyles.hint}>填写服务地址。当前仅保存配置，不在页面发起连接或填写密钥。</p>
        </section>
      )}
      {draft.kind === "plugin" && (
        <section className={managerStyles.section} aria-label="Plugin 清单配置">
        <h3>插件清单</h3>
        <label className={styles.field}>
          Plugin Manifest URL（仅配置）
          <input
            value={draft.manifestUrl}
            onChange={(event) => update({ manifestUrl: event.target.value } as Partial<ExtensionItem>)}
            placeholder="https://example.com/plugin.json"
          />
        </label>
        <p className={managerStyles.hint}>填写插件清单地址。当前仅保存配置，不下载或执行插件。</p>
        </section>
      )}
    </div>
    </DefinitionEditor>
  );
}

function ExtensionComposer({
  catalog,
  skills,
  selected,
  reference,
  disabled,
  onSelect,
  onClearReference,
  onSend,
}: {
  catalog: ExtensionCatalog;
  skills: SkillWorkspace;
  selected?: ExtensionItem;
  reference?: { id: string; text: string };
  disabled: boolean;
  onSelect(id?: string, revision?: number): void;
  onClearReference(): void;
  onSend(text: string): boolean;
}) {
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [previewId, setPreviewId] = useState<string>();
  const [skillPreview, setSkillPreview] = useState<{ key: string; text: string; error?: string }>();
  useEffect(() => {
    if (selected?.kind !== "skill" || !selected.revision || previewId !== selected.id) return;
    let active = true;
    const key = `${selected.id}:${selected.revision}`;
    void skills.publishedSource({ id: selected.id, revision: selected.revision }).then(
      (text) => { if (active) setSkillPreview({ key, text }); },
      (error: unknown) => { if (active) setSkillPreview({ key, text: "", error: error instanceof Error ? error.message : "Skill 读取失败。" }); },
    );
    return () => { active = false; };
  }, [skills, selected?.id, selected?.kind === "skill" ? selected.revision : undefined, previewId]);
  const editor = useEditor({
    extensions: [StarterKit, ExtensionReferenceNode],
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
      const referenceNode = findExtensionReference(current);
      onSelect(referenceNode?.id, referenceNode?.revision);
      if (!referenceNode) setPreviewId(undefined);
      syncSlashQuery(current, setSlashQuery);
    },
    onSelectionUpdate: ({ editor: current }) =>
      syncSlashQuery(current, setSlashQuery),
  });

  const selectChoice = useCallback((choice: ExtensionChoice) => {
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
    const existing = findExtensionReference(editor);
    if (existing) {
      editor.chain().focus().deleteRange({
        from: existing.from,
        to: existing.to,
      }).run();
    }
    editor.chain().focus().insertContent([
      {
        type: "extensionReference",
        attrs: { id: choice.id, kind: choice.kind, name: choice.name, revision: choice.revision ?? null },
      },
      { type: "text", text: " " },
    ]).run();
    onSelect(choice.id, choice.revision);
    setPreviewId(choice.id);
    setSlashQuery(null);
  }, [editor, onSelect]);

  const entries = useMemo(() => createExtensionToolMenu(catalog, selectChoice), [catalog, selectChoice]);
  const menu = useToolMenu({ entries, query: slashQuery ?? "", onClose: () => setSlashQuery(null) });
  useEffect(() => { if (slashQuery === null) menu.reset(); }, [slashQuery, menu.reset]);

  const submit = () => {
    const message = editor?.getText({ blockSeparator: "\n" }).trim() ?? "";
    if (!message || disabled) return;
    if (!onSend(message)) return;
    editor?.commands.clearContent();
    setText("");
    setSlashQuery(null);
    setPreviewId(undefined);
  };

  const previewKey = selected?.kind === "skill" ? `${selected.id}:${selected.revision}` : "";
  const previewContent = selected?.kind === "skill" && selected.revision
    ? skillPreview?.key === previewKey ? skillPreview.text : "正在加载 Skill 内容…"
    : selected ? getExtensionPreview(selected, catalog) : "";

  return (
    <div className={styles.composer}>
      {skillPreview?.key === previewKey && skillPreview.error && <p className={styles.formError} role="alert">{skillPreview.error}</p>}
      {slashQuery === null && selected && previewId === selected.id && previewContent && (
        <section className={styles.extensionPreview} aria-label={`${selected.name} 内容`}>
          <header>
            <div>
              <span>{extensionKindLabels[selected.kind]}</span>
              <strong>{selected.name}</strong>
            </div>
            <button type="button" onClick={() => setPreviewId(undefined)} aria-label="关闭扩展内容">×</button>
          </header>
          <div className={styles.extensionPreviewBody}>{previewContent}</div>
        </section>
      )}
      {slashQuery !== null && (
        <div className={styles.slashMenu}>
          <ToolMenu menu={menu} title={`调用扩展 · /${slashQuery}`} />
        </div>
      )}
      {reference && (
        <div className={styles.selectedChip}>
          <strong>Chat from here</strong>
          <span title={reference.text}>{reference.text}</span>
          <button type="button" onClick={onClearReference} aria-label="移除引用">×</button>
        </div>
      )}
      <div
        className={styles.editorFrame}
        onClick={(event) => {
          if (!(event.target instanceof Element)) return;
          const token = event.target.closest("[data-extension-token]");
          const id = token?.getAttribute("data-extension-id");
          if (id) setPreviewId(id);
        }}
        onKeyDownCapture={(event) => {
          if (event.nativeEvent.isComposing) return;
          const token = event.target instanceof Element
            ? event.target.closest("[data-extension-token]")
            : null;
          if (token && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            event.stopPropagation();
            const id = token.getAttribute("data-extension-id");
            if (id) setPreviewId(id);
            return;
          }
          if (slashQuery !== null) {
            if (menu.handleKey(event.key)) {
              event.preventDefault();
              event.stopPropagation();
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
        {!text && !selected && <span className={styles.placeholder} aria-hidden="true">输入消息，或输入 / 调用扩展…</span>}
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

function findExtensionReference(editor: Editor) {
  let found: { id: string; revision?: number; from: number; to: number } | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "extensionReference") {
      found = {
        id: String(node.attrs.id),
        revision: typeof node.attrs.revision === "number" ? node.attrs.revision : undefined,
        from: position,
        to: position + node.nodeSize,
      };
    }
  });
  return found;
}

function getExtensionPreview(item: ExtensionItem, catalog: ExtensionCatalog) {
  switch (item.kind) {
    case "skill":
      return item.instructions.trim();
    case "agent": {
      const linkedNames = catalog.items
        .filter((entry) =>
          entry.enabled &&
          [...item.skillIds, ...item.mcpIds, ...item.pluginIds].includes(entry.id),
        )
        .map((entry) => entry.name);
      return [
        item.prompt.trim(),
        linkedNames.length ? `关联能力：${linkedNames.join("、")}` : "",
      ].filter(Boolean).join("\n\n");
    }
    case "mcp":
      return item.endpoint.trim();
    case "plugin":
      return item.manifestUrl.trim();
  }
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
