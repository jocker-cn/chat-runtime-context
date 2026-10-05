import type { ReactNode } from "react";
import styles from "./DefinitionManager.module.css";

/** Shared presentation only: each feature owns its data, editing and actions. */
export function DefinitionManager({ label, directory, children }: {
  label: string; directory: ReactNode; children: ReactNode;
}) {
  return <div className={styles.manager} aria-label={label}>{directory}{children}</div>;
}

export function DefinitionDirectory({ title, count, tools, search, footer, children }: {
  title: string; count: number; tools: ReactNode; search: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  return <aside className={styles.directory} aria-label={`${title} 目录`}>
    <header><h2>{title}</h2><span className={styles.count}>{count}</span></header>
    <div className={styles.directoryTools}>{tools}</div>
    <div className={styles.search}>{search}</div>
    <div className={styles.entries}>{children}</div>
    {footer && <footer className={styles.directoryFooter}>{footer}</footer>}
  </aside>;
}

export function DefinitionEditor({ label, title, status, actions, busy, children }: {
  label: string; title: string; status: ReactNode; actions: ReactNode; busy?: boolean; children: ReactNode;
}) {
  return <section className={styles.editor} aria-label={label} aria-busy={busy}>
    <header className={styles.toolbar}>
      <div className={styles.title}><h2 title={title}>{title}</h2><div className={styles.status}>{status}</div></div>
      <div className={styles.actions}>{actions}</div>
    </header>
    <div className={styles.editorBody}>{children}</div>
  </section>;
}
