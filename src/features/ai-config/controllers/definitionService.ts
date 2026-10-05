import { AiConfigError, newEtag, newId, type BlobWrite, type DefinitionRecord, type DefinitionSpec, type Scope, type ValidationIssue } from "../domain/models";
import { validateDefinitionSpec } from "../domain/validation";
import type { AiDefinitionRepository } from "../data/repository";
import { encodeText, readSkillBundle, sha256, validateSkillBundle } from "../adapters/skillPackage";
import { machineNamePattern } from "../adapters/skillDocument";

export interface DefinitionDetails { displayName: string; slug: string; summary: string; tags: string[] }
export class DefinitionService {
  constructor(public readonly repository: AiDefinitionRepository, private readonly scope: Scope = { type: "user", id: "local-user" }) {}
  async save(details: DefinitionDetails, spec: DefinitionSpec, previous?: DefinitionRecord, blobs: BlobWrite[] = []) {
    if (previous?.meta.archivedAt) throw new AiConfigError("validation", "已归档定义不能编辑。");
    if (!details.displayName.trim() || details.displayName.length > 200) throw new AiConfigError("validation", "展示名称需为 1–200 个字符。");
    if (!machineNamePattern.test(details.slug) || Array.from(details.slug).length > 64) throw new AiConfigError("validation", "机器名需为 1–64 个小写字母/数字，使用单个连字符分隔。");
    const issues = validateDefinitionSpec(spec.kind, spec);
    if (issues.length) throw new AiConfigError("validation", "配置结构无效。", issues);
    const time = new Date().toISOString(); const etag = newEtag();
    const record: DefinitionRecord = {
      format: "chat-runtime.ai-definition", schemaVersion: 1,
      meta: previous ? { ...previous.meta, ...details, displayName: details.displayName.trim(), updatedAt: time, etag } : {
        id: newId(), kind: spec.kind, scope: this.scope, ownerId: this.scope.id, ...details,
        displayName: details.displayName.trim(), createdAt: time, updatedAt: time, etag,
      },
      availability: previous?.availability ?? { enabled: true },
      draft: { basedOnRevision: previous?.draft.basedOnRevision, spec, etag, updatedAt: time },
      revisions: previous?.revisions ?? [],
    };
    await this.repository.commit(record, previous?.meta.etag ?? null, blobs);
    return record;
  }
  async validate(record: DefinitionRecord): Promise<ValidationIssue[]> {
    const issues = validateDefinitionSpec(record.meta.kind, record.draft.spec);
    if (issues.length) return issues;
    if (record.draft.spec.kind === "skill") {
      const bundle = await readSkillBundle(record.draft.spec, this.repository.getBlob);
      issues.push(...validateSkillBundle(bundle));
      if (record.meta.slug !== bundle.rootDirectory) issues.push({ severity: "error", code: "slug_directory", path: "/meta/slug", message: "Skill 机器名必须与包根目录一致。" });
    }
    if (record.draft.spec.kind === "agent") {
      for (const binding of [
        ...record.draft.spec.skills.map((item) => ({ ref: item.skill, kind: "skill" })),
        ...record.draft.spec.mcp.map((item) => ({ ref: item.connection, kind: "mcp" })),
      ]) {
        try {
          const target = await this.repository.get(binding.ref.id);
          if (target.meta.kind !== binding.kind || target.meta.archivedAt || !target.availability.enabled || !target.revisions.some((item) => item.revision === binding.ref.revision)) throw new Error();
        } catch { issues.push({ severity: "error", code: "dependency_unavailable", path: binding.ref.id, message: "依赖不存在、未发布、停用或已归档。" }); }
      }
    }
    return issues;
  }
  async publish(record: DefinitionRecord) {
    if (record.meta.archivedAt) throw new AiConfigError("validation", "已归档定义不能发布。");
    const issues = await this.validate(record);
    if (issues.some((issue) => issue.severity === "error")) throw new AiConfigError("validation", "校验未通过，不能发布。", issues);
    const revision = (record.revisions.at(-1)?.revision ?? 0) + 1;
    const now = new Date().toISOString(); const etag = newEtag();
    // Specs are generated in deterministic order; file references are already sorted.
    const contentDigest = `sha256:${await sha256(encodeText(canonicalJson(record.draft.spec)))}`;
    const next: DefinitionRecord = { ...record,
      meta: { ...record.meta, publishedRevision: revision, updatedAt: now, etag },
      draft: { ...record.draft, basedOnRevision: revision, etag, updatedAt: now },
      revisions: [...record.revisions, { revision, schemaVersion: 1, spec: structuredClone(record.draft.spec), contentDigest, publishedAt: now, publishedBy: record.meta.ownerId }],
    };
    await this.repository.commit(next, record.meta.etag); return next;
  }
  async setEnabled(record: DefinitionRecord, enabled: boolean) {
    const next = { ...record, meta: { ...record.meta, etag: newEtag(), updatedAt: new Date().toISOString() }, availability: { enabled } };
    await this.repository.commit(next, record.meta.etag); return next;
  }
  async archive(record: DefinitionRecord) {
    const next = { ...record, meta: { ...record.meta, etag: newEtag(), archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, availability: { enabled: false } };
    await this.repository.commit(next, record.meta.etag); return next;
  }
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
