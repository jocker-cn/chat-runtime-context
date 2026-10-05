import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ToolDefinition } from "./toolRegistry";
import styles from "./ToolList.module.css";

export interface ToolListProps {
  tools: readonly ToolDefinition[];
  onSelect(tool: ToolDefinition): void;
  label?: string;
  empty?: ReactNode;
  className?: string;
  renderTool?(tool: ToolDefinition): ReactNode;
  activeIndex?: number;
  onActiveIndexChange?(index: number): void;
  preserveFocusOnMouseDown?: boolean;
}

/** Presentation only. Use inline or inside any popup; it does not own a registry. */
export function ToolList({ tools, onSelect, label = "选择工具", empty = "没有可用工具。", className, renderTool,
  activeIndex: controlledActive, onActiveIndexChange, preserveFocusOnMouseDown = false,
}: ToolListProps) {
  const [active, setActive] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, Math.min(controlledActive ?? active, Math.max(tools.length - 1, 0)));
  const activeId = tools[activeIndex]?.id;
  const changeActive = (index: number) => {
    setActive(index);
    onActiveIndexChange?.(index);
  };
  useEffect(() => {
    buttons.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, activeId]);
  return (
    <div className={[styles.list, className].filter(Boolean).join(" ")}
      role="listbox" aria-label={label} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !tools.length) return;
        let next: number;
        switch (event.key) {
          case "ArrowDown": next = (activeIndex + 1) % tools.length; break;
          case "ArrowUp": next = (activeIndex - 1 + tools.length) % tools.length; break;
          case "Home": next = 0; break;
          case "End": next = tools.length - 1; break;
          case "Enter":
          case " ":
            event.preventDefault(); event.stopPropagation();
            onSelect(tools[activeIndex]);
            return;
          default: return;
        }
        event.preventDefault(); event.stopPropagation();
        changeActive(next);
        buttons.current[next]?.focus();
      }}>
      {!tools.length && <div className={styles.empty}>{empty}</div>}
      {tools.map((tool, index) => (
        <button key={tool.id} type="button" role="option"
          ref={(element) => { buttons.current[index] = element; }}
          aria-selected={index === activeIndex} tabIndex={index === activeIndex ? 0 : -1}
          className={styles.option} onFocus={() => changeActive(index)}
          onMouseEnter={() => changeActive(index)}
          onMouseDown={(event) => { if (preserveFocusOnMouseDown) event.preventDefault(); }}
          onClick={() => onSelect(tool)}>
          {renderTool ? renderTool(tool) : <>
            {tool.group && <span className={styles.group}>{tool.group}</span>}
            <span className={styles.text}>
              <strong>{tool.name}</strong>
              {tool.description && <small>{tool.description}</small>}
            </span>
          </>}
        </button>
      ))}
    </div>
  );
}
