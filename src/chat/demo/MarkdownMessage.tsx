import { useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DemoMessageAction } from "./demoMessage";

export interface MarkdownMessageProps {
  content: string;
  actions?: readonly DemoMessageAction[];
}

const components = {
  a: ({ children, href, node: _node, ...props }) => {
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
} satisfies Components;

export function MarkdownMessage({
  content,
  actions = [],
}: MarkdownMessageProps) {
  const [result, setResult] = useState<string>();
  const messageComponents = useMemo<Components>(
    () => ({
      ...components,
      a: (props) => {
        // Only actions explicitly supplied by this message can become buttons.
        const action = props.href?.startsWith("#action:")
          ? actions.find((item) => item.id === props.href?.slice("#action:".length))
          : undefined;

        if (action) {
          return (
            <button
              type="button"
              className="markdown-message-inline-action"
              onClick={() => setResult(action.result)}
            >
              {props.children}
            </button>
          );
        }

        const Link = components.a;
        return <Link {...props} />;
      },
    }),
    [actions],
  );

  return (
    <div className="markdown-message">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={messageComponents}>
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
