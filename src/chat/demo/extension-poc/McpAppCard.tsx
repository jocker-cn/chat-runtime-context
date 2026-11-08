import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { McpUiToolResultNotificationSchema } from "@modelcontextprotocol/ext-apps";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useToolPresentation, type FrameCardProps, type FrameRenderer } from "../../../core";
import { demoRenderer } from "../demoRenderer";
import type { DemoMessage } from "../demoMessage";
import {
  MCP_APP_ACTIVITY_TYPE,
  readMcpAppPayload,
  type McpAppPayload,
} from "../mcpAppActivity";
import styles from "./ExtensionPocPage.module.css";

const recordPickerUri = "ui://record-picker/index.html";
const analyticsDashboardUri = "ui://analytics-dashboard/index.html";

const selectionParams = z.object({
  appId: z.literal("record-picker"),
  selectedRecords: z.array(z.object({
    id: z.string(),
    customer: z.string(),
    status: z.enum(["pending", "processing", "completed"]),
    amount: z.number(),
  })),
});

export const extensionPocRenderer: FrameRenderer<DemoMessage> = {
  getCard(message, context) {
    return message.role === "activity" && message.activityType === MCP_APP_ACTIVITY_TYPE
      ? McpAppCard
      : demoRenderer.getCard(message, context);
  },
};

function McpAppCard({ message }: FrameCardProps<DemoMessage>) {
  const { openDialog } = useToolPresentation();
  const [selectedCount, setSelectedCount] = useState<number>();
  const payload = useMemo(() => readMcpAppPayload(message.content), [message.content]);
  if (!payload || (payload.resourceUri !== recordPickerUri && payload.resourceUri !== analyticsDashboardUri)) return null;

  if (payload.resourceUri === analyticsDashboardUri) {
    return (
      <article className="message-card" aria-label="经营分析看板消息">
        <button
          type="button"
          className={styles.mcpOpenButton}
          onClick={() => openDialog({
            title: "经营分析看板",
            size: "large",
            render: () => <McpAppFrame payload={payload} title="经营分析看板" />,
          })}
        >
          查看经营看板
        </button>
      </article>
    );
  }

  return (
    <article className={`message-card ${styles.mcpCard}`} aria-label="订单记录选择器消息">
      <McpAppFrame payload={payload} title="订单记录选择器" onSelectionCount={setSelectedCount} />
      {selectedCount !== undefined && (
        <p className={styles.mcpSelection} role="status">宿主收到 {selectedCount} 条选中记录</p>
      )}
    </article>
  );
}

function McpAppFrame({ payload, title, onSelectionCount }: {
  payload: McpAppPayload;
  title: string;
  onSelectionCount?: (count: number) => void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const frame = iframe.current;
    const frameWindow = frame?.contentWindow;
    if (!frame || !frameWindow) return;

    const result = McpUiToolResultNotificationSchema.shape.params.safeParse(payload.result);
    if (!result.success) {
      setState("error");
      return;
    }

    const controller = new AbortController();
    const bridge = new AppBridge(null, { name: "Chat Runtime", version: "0.1.0" }, {});
    const fail = () => {
      if (!controller.signal.aborted) setState("error");
    };

    if (onSelectionCount) {
      bridge.setNotificationHandler(
        "notifications/mcp-component-server/selection-changed",
        { params: selectionParams },
        ({ selectedRecords }) => onSelectionCount(selectedRecords.length),
      );
      bridge.onsizechange = ({ height }) => {
        if (typeof height === "number" && Number.isFinite(height) && height > 0) {
          setHeight(Math.min(520, Math.max(200, Math.ceil(height))));
        }
      };
    }

    bridge.oninitialized = () => {
      void bridge.sendToolInput({ arguments: payload.toolInput })
        .then(() => bridge.sendToolResult(result.data))
        .then(() => { if (!controller.signal.aborted) setState("ready"); })
        .catch(fail);
    };

    void readAppHtml(payload.resourceUri, controller.signal)
      .then(async (html) => {
        if (controller.signal.aborted) return;
        await bridge.connect(new PostMessageTransport(frameWindow, frameWindow));
        if (!controller.signal.aborted) frame.srcdoc = sandboxDocument(html);
      })
      .catch(fail);

    return () => {
      controller.abort();
      void bridge.close().catch(() => {});
    };
  }, [payload, onSelectionCount]);

  return (
    <>
      {state === "loading" && <p className={styles.mcpSelection} role="status">正在加载{title}…</p>}
      {state === "error" && <p className={styles.formError} role="alert">{title}加载失败，请确认 MCP 服务已启动。</p>}
      <iframe
        ref={iframe}
        title={title}
        className={styles.mcpFrame}
        style={onSelectionCount ? { height } : undefined}
        hidden={state !== "ready"}
        tabIndex={0}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </>
  );
}

async function readAppHtml(uri: string, signal: AbortSignal) {
  const client = new Client({ name: "chat-runtime-mcp-apps", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp-apps", window.location.origin), {
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    }),
  });

  try {
    await client.connect(transport);
    const { contents } = await client.readResource({ uri }, { signal });
    const resource = contents.find((entry) => entry.uri === uri && entry.mimeType === "text/html;profile=mcp-app");
    if (!resource || !("text" in resource)) throw new Error("MCP app HTML was not returned.");
    return resource.text;
  } finally {
    await client.close();
  }
}

function sandboxDocument(html: string) {
  const head = html.match(/^\s*<!doctype html>\s*<html\b[^>]*>\s*<head\b[^>]*>/i)?.[0];
  if (!head) throw new Error("Expected a bundled MCP Apps HTML document.");
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
  return `${head}<meta http-equiv="Content-Security-Policy" content="${policy}">${html.slice(head.length)}`;
}
