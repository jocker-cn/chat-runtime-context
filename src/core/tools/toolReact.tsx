import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect,
  useMemo, useRef, useSyncExternalStore, type ReactNode,
} from "react";
import {
  searchTools, type ToolExecutionContext, type ToolRegistration, type ToolRegistry,
} from "./toolRegistry";

/** Create once at module scope to keep application capabilities fully typed. */
export function createToolReactBindings<TCapabilities>() {
  const Context = createContext<ToolRegistry<TCapabilities> | null>(null);

  function Provider({ registry, children }: {
    registry: ToolRegistry<TCapabilities>;
    children: ReactNode;
  }) {
    return <Context.Provider value={registry}>{children}</Context.Provider>;
  }

  function useToolRegistry() {
    const registry = useContext(Context);
    if (!registry) throw new Error("Tool hooks require a Tool Provider.");
    return registry;
  }

  function useRegisterTool(tool: ToolRegistration<TCapabilities>) {
    const registry = useToolRegistry();
    const latest = useRef(tool);
    useLayoutEffect(() => { latest.current = tool; });
    const { id, name, description, group, keywords } = tool.definition;
    const keywordsKey = JSON.stringify(keywords ?? []);
    // Inline objects/callbacks are supported: only metadata changes re-register.
    useEffect(() => registry.register({
      definition: { id, name, description, group, keywords: JSON.parse(keywordsKey) as string[] },
      onSelect: (context) => latest.current.onSelect(context),
      onReferenceClick: (context) => latest.current.onReferenceClick?.(context),
    }), [registry, id, name, description, group, keywordsKey]);
  }

  function useTools(query = "") {
    const registry = useToolRegistry();
    const snapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
    return useMemo(() => searchTools(snapshot, query), [snapshot, query]);
  }

  function useToolLauncher(context: ToolExecutionContext<TCapabilities>) {
    const registry = useToolRegistry();
    return useCallback((id: string, interaction: "select" | "reference" = "select") =>
      registry.invoke(id, context, interaction), [registry, context]);
  }

  return { Provider, useToolRegistry, useRegisterTool, useTools, useToolLauncher };
}
