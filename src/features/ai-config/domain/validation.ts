import Ajv from "ajv/dist/2020";
import type { DefinitionKind, ValidationIssue } from "./models";

const text = { type: "string", minLength: 1, maxLength: 2048 };
const strings = { type: "array", items: text, uniqueItems: true, maxItems: 500 };
const positive = { type: "integer", minimum: 1, maximum: 1_000_000_000 };
const ref = { type: "object", required: ["id", "revision"], additionalProperties: false,
  properties: { id: text, revision: positive } };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });
const dictionary = { type: "object", additionalProperties: { type: "string", maxLength: 4096 }, maxProperties: 100 };
const schema = { type: "object" };
/** Explicit local schema version, not a purported universal Agent/MCP config standard. */
export const definitionSpecSchemas = {
  skill: object({ kind: { const: "skill" }, format: { const: "agent-skills" }, rootDirectory: text,
    entry: { const: "SKILL.md" }, files: { type: "array", maxItems: 200, minItems: 1,
      items: object({ path: text, mediaType: text, sizeBytes: { type: "integer", minimum: 0, maximum: 2 * 1024 * 1024 },
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, blobId: text }) } }),
  agent: object({ kind: { const: "agent" }, instructions: { type: "string", minLength: 1, maxLength: 100_000 }, inputSchema: schema,
    model: object({ profileId: text, temperature: { type: "number", minimum: 0, maximum: 2 }, maxOutputTokens: positive }, ["profileId"]),
    skills: { type: "array", maxItems: 100, items: object({ skill: ref, mode: { enum: ["available", "activate"] }, required: { type: "boolean" } }) },
    mcp: { type: "array", maxItems: 100, items: object({ connection: ref, toolNames: strings, promptNames: strings, resourceUris: strings, required: { type: "boolean" } }) },
    builtInCapabilityIds: strings,
    output: { oneOf: [object({ type: { const: "text" } }), object({ type: { const: "json-schema" }, schema })] },
    execution: object({ maxSteps: positive, maxConcurrentToolCalls: positive, runTimeoutMs: positive }), policyProfileId: text,
  }, ["kind", "instructions", "model", "skills", "mcp", "builtInCapabilityIds", "output", "execution", "policyProfileId"]),
  mcp: object({ kind: { const: "mcp" }, transport: { oneOf: [
    object({ type: { const: "streamable-http" }, url: text, publicHeaders: dictionary }),
    object({ type: { const: "stdio" }, runnerProfileId: text, command: text, args: { ...strings, uniqueItems: false }, publicEnv: dictionary }),
  ] }, auth: { oneOf: [object({ type: { const: "none" } }), object({ type: { const: "oauth" }, requestedScopes: strings }),
    object({ type: { const: "static-secret" }, delivery: { oneOf: [object({ type: { const: "bearer" } }), object({ type: { enum: ["header", "env"] }, name: text })] } })] },
    protocol: { oneOf: [object({ mode: { const: "auto" } }), object({ mode: { const: "require" }, version: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } })] },
    limits: object({ requestTimeoutMs: positive, maxResponseBytes: positive }),
  }),
} as const;

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validators = Object.fromEntries(Object.entries(definitionSpecSchemas).map(([kind, value]) => [kind, ajv.compile(value)]));
export function validateDefinitionSpec(kind: DefinitionKind, value: unknown): ValidationIssue[] {
  const validate = validators[kind];
  if (!validate(value)) return (validate.errors ?? []).map((error) => ({ severity: "error", code: "spec_schema",
    path: error.instancePath || "/", message: `${error.instancePath || "/"} ${error.message}` }));
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ severity: "error", code: "spec_semantic", path, message });
  if (kind === "mcp") {
    const spec = value as unknown as import("./models").McpSpec;
    if (spec.transport.type === "streamable-http") {
      try {
        const url = new URL(spec.transport.url);
        if (url.protocol !== "https:" || url.username || url.password || url.hash) issue("/transport/url", "正式 MCP 地址需为 HTTPS，不含凭据或 fragment。");
      } catch { issue("/transport/url", "MCP 地址不是有效 URL。"); }
      for (const key of Object.keys(spec.transport.publicHeaders)) {
        if (/authorization|cookie|token|secret|api[-_]?key/i.test(key)) issue("/transport/publicHeaders", "私密 Header 需通过授权绑定注入。");
      }
      if (spec.auth.type === "static-secret" && spec.auth.delivery.type === "env") issue("/auth", "HTTP 不能使用环境变量投递凭据。");
    } else {
      if (/[\r\n]/.test(spec.transport.command)) issue("/transport/command", "命令不可包含换行。");
      for (const key of Object.keys(spec.transport.publicEnv)) if (/token|secret|password|api.?key/i.test(key)) issue("/transport/publicEnv", "私密环境变量需通过授权绑定注入。");
      if (spec.auth.type === "oauth" || (spec.auth.type === "static-secret" && spec.auth.delivery.type !== "env")) issue("/auth", "stdio 凭据应通过环境绑定，而不是 HTTP 授权。");
    }
  }
  if (kind === "agent") {
    const spec = value as unknown as import("./models").AgentSpec;
    if (!spec.instructions.trim()) issue("/instructions", "Agent 指令不能为空。");
    for (const [path, candidate] of [["/inputSchema", spec.inputSchema], ["/output/schema", spec.output.type === "json-schema" ? spec.output.schema : undefined]] as const) {
      if (candidate) {
        if (!boundedJson(candidate)) issue(path, "JSON Schema 超过 64 KiB、32 层或 5000 个节点的限制。");
        else { try { new Ajv({ strict: false, validateFormats: false }).compile(candidate); } catch { issue(path, "JSON Schema 无效或包含未提供的外部引用。"); } }
      }
    }
    for (const [path, refs] of [["/skills", spec.skills.map((item) => item.skill.id)], ["/mcp", spec.mcp.map((item) => item.connection.id)]] as const) {
      if (new Set(refs).size !== refs.length) issue(path, "同一能力不可重复绑定。");
    }
  }
  return issues;
}

function boundedJson(value: unknown): boolean {
  let nodes = 0;
  const walk = (item: unknown, depth: number): boolean => {
    if (++nodes > 5000 || depth > 32) return false;
    return item === null || typeof item !== "object" || Object.values(item).every((child) => walk(child, depth + 1));
  };
  try { return walk(value, 0) && new TextEncoder().encode(JSON.stringify(value)).length <= 65536; }
  catch { return false; }
}

const specs = { oneOf: Object.values(definitionSpecSchemas) };
const recordValidator = ajv.compile(object({
  format: { const: "chat-runtime.ai-definition" }, schemaVersion: { const: 1 },
  meta: object({
    id: text, kind: { enum: ["agent", "skill", "mcp"] },
    scope: object({ type: { enum: ["user", "workspace", "organization"] }, id: text }),
    slug: { type: "string", minLength: 1, maxLength: 64 }, displayName: { type: "string", minLength: 1, maxLength: 200 },
    summary: { type: "string", maxLength: 4096 }, tags: { ...strings, maxItems: 50 }, ownerId: text,
    publishedRevision: positive, archivedAt: text, createdAt: text, updatedAt: text, etag: text,
  }, ["id", "kind", "scope", "slug", "displayName", "summary", "tags", "ownerId", "createdAt", "updatedAt", "etag"]),
  availability: object({ enabled: { type: "boolean" } }),
  draft: object({ basedOnRevision: positive, spec: specs, etag: text, updatedAt: text }, ["spec", "etag", "updatedAt"]),
  revisions: { type: "array", items: object({ revision: positive, schemaVersion: { const: 1 }, spec: specs,
    contentDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, publishedAt: text, publishedBy: text }) },
}));
/** Validate persisted/transported POJOs before treating them as domain records. */
export function validateDefinitionRecord(value: unknown): ValidationIssue[] {
  if (!recordValidator(value)) return (recordValidator.errors ?? []).map((error) => ({
    severity: "error", code: "record_schema", path: error.instancePath || "/", message: error.message ?? "定义结构无效。",
  }));
  const record = value as unknown as import("./models").DefinitionRecord;
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: "error", code: "record_semantic", path, message });
  if (record.draft.spec.kind !== record.meta.kind || record.revisions.some((item) => item.spec.kind !== record.meta.kind)) error("/meta/kind", "定义类型与内容不一致。");
  if (record.revisions.some((item, index) => item.revision !== index + 1)) error("/revisions", "发布版本必须从 1 连续递增。");
  if (record.meta.publishedRevision !== record.revisions.at(-1)?.revision) error("/meta/publishedRevision", "当前发布版本与历史不一致。");
  if (record.draft.basedOnRevision && !record.revisions.some((item) => item.revision === record.draft.basedOnRevision)) error("/draft/basedOnRevision", "草稿基于的版本不存在。");
  for (const item of [record.draft.spec, ...record.revisions.map((revision) => revision.spec)]) {
    if (item.kind === "skill" && item.files.some((file) => file.blobId !== `sha256:${file.sha256}`)) error("/files", "文件引用必须使用内容寻址。");
  }
  return issues;
}
