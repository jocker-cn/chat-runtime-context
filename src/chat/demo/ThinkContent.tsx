import { useId, type ReactNode } from "react";

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
  const titleId = useId();
  const contentId = useId();
  const hasContent =
    children !== null && children !== undefined && children !== "";

  return (
    <section
      className="message-card message-card-thinking"
      data-thinking-phase={phase}
      role="article"
      tabIndex={0}
      aria-labelledby={titleId}
      aria-describedby={hasContent ? contentId : undefined}
      aria-busy={phase !== "completed"}
    >
      <header
        id={titleId}
        className="thinking-card-title"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="thinking-card-indicator" aria-hidden="true" />
        {title}
      </header>
      {hasContent ? (
        <div id={contentId} className="thinking-card-content">
          {children}
        </div>
      ) : null}
    </section>
  );
}
