/** Serializable menu metadata. Business callbacks never belong in stored data. */
export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly group?: string;
  readonly keywords?: readonly string[];
}

export interface ToolExecutionContext<TCapabilities> {
  readonly source: string;
  readonly capabilities: TCapabilities;
}

export interface ToolRegistration<TCapabilities> {
  definition: ToolDefinition;
  onSelect(context: ToolExecutionContext<TCapabilities>): void | Promise<void>;
  onReferenceClick?(context: ToolExecutionContext<TCapabilities>): void | Promise<void>;
}

export interface ToolRegistry<TCapabilities> {
  register(tool: ToolRegistration<TCapabilities>): () => void;
  getSnapshot(): readonly ToolDefinition[];
  subscribe(listener: () => void): () => void;
  invoke(
    id: string,
    context: ToolExecutionContext<TCapabilities>,
    interaction?: "select" | "reference",
  ): Promise<void>;
}

/** Framework-neutral and instance-scoped; no Composer, Runtime or dialog dependency. */
export function createToolRegistry<TCapabilities>(): ToolRegistry<TCapabilities> {
  const tools = new Map<string, ToolRegistration<TCapabilities>>();
  const listeners = new Set<() => void>();
  let snapshot: readonly ToolDefinition[] = Object.freeze([]);
  const publish = () => {
    snapshot = Object.freeze([...tools.values()].map((tool) => tool.definition));
    listeners.forEach((listener) => listener());
  };

  return {
    register(tool) {
      const { id, name } = tool.definition;
      if (!id.trim() || !name.trim()) throw new Error("Tool id and name are required.");
      if (tools.has(id)) throw new Error(`Tool "${id}" is already registered.`);
      const entry = {
        ...tool,
        definition: Object.freeze({
          ...tool.definition,
          keywords: tool.definition.keywords
            ? Object.freeze([...tool.definition.keywords])
            : undefined,
        }),
      };
      tools.set(id, entry);
      publish();
      return () => {
        // Old cleanup must not remove a later registration using the same ID.
        if (tools.get(id) !== entry) return;
        tools.delete(id);
        publish();
      };
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async invoke(id, context, interaction = "select") {
      const tool = tools.get(id);
      if (!tool) throw new Error(`Tool "${id}" is not registered.`);
      if (interaction === "reference") await tool.onReferenceClick?.(context);
      else await tool.onSelect(context);
    },
  };
}

export function searchTools(tools: readonly ToolDefinition[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return tools;
  return tools.filter((tool) =>
    [tool.name, tool.description, tool.group, ...(tool.keywords ?? [])]
      .join(" ").toLocaleLowerCase().includes(normalized),
  );
}
