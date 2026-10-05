import { useLayoutEffect, useRef } from "react";
import { ToolList } from "./ToolList";
import type { ToolMenuController } from "./useToolMenu";
import styles from "./ToolMenu.module.css";

export interface ToolMenuProps {
  menu: ToolMenuController;
  className?: string;
  title?: string;
}

/** The host owns the popup/placement. Groups own their detail row content. */
export function ToolMenu({ menu, className, title = "调用工具" }: ToolMenuProps) {
  const { group } = menu;
  const root = useRef<HTMLDivElement>(null);
  const restoreListFocus = useRef(false);
  const back = () => {
    restoreListFocus.current = Boolean(root.current?.contains(document.activeElement));
    menu.back();
  };
  useLayoutEffect(() => {
    if (!group && restoreListFocus.current) {
      root.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
      restoreListFocus.current = false;
    }
  }, [group]);
  return (
    <div ref={root} className={[styles.menu, className].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        // ArrowLeft in the search field must keep its normal caret behavior.
        if (event.key === "ArrowLeft" && event.target instanceof HTMLInputElement) return;
        if (group && (event.key === "Escape" || event.key === "ArrowLeft")) {
          event.preventDefault(); event.stopPropagation(); back(); return;
        }
        if (menu.handleKey(event.key)) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <header className={styles.header}>
        {group && <button type="button" onClick={back} aria-label="返回工具分类">←</button>}
        <div>
          <strong>{group?.definition.name ?? title}</strong>
          {group?.definition.description && <small>{group.definition.description}</small>}
        </div>
      </header>
      {group && <input className={styles.search} aria-label={`搜索 ${group.definition.name} 条目`}
        placeholder={`搜索 ${group.definition.name}…`} value={menu.query}
        onChange={(event) => menu.setQuery(event.target.value)} />}
      <div className={styles.rows}>
        <ToolList tools={menu.items} activeIndex={menu.activeIndex}
          preserveFocusOnMouseDown
          onActiveIndexChange={menu.setActiveIndex}
          label={group ? `${group.definition.name} 条目` : "选择工具分类"}
          empty={group && !menu.query ? group.empty ?? "暂无可用条目。" : "没有匹配的工具。"}
          onSelect={(item) => menu.select(item.id)}
          renderTool={group ? group.renderItem : (item) => {
            const entry = menu.rootEntries.find((entry) => entry.definition.id === item.id);
            return <>
              <div className={styles.summary}>
                <strong>{item.name}</strong>{item.description && <small>{item.description}</small>}
              </div>
              {entry?.type === "group" && <span className={styles.indicator} aria-hidden="true">{entry.items.length} 项 ›</span>}
            </>;
          }} />
      </div>
    </div>
  );
}
