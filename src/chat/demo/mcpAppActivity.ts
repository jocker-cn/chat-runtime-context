export const MCP_APP_ACTIVITY_TYPE = "mcp_app";

export interface McpAppPayload {
  resourceUri: string;
  toolInput: Record<string, unknown>;
  result: Record<string, unknown>;
}

export function readMcpAppPayload(value: unknown): McpAppPayload | undefined {
  if (!isRecord(value)) return;
  const { resourceUri, toolInput, result } = value;
  if (typeof resourceUri !== "string" || !resourceUri.startsWith("ui://")) return;
  if (!isRecord(toolInput) || !isRecord(result) || !Array.isArray(result.content)) return;
  return { resourceUri, toolInput, result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
