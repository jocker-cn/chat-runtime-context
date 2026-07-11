import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DemoMessageAction } from "./demoMessage";

export interface MarkdownMessageProps {
  content: string;
  actions?: readonly DemoMessageAction[];
}

const components: Components = {
  a: ({ children, href, ...props }) => {
    const external = href?.startsWith("http://") || href?.startsWith("https://");

    return (
      <a
        {...props}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer noopener" : undefined}
      >
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="markdown-table-scroll">
      <table>{children}</table>
    </div>
  ),
};

export function MarkdownMessage({
  content,
  actions = [],
}: MarkdownMessageProps) {
  const [result, setResult] = useState<string>();

  return (
    <div className="markdown-message">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
      {actions.length > 0 && (
        <div className="markdown-message-actions" aria-label="Message actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => setResult(action.result)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {result && (
        <output className="markdown-message-result" role="status">
          {result}
        </output>
      )}
    </div>
  );
}
