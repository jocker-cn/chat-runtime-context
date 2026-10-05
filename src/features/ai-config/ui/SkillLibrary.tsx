import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DefinitionRecord } from "../domain/models";
import type { SkillWorkspace } from "../controllers/skillWorkspace";
import { addSkillFile, newSkillEditor, removeSkillFile, skillEditorView, updateSkillField, updateSkillFile, type SkillEditorModel } from "../controllers/skillEditorModel";
import { bundleFromMarkdown, decodeText, exportSkillZip, importSkillZip, readSkillBundle } from "../adapters/skillPackage";
import styles from "./SkillLibrary.module.css";
import { DefinitionDirectory, DefinitionEditor, DefinitionManager } from "./DefinitionManager";
import managerStyles from "./DefinitionManager.module.css";

export function SkillLibrary({ workspace, legacySkills = [] }: {
  workspace: SkillWorkspace; legacySkills?: { id: string; name: string; description: string; instructions: string }[];
}) {
  const snapshot = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [model, setModel] = useState(newSkillEditor);
  const [record, setRecord] = useState<DefinitionRecord>();
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  const [mode, setMode] = useState<"form" | "source">("form");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); const [dirty, setDirty] = useState(false);
  const [newPath, setNewPath] = useState(""); const [viewRevision, setViewRevision] = useState<number>();
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"content" | "management">("content");
  const initialized = useRef(false); const generation = useRef(0);
  const view = useMemo(() => skillEditorView(model, selectedPath), [model, selectedPath]);
  const readOnly = viewRevision !== undefined;
  const update = (next: SkillEditorModel) => { setModel(next); setDirty(true); setNotice(""); setError(""); };
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : "操作失败。");
  const canDiscard = () => !dirty || window.confirm("尚有未保存的 Skill 修改，确定放弃吗？");
  const open = async (id: string, force = false) => {
    if (!force && !canDiscard()) return;
    const current = ++generation.current; setBusy(true); setError("");
    try {
      const result = await workspace.open(id);
      if (current !== generation.current) return;
      setRecord(result.record); setModel({ displayName: result.record.meta.displayName, tags: result.record.meta.tags.join(", "), bundle: result.bundle });
      setSelectedPath("SKILL.md"); setViewRevision(undefined); setDirty(false); setNotice("");
      setPanel("content");
    } catch (cause) { if (current === generation.current) report(cause); }
    finally { if (current === generation.current) setBusy(false); }
  };
  useEffect(() => {
    if (!initialized.current && snapshot.status === "ready") {
      initialized.current = true;
      if (snapshot.definitions[0]) void open(snapshot.definitions[0].id, true);
    }
    return () => { initialized.current = false; generation.current++; };
  }, [snapshot.status]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (cause) { report(cause); } finally { setBusy(false); }
  };
  const save = async (publish: boolean) => {
    if (publish && view.diagnostics.some((issue) => issue.severity === "error")) { setError("请先修复校验错误，再发布。"); return; }
    await run(async () => {
      let next = await workspace.save(view.details, model.bundle, record);
      setRecord(next); setDirty(false);
      if (publish) { next = await workspace.publish(next); setRecord(next); }
      setNotice(publish ? `已发布 v${next.meta.publishedRevision}；历史版本保持不变。` : "草稿已保存；未发布的修改不会进入 / 菜单。");
    });
  };
  const importFile = async (file?: File) => {
    if (!file || !canDiscard()) return;
    await run(async () => {
      if (file.size > 12 * 1024 * 1024) throw new Error("导入文件不能超过 12 MiB。");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bundle = file.name.toLowerCase().endsWith(".zip") ? importSkillZip(bytes) : bundleFromMarkdown(decodeText(bytes));
      setModel({ displayName: bundle.rootDirectory, tags: "", bundle }); setRecord(undefined);
      setSelectedPath("SKILL.md"); setViewRevision(undefined); setDirty(true); setMode("source");
      setPanel("content");
      setNotice("文件包已载入编辑器。校验后保存草稿，不会自动发布。");
    });
  };
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([new Uint8Array(exportSkillZip(model.bundle))], { type: "application/zip" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${model.bundle.rootDirectory}.zip`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { report(cause); }
  };
  const field = (key: string, value: string) => { try { update(updateSkillField(model, key, value)); } catch (cause) { report(cause); } };
  const filteredDefinitions = snapshot.definitions.filter((item) => `${item.displayName} ${item.slug} ${item.summary} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const errorCount = view.diagnostics.filter((issue) => issue.severity === "error").length;

  return <DefinitionManager label="Skill 文件包管理" directory={
    <DefinitionDirectory title="Skills" count={snapshot.definitions.length}
      tools={<>
      <button type="button" disabled={busy} onClick={() => {
        if (!canDiscard()) return; initialized.current = true; generation.current++; setRecord(undefined);
        setModel(newSkillEditor()); setSelectedPath("SKILL.md"); setViewRevision(undefined); setDirty(false); setError(""); setNotice("");
        setPanel("content");
      }}>+ Skill</button>
      <label className={`${managerStyles.button} ${styles.importButton}`}>导入文件包<input aria-label="导入 Skill 文件包" type="file" accept=".md,.zip" disabled={busy}
        onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      </>}
      search={<input type="search" aria-label="搜索 Skill" placeholder="搜索名称、标签或描述" value={query} onChange={(event) => setQuery(event.target.value)} />}
      footer={legacySkills.some((item) => item.id !== "release-skill") ? <details className={styles.legacy}>
        <summary>导入旧 POC Skill</summary>
        {legacySkills.filter((item) => item.id !== "release-skill").map((item) => <button key={item.id} type="button" disabled={busy} onClick={() => {
          if (!canDiscard()) return;
          const bundle = bundleFromMarkdown(`---\nname: imported-skill\ndescription: ${JSON.stringify(item.description || "请补充用途和使用场景。 ")}\n---\n${item.instructions}`);
          setModel({ displayName: item.name, tags: "", bundle }); setRecord(undefined); setViewRevision(undefined); setSelectedPath("SKILL.md"); setDirty(true); setPanel("content");
          setNotice("旧内容仅载入为新草稿；旧 localStorage 原文保留，可恢复。发布前请调整唯一机器名。");
        }}>{item.name}</button>)}
      </details> : undefined}>
      {snapshot.status === "loading" && <p role="status">正在加载本地目录…</p>}
      {snapshot.status === "error" && <div role="alert">{snapshot.error}<button type="button" onClick={() => void workspace.start()}>重试加载</button></div>}
      {filteredDefinitions.map((item) => <button key={item.id} type="button" disabled={busy} aria-label={item.displayName}
        className={managerStyles.entry} aria-pressed={record?.meta.id === item.id} onClick={() => void open(item.id)}>
        <strong>{item.displayName}</strong><small>{item.summary || item.slug}</small><small>{item.publishedRevision ? `已发布 v${item.publishedRevision}` : "草稿"}</small>
      </button>)}
      {snapshot.status === "ready" && filteredDefinitions.length === 0 && <p className={managerStyles.empty}>{snapshot.definitions.length ? "没有匹配的 Skill，试试其他关键词。" : "还没有 Skill。新建一个，或导入 SKILL.md / ZIP。"}</p>}
    </DefinitionDirectory>
  }>
    <DefinitionEditor label="Skill 编辑器" busy={busy} title={readOnly ? `发布版本 v${viewRevision} · 只读` : model.displayName || "新建 Skill"}
      status={<>{busy ? "正在处理…" : dirty ? "未保存修改" : record?.meta.publishedRevision ? `当前发布 v${record.meta.publishedRevision}` : "未发布草稿"}{errorCount > 0 && <span className={styles.invalid}> · {errorCount} 项待修复</span>}</>}
      actions={<>
          <button type="button" onClick={download} disabled={busy}>导出 ZIP</button>
          {!readOnly && <><button type="button" onClick={() => void save(false)} disabled={busy}>保存草稿</button>
            <button className={managerStyles.primary} type="button" onClick={() => void save(true)} disabled={busy}>校验并发布</button></>}
          {readOnly && <button type="button" onClick={() => record && void open(record.meta.id)}>返回草稿</button>}
      </>}>
      {error && <div className={`${managerStyles.feedback} ${managerStyles.error}`} role="alert">{error}
        {record && <button type="button" disabled={busy} onClick={() => void open(record.meta.id)}>重新载入</button>}</div>}
      {notice && <p className={managerStyles.feedback} role="status">{notice}</p>}
      <div className={managerStyles.tabs} role="group" aria-label="Skill 编辑区域">
        <button type="button" aria-pressed={panel === "content"} onClick={() => setPanel("content")}>内容编辑</button>
        <button type="button" aria-pressed={panel === "management"} onClick={() => setPanel("management")}>版本与设置</button>
      </div>
      <div className={styles.library} hidden={panel !== "content"}>
      <section className={managerStyles.section} aria-label="Skill 基本信息">
      <h3>基本信息</h3>
      <fieldset disabled={busy || readOnly} className={styles.fields}>
        <label>展示名称<input aria-label="Skill 展示名称" placeholder="例如：发布风险检查" value={model.displayName} onChange={(event) => update({ ...model, displayName: event.target.value })} /></label>
        <label>标签<input value={model.tags} placeholder="多个标签用逗号分隔" onChange={(event) => update({ ...model, tags: event.target.value })} /></label>
      </fieldset>
      </section>
      <div className={styles.packageEditor}>
        <aside className={styles.files} aria-label="Skill 文件树">
          <strong>文件包 <span>{model.bundle.files.length}</span></strong>
          <div className={styles.fileList}>
          {model.bundle.files.map((file) => <button type="button" key={file.path} aria-pressed={selectedPath === file.path} onClick={() => setSelectedPath(file.path)} title={file.path}>{file.path}</button>)}
          </div>
          {!readOnly && <div className={styles.addFile}>
            <input aria-label="新增文件路径" value={newPath} placeholder="references/guide.md" disabled={busy} onChange={(event) => setNewPath(event.target.value)} />
            <button type="button" disabled={busy} onClick={() => { try { update(addSkillFile(model, newPath)); setSelectedPath(newPath); setNewPath(""); } catch (cause) { report(cause); } }}>添加文本文件</button>
            <label className={`${managerStyles.button} ${styles.importButton}`}>添加附件<input type="file" aria-label="添加 Skill 附件" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (file) void run(async () => {
                if (file.size > 2 * 1024 * 1024) throw new Error("附件不能超过 2 MiB。");
                const path = newPath || `assets/${file.name}`;
                update(addSkillFile(model, path, new Uint8Array(await file.arrayBuffer()))); setSelectedPath(path); setNewPath("");
              });
            }} /></label>
          </div>}
        </aside>
        <div className={styles.fileContent}>
          <header><strong>{selectedPath}</strong>
            {selectedPath === "SKILL.md" ? <div role="tablist" aria-label="主文件编辑方式">
              <button type="button" role="tab" aria-selected={mode === "form"} onClick={() => setMode("form")}>表单</button>
              <button type="button" role="tab" aria-selected={mode === "source"} onClick={() => setMode("source")}>源码</button></div>
              : !readOnly && <button type="button" disabled={busy} onClick={() => { update(removeSkillFile(model, selectedPath)); setSelectedPath("SKILL.md"); }}>移除文件</button>}
          </header>
          {selectedPath === "SKILL.md" && mode === "form" ? <fieldset disabled={busy || readOnly} className={styles.form}>
            <label>标准 name<input aria-label="Skill 标准 name" value={view.metadata?.name ?? ""} onChange={(event) => field("name", event.target.value)} /></label>
            <label>用途与触发场景<textarea aria-label="Skill description" rows={3} value={view.metadata?.description ?? ""} onChange={(event) => field("description", event.target.value)} /></label>
            <label>工作流指令<textarea aria-label="Skill 工作流指令" rows={10} value={view.body} onChange={(event) => field("body", event.target.value)} /></label>
            <details className={styles.optionalMetadata}>
            <summary>可选元数据</summary>
            <div className={styles.fields}>
              <label>License<input value={view.metadata?.license ?? ""} onChange={(event) => field("license", event.target.value)} /></label>
              <label>Compatibility<input value={view.metadata?.compatibility ?? ""} onChange={(event) => field("compatibility", event.target.value)} /></label>
            </div>
            </details>
            <p className={styles.hint}>metadata、allowed-tools 和注释可在源码中编辑；表单不会丢弃这些内容。</p>
          </fieldset> : view.text !== undefined ? <textarea className={styles.source} aria-label={`${selectedPath} 源码`} value={view.text} rows={20} readOnly={readOnly} disabled={busy}
            spellCheck={false} onChange={(event) => update(updateSkillFile(model, selectedPath, event.target.value))} />
            : <p className={styles.hint}>二进制附件 · {view.selected?.bytes.length ?? 0} bytes。导出时保留原始字节，不执行或嵌入预览。</p>}
        </div>
      </div>
      <section className={styles.diagnostics} aria-label="Skill 校验结果">
        <strong>校验结果</strong>
        {view.diagnostics.length === 0 ? <p>标准文件与包路径校验通过。发布时会再次检查。</p> : <ul>{view.diagnostics.map((issue, index) => <li key={index} data-severity={issue.severity}>
          {issue.severity === "error" ? "错误" : "提醒"} · {issue.path}{issue.line ? `:${issue.line}` : ""} — {issue.message}</li>)}</ul>}
      </section>
      </div>
      <div className={styles.library} hidden={panel !== "management"}>
        <section className={managerStyles.section} aria-label="Skill 文件包设置">
          <h3>文件包设置</h3>
          <fieldset disabled={busy || readOnly} className={styles.fields}>
            <label>包根目录<input aria-label="Skill 包根目录" value={model.bundle.rootDirectory} onChange={(event) => update({ ...model, bundle: { ...model.bundle, rootDirectory: event.target.value } })} /></label>
          </fieldset>
          <p className={managerStyles.hint}>根目录需与 SKILL.md 的标准 name 一致。修改标准 name 时会同步更新根目录。</p>
        </section>
      <section className={managerStyles.section} aria-label="Skill 发布历史">
        <h3>发布历史</h3>
        {!record?.revisions.length && <p className={managerStyles.hint}>尚未发布。发布后可以在这里查看只读历史版本。</p>}
        <div className={styles.revisions}>
        {record?.revisions.map((revision) => <button type="button" disabled={busy} key={revision.revision} onClick={() => {
          if (!canDiscard()) return;
          void run(async () => {
            if (revision.spec.kind !== "skill") return;
            const bundle = await readSkillBundle(revision.spec, workspace.repository.getBlob);
            setModel({ displayName: record.meta.displayName, tags: record.meta.tags.join(", "), bundle });
            setViewRevision(revision.revision); setDirty(false); setSelectedPath("SKILL.md");
            setPanel("content");
          });
        }}>查看 v{revision.revision}</button>)}
        </div>
      </section>
      {record && <section className={managerStyles.section} aria-label="Skill 可用性管理">
        <h3>可用性</h3>
        <p className={managerStyles.hint}>{record.availability.enabled ? "已启用，发布版本可出现在 / 菜单。" : "已停用，不会出现在 / 菜单，历史版本仍保留。"}</p>
        <div className={styles.revisions}>
        <button type="button" disabled={busy || dirty || readOnly} onClick={() => void run(async () => {
          setRecord(await workspace.service.setEnabled(record, !record.availability.enabled)); await workspace.refresh();
        })}>{record.availability.enabled ? "停用 Skill" : "启用 Skill"}</button>
        <button type="button" className={managerStyles.danger} disabled={busy || dirty || readOnly} onClick={() => {
          if (!window.confirm("归档后不再出现在调用菜单，历史版本仍然保留。继续吗？")) return;
          void run(async () => { await workspace.service.archive(record); await workspace.refresh(); setRecord(undefined); setModel(newSkillEditor()); });
        }}>归档 Skill</button>
        </div>
        {(dirty || readOnly) && <p className={managerStyles.hint}>请先保存草稿或返回可编辑草稿，再更改可用性。</p>}
      </section>}
      </div>
    </DefinitionEditor>
  </DefinitionManager>;
}
