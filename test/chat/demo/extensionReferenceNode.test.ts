// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  ExtensionReferenceNode,
  formatExtensionReference,
} from "../../../src/chat/demo/extension-poc/extensionReferenceNode";

describe("ExtensionReferenceNode", () => {
  it("shows at most five name characters but keeps the full identity as metadata", () => {
    expect(formatExtensionReference("skill", "发布风险检查"))
      .toBe("skills:发布风险检…");
    expect(formatExtensionReference("skill", "短名"))
      .toBe("skills:短名");
  });

  it("does not mix the reference label into the user's message text", () => {
    const editor = new Editor({
      extensions: [StarterKit, ExtensionReferenceNode],
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            {
              type: "extensionReference",
              attrs: { id: "release-skill", kind: "skill", name: "发布风险检查" },
            },
            { type: "text", text: " 请帮我检查" },
          ],
        }],
      },
    });

    expect(editor.getText()).toBe(" 请帮我检查");
    expect(editor.getHTML()).toContain("skills:发布风险检…");
    expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
      type: "extensionReference",
      attrs: { id: "release-skill" },
    });
    editor.destroy();
  });
});
