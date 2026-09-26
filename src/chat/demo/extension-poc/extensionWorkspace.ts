import {
  type AgentExtension,
  type ExtensionCatalog,
  type ExtensionChoice,
  type ExtensionInvocation,
  type ExtensionItem,
  type ExtensionKind,
} from "./extensionModel";
import type { ExtensionRepository } from "./extensionRepository";

export class ExtensionWorkspace {
  private catalog: ExtensionCatalog;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly repository: ExtensionRepository) {
    this.catalog = repository.load();
  }

  getSnapshot = (): ExtensionCatalog => this.catalog;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  save(draft: ExtensionItem): ExtensionItem {
    const name = draft.name.trim();
    if (!name) throw new Error("名称不能为空。");
    const item = {
      ...draft,
      id: draft.id || createId(),
      name,
      description: draft.description.trim(),
    } as ExtensionItem;
    if (item.kind === "agent") {
      this.assertAgentReferences(item);
    }
    const existing = this.catalog.items.findIndex((entry) => entry.id === item.id);
    if (existing >= 0 && this.catalog.items[existing]?.kind !== item.kind) {
      throw new Error("已有同 ID、不同类型的扩展。");
    }
    const items = [...this.catalog.items];
    if (existing >= 0) items[existing] = item;
    else items.push(item);
    this.commit({ version: 1, items });
    return item;
  }

  remove(id: string): void {
    const items = this.catalog.items
      .filter((item) => item.id !== id)
      .map((item) =>
        item.kind === "agent"
          ? {
              ...item,
              skillIds: item.skillIds.filter((ref) => ref !== id),
              mcpIds: item.mcpIds.filter((ref) => ref !== id),
              pluginIds: item.pluginIds.filter((ref) => ref !== id),
            }
          : item,
      );
    this.commit({ version: 1, items });
  }

  choices(query = ""): ExtensionChoice[] {
    const normalized = query.trim().toLocaleLowerCase();
    return this.catalog.items
      .filter(
        (item) =>
          item.enabled &&
          (!normalized ||
            `${item.name} ${item.description} ${item.kind}`
              .toLocaleLowerCase()
              .includes(normalized)),
      )
      .map(({ id, kind, name, description }) => ({
        id,
        kind,
        name,
        description,
      }));
  }

  buildInvocation(id: string, message: string): ExtensionInvocation {
    const item = this.catalog.items.find((entry) => entry.id === id);
    if (!item || !item.enabled) throw new Error("扩展不存在或已停用。");
    const invocation: ExtensionInvocation = {
      target: { kind: item.kind, id: item.id },
      message,
    };
    if (item.kind === "agent") {
      invocation.agent = this.resolveAgent(item);
    }
    return invocation;
  }

  private resolveAgent(agent: AgentExtension) {
    const available = (kind: ExtensionKind) =>
      new Set(
        this.catalog.items
          .filter((item) => item.enabled && item.kind === kind)
          .map((item) => item.id),
      );
    const skills = available("skill");
    const mcps = available("mcp");
    const plugins = available("plugin");
    return {
      prompt: agent.prompt,
      skillIds: agent.skillIds.filter((id) => skills.has(id)),
      mcpIds: agent.mcpIds.filter((id) => mcps.has(id)),
      pluginIds: agent.pluginIds.filter((id) => plugins.has(id)),
    };
  }

  private assertAgentReferences(agent: AgentExtension) {
    const expected: Array<[ExtensionKind, readonly string[]]> = [
      ["skill", agent.skillIds],
      ["mcp", agent.mcpIds],
      ["plugin", agent.pluginIds],
    ];
    for (const [kind, ids] of expected) {
      for (const id of ids) {
        if (!this.catalog.items.some((item) => item.id === id && item.kind === kind)) {
          throw new Error(`找不到 ${kind} 引用：${id}`);
        }
      }
    }
  }

  private commit(catalog: ExtensionCatalog) {
    this.catalog = catalog;
    this.repository.save(catalog);
    this.listeners.forEach((listener) => listener());
  }
}

export function getAgentReferenceField(kind: ExtensionKind) {
  if (kind === "skill") return "skillIds";
  if (kind === "mcp") return "mcpIds";
  if (kind === "plugin") return "pluginIds";
  return undefined;
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `extension-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
