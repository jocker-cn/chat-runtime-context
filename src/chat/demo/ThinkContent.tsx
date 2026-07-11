import type { ReactNode } from "react";

export interface ThinkContentProps {
  title: string;
  children?: ReactNode;
  phase: string;
}

export function ThinkContent({
  title,
  children,
  phase,
}: ThinkContentProps) {
  return (
    <section
      className="message-card message-card-thinking"
      data-thinking-phase={phase}
      aria-live="polite"
    >
      <header className="thinking-card-title">
        <span className="thinking-card-indicator" aria-hidden="true" />
        {title}
      </header>
      {children ? (
        <div className="thinking-card-content">{children}</div>
      ) : null}
    </section>
  );
}
