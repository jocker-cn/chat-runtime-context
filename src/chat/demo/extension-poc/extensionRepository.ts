import type { ExtensionCatalog } from "./extensionModel";

export interface ExtensionRepository {
  load(): ExtensionCatalog;
  save(catalog: ExtensionCatalog): void;
}

export function createDemoExtensionCatalog(): ExtensionCatalog {
  return {
    version: 1,
    items: [
      {
        id: "release-skill",
        kind: "skill",
        name: "发布风险检查",
        description: "按 P0/P1 分类整理发布风险。",
        enabled: true,
        instructions: "检查回滚记录、灰度阈值和通知负责人，并按优先级汇总。",
      },
      {
        id: "release-agent",
        kind: "agent",
        name: "发布助手",
        description: "负责发布前检查与风险摘要。",
        enabled: true,
        prompt: "你是发布助手。先确认事实，再给出简洁的风险判断。",
        skillIds: ["release-skill"],
        mcpIds: [],
        pluginIds: [],
      },
    ],
  };
}

export function createBrowserExtensionRepository(
  storageKey = "chat-runtime.extension-poc.v1",
): ExtensionRepository {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isExtensionCatalog(parsed)) return parsed;
        }
      } catch {
        // Storage may be unavailable in an embedded or private browser context.
      }
      return createDemoExtensionCatalog();
    },
    save(catalog) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(catalog));
      } catch {
        // Keep the in-memory controller usable even when persistence is blocked.
      }
    },
  };
}

function isExtensionCatalog(value: unknown): value is ExtensionCatalog {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "items" in value &&
    Array.isArray(value.items) &&
    value.items.every(isExtensionItem)
  );
}

function isExtensionItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.description !== "string" ||
    typeof item.enabled !== "boolean"
  ) return false;
  switch (item.kind) {
    case "agent":
      return (
        typeof item.prompt === "string" &&
        isStringArray(item.skillIds) &&
        isStringArray(item.mcpIds) &&
        isStringArray(item.pluginIds)
      );
    case "skill":
      return typeof item.instructions === "string";
    case "mcp":
      return typeof item.endpoint === "string";
    case "plugin":
      return typeof item.manifestUrl === "string";
    default:
      return false;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
