import type { ToolDefinition, ToolMenuEntry } from "../../../core/tools";
import {
  extensionKindLabels, type AgentExtension, type ExtensionCatalog, type ExtensionChoice,
  type ExtensionItem, type McpExtension, type PluginExtension, type SkillExtension,
} from "./extensionModel";
import styles from "./extensionToolMenu.module.css";

const categories = [
  { kind: "agent", description: "选择自定义 Agent 及其关联能力。" },
  { kind: "skill", description: "选择已定义的 Skill 工作流。" },
  { kind: "mcp", description: "选择已配置的 MCP 服务。" },
  { kind: "plugin", description: "选择已定义的 Plugin 扩展。" },
] as const;

/** Feature-owned projection. Core does not know these types or their raw fields. */
export function createExtensionToolMenu(
  catalog: ExtensionCatalog,
  onSelect: (choice: ExtensionChoice) => void,
): ToolMenuEntry[] {
  return categories.map(({ kind, description }) => {
    const available = catalog.items.filter((item) => item.enabled && item.kind === kind);
    const byId = new Map(available.map((item) => [item.id, item]));
    return {
      type: "group",
      definition: {
        id: `extensions:${kind}`,
        name: extensionKindLabels[kind],
        description,
        keywords: [kind],
      },
      items: available.map(toMenuItem),
      empty: `暂无可用的 ${extensionKindLabels[kind]}，可从左侧对应页面新建或启用。`,
      renderItem: (definition: ToolDefinition) => {
        const item = byId.get(definition.id);
        return item ? <ExtensionDetail item={item} /> : null;
      },
      onSelect: (definition: ToolDefinition) => {
        const item = byId.get(definition.id);
        if (item) onSelect({ id: item.id, kind: item.kind, name: item.name, description: item.description,
          revision: item.kind === "skill" ? item.revision : undefined });
      },
    };
  });
}

function toMenuItem(item: ExtensionItem): ToolDefinition {
  const detail = item.kind === "mcp" ? item.endpoint : item.kind === "skill" ? item.instructions
    : item.kind === "agent" ? item.prompt : item.manifestUrl;
  return { id: item.id, name: item.name, description: item.description, keywords: [item.kind, detail] };
}

function ExtensionDetail({ item }: { item: ExtensionItem }) {
  switch (item.kind) {
    case "mcp": return <McpDetail item={item} />;
    case "skill": return <SkillDetail item={item} />;
    case "agent": return <AgentDetail item={item} />;
    case "plugin": return <PluginDetail item={item} />;
  }
}

function Heading({ item }: { item: ExtensionItem }) {
  return <><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</>;
}

function McpDetail({ item }: { item: McpExtension }) {
  return <div className={styles.detail}>
    <Heading item={item} />
    <span className={styles.endpoint} title={item.endpoint}>Endpoint：{item.endpoint || "未配置"}</span>
  </div>;
}

function SkillDetail({ item }: { item: SkillExtension }) {
  return <div className={styles.detail}>
    <Heading item={item} />
    <span className={styles.excerpt}>{item.revision ? `已发布 v${item.revision} · 按需加载文件包` : `指令：${item.instructions || "未填写指令"}`}</span>
  </div>;
}

function AgentDetail({ item }: { item: AgentExtension }) {
  return <div className={styles.detail}>
    <Heading item={item} />
    <span className={styles.excerpt}>Prompt：{item.prompt || "未填写 Prompt"}</span>
    <span className={styles.badges}>
      <span>{item.skillIds.length} Skills</span><span>{item.mcpIds.length} MCP</span><span>{item.pluginIds.length} Plugins</span>
    </span>
  </div>;
}

function PluginDetail({ item }: { item: PluginExtension }) {
  return <div className={styles.detail}>
    <Heading item={item} />
    <span className={styles.endpoint} title={item.manifestUrl}>Manifest：{item.manifestUrl || "未配置"}</span>
  </div>;
}
