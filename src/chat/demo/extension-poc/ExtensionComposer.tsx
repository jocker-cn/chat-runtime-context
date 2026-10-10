import {EditorContent, useEditor} from "@tiptap/react";
import type {Editor} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from "react";
import {ToolMenu, useToolMenu} from "../../../core/tools";
import {extensionKindLabels, type ExtensionCatalog, type ExtensionChoice, type ExtensionInvocation, type ExtensionItem} from "./extensionModel";
import {getExtensionWorkspace} from "./extensionWorkspace";
import {ExtensionReferenceNode} from "./extensionReferenceNode";
import {createExtensionToolMenu} from "./extensionToolMenu";
import type {ChatSubmission} from "./extensionPocRuntime";
import styles from "./ExtensionPocPage.module.css";

export function ExtensionComposer({reference, disabled = false, onClearReference, onNavigateReference, onSend}: {
    reference?: {id: string; text: string};
    disabled?: boolean;
    onClearReference(): void;
    onNavigateReference(id: string): void;
    onSend(message: ChatSubmission): void;
}) {
    const {workspace, skills} = getExtensionWorkspace();
    const legacy = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
    const skillSnapshot = useSyncExternalStore(skills.subscribe, skills.getSnapshot);
    useEffect(() => { void skills.start(); }, [skills]);
    const catalog = useMemo<ExtensionCatalog>(() => ({version: 1, items: [
        ...legacy.items.filter((item) => item.kind !== "skill"),
        ...skillSnapshot.published.map((item) => ({...item, kind: "skill" as const, instructions: ""})),
    ]}), [legacy, skillSnapshot.published]);
    const [selectedId, setSelectedId] = useState<string>();
    const [selectedRevision, setSelectedRevision] = useState<number>();
    const [lastInvocation, setLastInvocation] = useState<ExtensionInvocation>();
    const [formError, setFormError] = useState("");
    const currentSelection = catalog.items.find((item) => item.id === selectedId && item.enabled);
    const selected = currentSelection?.kind === "skill" ? {
        ...currentSelection, revision: selectedRevision ?? currentSelection.revision,
    } : currentSelection;
    const onSelect = useCallback((id?: string, revision?: number) => {
        setSelectedId(id);
        setSelectedRevision(revision);
    }, []);
    const [slashQuery, setSlashQuery] = useState<string | null>(null);
    const [text, setText] = useState("");
    const [previewId, setPreviewId] = useState<string>();
    const [skillPreview, setSkillPreview] = useState<{ key: string; text: string; error?: string }>();
    useEffect(() => {
        if (selected?.kind !== "skill" || !selected.revision || previewId !== selected.id) return;
        let active = true;
        const key = `${selected.id}:${selected.revision}`;
        void skills.publishedSource({id: selected.id, revision: selected.revision}).then(
            (text) => {
                if (active) setSkillPreview({key, text});
            },
            (error: unknown) => {
                if (active) setSkillPreview({
                    key,
                    text: "",
                    error: error instanceof Error ? error.message : "Skill 读取失败。"
                });
            },
        );
        return () => {
            active = false;
        };
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
        onUpdate: ({editor: current}) => {
            setText(current.getText({blockSeparator: "\n"}));
            const referenceNode = findExtensionReference(current);
            onSelect(referenceNode?.id, referenceNode?.revision);
            if (!referenceNode) setPreviewId(undefined);
            syncSlashQuery(current, setSlashQuery);
        },
        onSelectionUpdate: ({editor: current}) =>
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
                attrs: {id: choice.id, kind: choice.kind, name: choice.name, revision: choice.revision ?? null},
            },
            {type: "text", text: " "},
        ]).run();
        onSelect(choice.id, choice.revision);
        setPreviewId(choice.id);
        setSlashQuery(null);
    }, [editor, onSelect]);

    const entries = useMemo(() => createExtensionToolMenu(catalog, selectChoice), [catalog, selectChoice]);
    const menu = useToolMenu({entries, query: slashQuery ?? "", onClose: () => setSlashQuery(null)});
    useEffect(() => {
        if (slashQuery === null) menu.reset();
    }, [slashQuery, menu.reset]);

    const submit = () => {
        const message = editor?.getText({blockSeparator: "\n"}).trim() ?? "";
        if (!message || disabled) return;
        try {
            if (selectedId && !selected) {
                throw new Error("所选能力已停用或归档，请重新选择。");
            }
            const invocation: ExtensionInvocation | undefined = selected?.kind === "skill"
                ? {target: {kind: "skill", id: selected.id, revision: selected.revision}, message}
                : selectedId ? workspace.buildInvocation(selectedId, message) : undefined;
            onSend({text: message, referencedMessageId: reference?.id, data: invocation ? {invocation} : undefined});
            setLastInvocation(invocation);
            setFormError("");
        } catch (reason) {
            setFormError(reason instanceof Error ? reason.message : "调用准备失败。");
            return;
        }
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
            {formError && <p className={styles.formError} role="alert">{formError}</p>}
            {skillPreview?.key === previewKey && skillPreview.error &&
                <p className={styles.formError} role="alert">{skillPreview.error}</p>}
            {slashQuery === null && selected && previewId === selected.id && previewContent && (
                <section className={styles.extensionPreview} aria-label={`${selected.name} 内容`}>
                    <header>
                        <div>
                            <span>{extensionKindLabels[selected.kind]}</span>
                            <strong>{selected.name}</strong>
                        </div>
                        <button type="button" onClick={() => setPreviewId(undefined)} aria-label="关闭扩展内容">×
                        </button>
                    </header>
                    <div className={styles.extensionPreviewBody}>{previewContent}</div>
                </section>
            )}
            {slashQuery !== null && (
                <div className={styles.slashMenu}>
                    <ToolMenu menu={menu} title={`调用扩展 · /${slashQuery}`}/>
                </div>
            )}
            {reference && (
                <div className={styles.selectedChip}>
                    <strong>Chat from here</strong>
                    <button type="button" className={styles.referenceLink} title={reference.text}
                            aria-label="定位引用的原消息"
                            onClick={() => onNavigateReference(reference.id)}>{reference.text}</button>
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
                {!text && !selected &&
                    <span className={styles.placeholder} aria-hidden="true">输入消息，或输入 / 调用扩展…</span>}
                <EditorContent editor={editor}/>
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
                <button type="button" className={styles.sendButton} disabled={disabled || !text.trim()}
                        onClick={submit}>
                    发送 ↑
                </button>
            </div>
            {lastInvocation && <details className={styles.invocationPreview}>
                <summary>最近一次调用的 UI 层 POJO</summary>
                <pre>{JSON.stringify(lastInvocation, null, 2)}</pre>
            </details>}
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
