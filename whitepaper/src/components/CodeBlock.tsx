import { useState } from "react";

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    }
  };

  return (
    <div className="code-block">
      <button type="button" className="code-copy" onClick={() => void copy()}>
        {copied ? "已复制" : "复制"}
      </button>
      <pre><code>{code}</code></pre>
    </div>
  );
}
