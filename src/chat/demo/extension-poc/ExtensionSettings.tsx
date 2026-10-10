import {useEffect, useMemo, useState, useSyncExternalStore, type ReactNode} from "react";
import {SkillLibrary} from "../../../features/ai-config/ui/SkillLibrary";
import {DefinitionDirectory, DefinitionEditor, DefinitionManager} from "../../../features/ai-config/ui/DefinitionManager";
import {createExtensionDraft, extensionKindLabels, type AgentExtension, type ExtensionCatalog, type ExtensionItem} from "./extensionModel";
import {getAgentReferenceField, getExtensionWorkspace} from "./extensionWorkspace";
import styles from "./ExtensionPocPage.module.css";
import managerStyles from "../../../features/ai-config/ui/DefinitionManager.module.css";

type SettingsProps = {onDirtyChange(dirty: boolean): void};

export function SkillSettings() {
    const {skills, workspace} = getExtensionWorkspace();
    const catalog = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
    useEffect(() => { void skills.start(); }, [skills]);
    return <SkillLibrary workspace={skills} legacySkills={catalog.items.filter((item) => item.kind === "skill")}/>;
}

export function AgentSettings({onDirtyChange}: SettingsProps) {
    const editor = useDefinitionSettings("agent", onDirtyChange);
    const draft = editor.draft as AgentExtension;
    const toggle = (field: "skillIds" | "mcpIds" | "pluginIds", id: string) => {
        const values = draft[field];
        editor.update({[field]: values.includes(id) ? values.filter((value) => value !== id) : [...values, id]});
    };
    return <DefinitionSettings editor={editor}>
        <section className={managerStyles.section} aria-label="Agent 行为指令">
            <h3>行为指令</h3>
            <label className={styles.field}>自定义 Prompt
                <textarea rows={8} value={draft.prompt} placeholder="设定这个 Agent 的职责和行为…"
                          onChange={(event) => editor.update({prompt: event.target.value})}/>
            </label>
        </section>
        <section className={managerStyles.section} aria-label="Agent 关联能力">
            <h3>关联能力</h3>
            <p className={managerStyles.hint}>选择这个 Agent 可以使用的 Skill、MCP 和 Plugin。</p>
            {(["skill", "mcp", "plugin"] as const).map((kind) => {
                const field = getAgentReferenceField(kind)!;
                const available = editor.catalog.items.filter((item) => item.kind === kind);
                return <fieldset className={styles.referenceGroup} key={kind}>
                    <legend>关联 {extensionKindLabels[kind]}</legend>
                    {available.length === 0 ? <p>先从左侧进入 {extensionKindLabels[kind]} 页面新建。</p> :
                        available.map((item) => <label key={item.id}>
                            <input type="checkbox" checked={draft[field].includes(item.id)} onChange={() => toggle(field, item.id)}/>
                            <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span>
                        </label>)}
                </fieldset>;
            })}
        </section>
    </DefinitionSettings>;
}

export function McpSettings({onDirtyChange}: SettingsProps) {
    const editor = useDefinitionSettings("mcp", onDirtyChange);
    const draft = editor.draft;
    return <DefinitionSettings editor={editor}>
        <section className={managerStyles.section} aria-label="MCP 连接配置">
            <h3>连接配置</h3>
            <label className={styles.field}>MCP Endpoint（仅配置）
                <input value={draft.kind === "mcp" ? draft.endpoint : ""} placeholder="https://example.com/mcp"
                       onChange={(event) => editor.update({endpoint: event.target.value})}/>
            </label>
            <p className={managerStyles.hint}>填写服务地址。当前仅保存配置，不在页面发起连接或填写密钥。</p>
        </section>
    </DefinitionSettings>;
}

export function PluginSettings({onDirtyChange}: SettingsProps) {
    const editor = useDefinitionSettings("plugin", onDirtyChange);
    const draft = editor.draft;
    return <DefinitionSettings editor={editor}>
        <section className={managerStyles.section} aria-label="Plugin 清单配置">
            <h3>插件清单</h3>
            <label className={styles.field}>Plugin Manifest URL（仅配置）
                <input value={draft.kind === "plugin" ? draft.manifestUrl : ""} placeholder="https://example.com/plugin.json"
                       onChange={(event) => editor.update({manifestUrl: event.target.value})}/>
            </label>
            <p className={managerStyles.hint}>填写插件清单地址。当前仅保存配置，不下载或执行插件。</p>
        </section>
    </DefinitionSettings>;
}

// Shared CRUD mechanics stay private. Each settings module owns its editor instance.
function useDefinitionSettings(kind: "agent" | "mcp" | "plugin", onDirtyChange: SettingsProps["onDirtyChange"]) {
    const {workspace, skills} = getExtensionWorkspace();
    const legacy = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
    const skillSnapshot = useSyncExternalStore(skills.subscribe, skills.getSnapshot);
    useEffect(() => { void skills.start(); }, [skills]);
    const catalog = useMemo<ExtensionCatalog>(() => ({version: 1, items: [
        ...legacy.items.filter((item) => item.kind !== "skill"),
        ...skillSnapshot.published.map((item) => ({...item, kind: "skill" as const, instructions: ""})),
    ]}), [legacy, skillSnapshot.published]);
    const [draft, setDraft] = useState(() => structuredClone(catalog.items.find((item) => item.kind === kind) ?? createExtensionDraft(kind)));
    const [query, setQuery] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const original = catalog.items.find((item) => item.id === draft.id) ?? createExtensionDraft(kind);
    const dirty = JSON.stringify(draft) !== JSON.stringify(original);
    useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
    const select = (item: ExtensionItem) => {
        if (dirty && !window.confirm("尚有未保存的配置修改，确定放弃吗？")) return;
        setDraft(structuredClone(item)); setError(""); setNotice("");
    };
    const update = (patch: Partial<ExtensionItem>) => { setDraft({...draft, ...patch} as ExtensionItem); setError(""); setNotice(""); };
    const save = () => {
        try { setDraft(structuredClone(workspace.save(draft))); setError(""); setNotice("配置已保存。"); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败。"); }
    };
    const remove = () => {
        if (!draft.id || !window.confirm(`删除「${draft.name}」？`)) return;
        workspace.remove(draft.id); setDraft(createExtensionDraft(kind)); setError(""); setNotice("");
    };
    const items = catalog.items.filter((item) => item.kind === kind);
    const filtered = items.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return {kind, catalog, draft, query, setQuery, error, notice, dirty, select, update, save, remove, items, filtered};
}

function DefinitionSettings({editor, children}: {editor: ReturnType<typeof useDefinitionSettings>; children: ReactNode}) {
    const {kind, draft} = editor;
    const label = extensionKindLabels[kind];
    return <DefinitionManager label={`${label} 配置管理`} directory={
        <DefinitionDirectory title={label} count={editor.items.length}
                             tools={<button type="button" onClick={() => editor.select(createExtensionDraft(kind))}>+ {label}</button>}
                             search={<input type="search" aria-label={`搜索 ${label}`} placeholder="搜索名称或描述"
                                            value={editor.query} onChange={(event) => editor.setQuery(event.target.value)}/>}>
            {editor.filtered.map((item) => <button key={item.id} type="button" className={managerStyles.entry}
                                                   aria-label={item.name} aria-pressed={draft.id === item.id} onClick={() => editor.select(item)}>
                <strong>{item.name}</strong><small>{item.description || "暂无描述"}</small><small>{item.enabled ? "已启用" : "已停用"}</small>
            </button>)}
            {editor.filtered.length === 0 && <p className={managerStyles.empty}>
                {editor.items.length ? "没有匹配的配置，试试其他关键词。" : "尚未创建。点击上方新建，或直接填写右侧表单。"}
            </p>}
        </DefinitionDirectory>
    }>
        <DefinitionEditor label="扩展设置" title={draft.name || `新建 ${label}`}
                          status={editor.dirty ? "未保存修改" : draft.id ? "已保存" : "新建配置"}
                          actions={<>
                              <button type="button" className={managerStyles.primary} onClick={editor.save}>保存配置</button>
                              {draft.id && <button type="button" className={managerStyles.danger} onClick={editor.remove}>删除</button>}
                          </>}>
            {editor.error && <p className={`${managerStyles.feedback} ${managerStyles.error}`} role="alert">{editor.error}</p>}
            {editor.notice && <p className={managerStyles.feedback} role="status">{editor.notice}</p>}
            <div className={styles.editorPanel}>
                <section className={managerStyles.section} aria-label="基本信息">
                    <h3>基本信息</h3>
                    <div className={styles.basicFields}>
                        <label className={styles.field}>名称
                            <input value={draft.name} placeholder={`例如：我的${label}`} onChange={(event) => editor.update({name: event.target.value})}/>
                        </label>
                        <label className={styles.field}>描述
                            <input value={draft.description} placeholder="用于 / 菜单搜索和说明" onChange={(event) => editor.update({description: event.target.value})}/>
                        </label>
                    </div>
                    <label className={styles.enabledField}>
                        <input type="checkbox" checked={draft.enabled} onChange={(event) => editor.update({enabled: event.target.checked})}/>
                        在 / 菜单中启用
                    </label>
                </section>
                {children}
            </div>
        </DefinitionEditor>
    </DefinitionManager>;
}
