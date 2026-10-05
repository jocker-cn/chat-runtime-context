import { Node } from "@tiptap/core";
import type { ExtensionKind } from "./extensionModel";

const prefixes: Record<ExtensionKind, string> = {
  agent: "agents",
  skill: "skills",
  mcp: "mcp",
  plugin: "plugins",
};

export function formatExtensionReference(kind: ExtensionKind, name: string) {
  const characters = Array.from(name);
  const shortName = characters.length > 5
    ? `${characters.slice(0, 5).join("")}…`
    : name;
  return `${prefixes[kind]}:${shortName}`;
}

export const ExtensionReferenceNode = Node.create({
  name: "extensionReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-extension-id"),
        renderHTML: ({ id }) => ({ "data-extension-id": id }),
      },
      kind: {
        default: "skill",
        parseHTML: (element) => element.getAttribute("data-extension-kind"),
        renderHTML: ({ kind }) => ({ "data-extension-kind": kind }),
      },
      name: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-extension-name"),
        renderHTML: ({ name }) => ({ "data-extension-name": name }),
      },
      revision: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-extension-revision");
          return value ? Number(value) : null;
        },
        renderHTML: ({ revision }) => revision ? { "data-extension-revision": revision } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-extension-token]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { kind, name } = node.attrs as {
      kind: ExtensionKind;
      name: string;
    };
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-extension-token": "",
        contenteditable: "false",
        role: "button",
        tabindex: "0",
        "aria-label": `查看${kind}：${name}`,
        title: name,
      },
      formatExtensionReference(kind, name),
    ];
  },
  // The reference is structured metadata, not part of the user's free text.
  renderText: () => "",
});
