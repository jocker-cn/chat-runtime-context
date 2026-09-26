export type ExtensionKind = "agent" | "skill" | "mcp" | "plugin";

interface ExtensionBase {
  id: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  enabled: boolean;
}

export interface AgentExtension extends ExtensionBase {
  kind: "agent";
  prompt: string;
  skillIds: string[];
  mcpIds: string[];
  pluginIds: string[];
}

export interface SkillExtension extends ExtensionBase {
  kind: "skill";
  instructions: string;
}

export interface McpExtension extends ExtensionBase {
  kind: "mcp";
  endpoint: string;
}

export interface PluginExtension extends ExtensionBase {
  kind: "plugin";
  manifestUrl: string;
}

export type ExtensionItem =
  | AgentExtension
  | SkillExtension
  | McpExtension
  | PluginExtension;

export interface ExtensionCatalog {
  version: 1;
  items: ExtensionItem[];
}

export interface ExtensionChoice {
  id: string;
  kind: ExtensionKind;
  name: string;
  description: string;
}

/** UI-to-runtime envelope. A backend adapter may consume this later. */
export interface ExtensionInvocation {
  target: { kind: ExtensionKind; id: string };
  message: string;
  agent?: {
    prompt: string;
    skillIds: string[];
    mcpIds: string[];
    pluginIds: string[];
  };
}

export const extensionKindLabels: Record<ExtensionKind, string> = {
  agent: "Agent",
  skill: "Skill",
  mcp: "MCP",
  plugin: "Plugin",
};

export function createExtensionDraft(kind: ExtensionKind): ExtensionItem {
  const base = { id: "", name: "", description: "", enabled: true };
  switch (kind) {
    case "agent":
      return {
        ...base,
        kind,
        prompt: "",
        skillIds: [],
        mcpIds: [],
        pluginIds: [],
      };
    case "skill":
      return { ...base, kind, instructions: "" };
    case "mcp":
      return { ...base, kind, endpoint: "" };
    case "plugin":
      return { ...base, kind, manifestUrl: "" };
  }
}
