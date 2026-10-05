export type DefinitionKind = "agent" | "skill" | "mcp";
export type Scope = { type: "user" | "workspace" | "organization"; id: string };
export interface PublishedRef { id: string; revision: number }
export interface ValidationIssue {
  severity: "error" | "warning"; code: string; path: string; message: string; line?: number;
}
export interface DefinitionMeta {
  id: string; kind: DefinitionKind; scope: Scope; slug: string; displayName: string;
  summary: string; tags: string[]; ownerId: string; publishedRevision?: number;
  archivedAt?: string; createdAt: string; updatedAt: string; etag: string;
}
export interface PackageFile {
  path: string; mediaType: string; sizeBytes: number; sha256: string; blobId: string;
}
export interface SkillSpec {
  kind: "skill"; format: "agent-skills"; rootDirectory: string; entry: "SKILL.md"; files: PackageFile[];
}
export interface AgentSpec {
  kind: "agent"; instructions: string; inputSchema?: Record<string, unknown>;
  model: { profileId: string; temperature?: number; maxOutputTokens?: number };
  skills: { skill: PublishedRef; mode: "available" | "activate"; required: boolean }[];
  mcp: { connection: PublishedRef; toolNames: string[]; promptNames: string[]; resourceUris: string[]; required: boolean }[];
  builtInCapabilityIds: string[];
  output: { type: "text" } | { type: "json-schema"; schema: Record<string, unknown> };
  execution: { maxSteps: number; maxConcurrentToolCalls: number; runTimeoutMs: number };
  policyProfileId: string;
}
export type McpTransport =
  | { type: "streamable-http"; url: string; publicHeaders: Record<string, string> }
  | { type: "stdio"; runnerProfileId: string; command: string; args: string[]; publicEnv: Record<string, string> };
export type McpAuth = { type: "none" } | { type: "oauth"; requestedScopes: string[] }
  | { type: "static-secret"; delivery: { type: "bearer" } | { type: "header" | "env"; name: string } };
export interface McpSpec {
  kind: "mcp"; transport: McpTransport; auth: McpAuth;
  protocol: { mode: "auto" } | { mode: "require"; version: string };
  limits: { requestTimeoutMs: number; maxResponseBytes: number };
}
export type DefinitionSpec = SkillSpec | AgentSpec | McpSpec;
export interface DefinitionDraft {
  basedOnRevision?: number; spec: DefinitionSpec; etag: string; updatedAt: string;
}
export interface DefinitionRevision {
  revision: number; schemaVersion: 1; spec: DefinitionSpec; contentDigest: string;
  publishedAt: string; publishedBy: string;
}
/** Separate mutable availability and immutable published content. No credentials or parsed file body. */
export interface DefinitionRecord {
  format: "chat-runtime.ai-definition"; schemaVersion: 1; meta: DefinitionMeta;
  availability: { enabled: boolean }; draft: DefinitionDraft; revisions: DefinitionRevision[];
}
/** Bytes live in the repository's separate object store, not the spec/metadata. */
export interface BlobWrite { id: string; bytes: Uint8Array }
export class AiConfigError extends Error {
  constructor(public readonly code: "validation" | "conflict" | "not_found" | "storage" | "dependency",
    message: string, public readonly issues: ValidationIssue[] = []) { super(message); this.name = "AiConfigError"; }
}
export const newId = () => crypto.randomUUID();
export const newEtag = () => newId();
