import { useCallback, useEffect, useMemo, useState } from "react";
import { searchTools, type ToolDefinition } from "./toolRegistry";
import type { ToolMenuEntry } from "./toolMenuContracts";

export interface ToolMenuOptions {
  entries: readonly ToolMenuEntry[];
  query?: string;
  onClose(): void;
}

/** Independent menu navigation; an editor/shortcut can delegate keys to this controller. */
export function useToolMenu({ entries, query = "", onClose }: ToolMenuOptions) {
  const [groupId, setGroupId] = useState<string>();
  const [childQuery, setChildQuery] = useState<string>();
  const [active, setActive] = useState(0);
  const candidate = entries.find((entry) => entry.definition.id === groupId);
  const group = candidate?.type === "group" ? candidate : undefined;
  // /MCP finds the category; /server-name finds its category through child metadata.
  const rootEntries = useMemo(() => entries.filter((entry) =>
    searchTools([entry.definition], query).length > 0 ||
    (entry.type === "group" && searchTools(entry.items, query).length > 0),
  ), [entries, query]);
  const detailQuery = childQuery ?? (
    group && searchTools([group.definition], query).length ? "" : query
  );
  const items: readonly ToolDefinition[] = useMemo(() => group
    ? searchTools(group.items, detailQuery)
    : rootEntries.map((entry) => entry.definition), [group, detailQuery, rootEntries]);
  const activeIndex = Math.max(0, Math.min(active, Math.max(items.length - 1, 0)));
  const reset = useCallback(() => {
    setGroupId(undefined); setChildQuery(undefined); setActive(0);
  }, []);
  useEffect(() => { setActive(0); }, [query, groupId, childQuery]);
  useEffect(() => { if (groupId && !group) reset(); }, [groupId, group, reset]);
  const back = reset;
  const close = () => { reset(); onClose(); };
  const select = (id: string) => {
    if (group) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;
      close();
      group.onSelect(item);
      return;
    }
    const entry = rootEntries.find((entry) => entry.definition.id === id);
    if (!entry) return;
    if (entry.type === "group") {
      setGroupId(entry.definition.id); setChildQuery(undefined); setActive(0);
    } else {
      close(); entry.onSelect();
    }
  };
  const handleKey = (key: string): boolean => {
    if (key === "Escape") { if (group) back(); else close(); return true; }
    if (key === "ArrowLeft" && group) { back(); return true; }
    if (key === "ArrowRight" && !group) {
      const entry = rootEntries[activeIndex];
      if (entry?.type !== "group") return false;
      select(entry.definition.id); return true;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      const count = Math.max(items.length, 1);
      setActive((activeIndex + (key === "ArrowDown" ? 1 : -1) + count) % count);
      return true;
    }
    if (key === "Enter") { if (items[activeIndex]) select(items[activeIndex].id); return true; }
    return false;
  };

  return {
    group, items, rootEntries, activeIndex, query: detailQuery,
    setActiveIndex: setActive,
    setQuery(value: string) { setChildQuery(value); setActive(0); },
    select, back, close, reset, handleKey,
  };
}

export type ToolMenuController = ReturnType<typeof useToolMenu>;
