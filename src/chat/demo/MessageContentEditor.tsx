import { Node } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "./MarkdownMessage";
import styles from "./MessageContentEditor.module.css";

// A single plain-text block preserves Markdown without an HTML conversion.
const SourceDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "codeBlock",
});

export function MessageContentEditor({ content, onSave, onCancel }: {
  content: string;
  onSave(content: string): void;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState(content);
  const [preview, setPreview] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const editor = useEditor({
    extensions: [
      SourceDocument,
      StarterKit.configure({
        document: false,
        codeBlock: { exitOnTripleEnter: false, exitOnArrowDown: false },
        trailingNode: false,
      }),
    ],
    content: {
      type: "doc",
      content: [{
        type: "codeBlock",
        content: content ? [{ type: "text", text: content }] : [],
      }],
    },
    immediatelyRender: false,
    enableInputRules: false,
    enablePasteRules: false,
    editorProps: {
      attributes: {
        class: styles.source,
        role: "textbox",
        "aria-label": "消息 Markdown 源码",
        "aria-multiline": "true",
        spellcheck: "false",
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        view.dispatch(view.state.tr.insertText(text.replace(/\r\n?/g, "\n")));
        return true;
      },
    },
    onUpdate: ({ editor: current }) => setDraft(current.state.doc.textContent),
  });

  useEffect(() => {
    if (editor && !preview) {
      rootRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      editor.commands.focus(undefined, { scrollIntoView: false });
    }
  }, [editor, preview]);

  return (
    <section ref={rootRef} className={styles.editor} aria-label="编辑消息">
      <div className={styles.tabs} role="group" aria-label="消息编辑视图">
        <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>
          编辑源码
        </button>
        <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
          预览
        </button>
      </div>
      <div hidden={preview}>
        <EditorContent editor={editor} />
      </div>
      <div hidden={!preview} className={styles.preview} role="region" aria-label="消息预览">
        <MarkdownMessage content={draft} />
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" className={styles.save} disabled={!editor}
          onClick={() => editor && onSave(editor.state.doc.textContent)}>
          保存
        </button>
      </div>
    </section>
  );
}
