import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseJson, type ResponseTraceRecord } from "./responseTrace";
import styles from "./ResponseTraceDialog.module.css";

export interface ResponseTraceDialogProps {
  open: boolean;
  trace?: ResponseTraceRecord;
  onClose(): void;
}

/** Event names, contents and intervals are supplied by the integration. */
export function ResponseTraceDialog({ open, trace, onClose }: ResponseTraceDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const previousEntry = useRef<string | undefined>(undefined);
  const overviewScroll = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [selectedId, setSelectedId] = useState<string>();
  const selected = trace?.entries.find((item) => item.id === selectedId);

  useEffect(() => {
    if (!open) return;
    setSelectedId(undefined);
    previousEntry.current = undefined;
    overviewScroll.current = 0;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const targets = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), summary, [tabindex="0"]') ?? [])
          .filter((element) => !element.closest("details:not([open])") || element.tagName === "SUMMARY");
        const first = targets[0];
        const last = targets.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current || document.activeElement === detailRef.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current || document.activeElement === detailRef.current)) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    const handleFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) panelRef.current?.focus();
    };
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("focusin", handleFocus);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("focusin", handleFocus);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (selected) detailRef.current?.focus();
    else {
      if (overviewRef.current) overviewRef.current.scrollTop = overviewScroll.current;
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [])
        .find((button) => button.dataset.entryId === previousEntry.current)?.focus({ preventScroll: true });
    }
  }, [open, selected]);

  const selectEntry = (id: string) => {
    previousEntry.current = id;
    overviewScroll.current = overviewRef.current?.scrollTop ?? 0;
    setSelectedId(id);
  };

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.dialog} ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className={styles.header}>
          <h2 id={titleId}>AI 响应过程</h2>
          <button type="button" onClick={onClose} aria-label="关闭响应过程">×</button>
        </header>
        {selected ? <section ref={detailRef} className={styles.details} aria-label="事件详情" tabIndex={-1}>
          <button type="button" onClick={() => setSelectedId(undefined)}>← 返回列表</button>
          <h3>{selected.event}</h3>
          <Data value={selected.content} />
          {selected.details !== undefined && <details className={styles.rawDetails}>
            <summary>完整数据</summary><Data value={selected.details} />
          </details>}
        </section> : <div className={styles.overview} ref={overviewRef}>
          <section className={styles.chart} aria-label="事件耗时图">
            <div className={styles.chartTitle}>总耗时 <strong>{trace ? `${trace.summary.durationMs} ms` : "—"}</strong></div>
            <div className={styles.axis}><span>0 ms</span><span>{trace?.summary.durationMs ?? 0} ms</span></div>
            {trace?.entries.map((entry, index) => {
              const total = Math.max(1, trace.summary.durationMs);
              const start = Math.min(100, Math.max(0, (entry.startedAt - trace.startedAt) / total * 100));
              const duration = entry.endedAt === undefined ? undefined : Math.max(0, entry.endedAt - entry.startedAt);
              const width = Math.min(100 - start, (duration ?? 0) / total * 100);
              return <div className={styles.chartRow} key={entry.id}>
                <span className={styles.eventName} title={entry.event}>{entry.event}</span>
                <div className={styles.track}>
                  <button type="button" className={`${styles.bar} ${styles[`color${index % 4}`]}`}
                    style={{ left: `${start}%`, width: `${width}%` }}
                    aria-label={`${entry.event} · ${duration === undefined ? "耗时未上报" : `${duration} ms`}`}
                    onClick={() => selectEntry(entry.id)} />
                </div>
                <span className={styles.duration}>{duration === undefined ? "—" : `${duration} ms`}</span>
              </div>;
            })}
          </section>
          <table className={styles.events}>
            <thead><tr><th scope="col">event</th><th scope="col">content</th></tr></thead>
            <tbody>{trace?.entries.map((entry) => <tr key={entry.id}>
              <td><span className={styles.eventName}>{entry.event}</span></td>
              <td><button type="button" className={styles.content} data-entry-id={entry.id}
                aria-label={`查看 ${entry.event} 内容`} onClick={() => selectEntry(entry.id)}>
                {preview(entry.content)}
              </button></td>
            </tr>)}</tbody>
          </table>
          {!trace?.entries.length && <p className={styles.empty}>暂无事件记录</p>}
        </div>}
      </div>
    </div>, document.body,
  );
}

function Data({ value }: { value: unknown }) {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  const formatted = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
  return <pre className={styles.data}>{formatted ?? String(parsed)}</pre>;
}

function preview(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text || "—";
}
