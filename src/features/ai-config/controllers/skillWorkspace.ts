import type { AiDefinitionRepository } from "../data/repository";
import { AiConfigError, type DefinitionMeta, type DefinitionRecord, type PublishedRef } from "../domain/models";
import { createSkillSource, parseSkillDocument } from "../adapters/skillDocument";
import { decodeText, encodeText, prepareSkillBundle, readSkillBundle, sha256, type SkillBundle } from "../adapters/skillPackage";
import { DefinitionService, type DefinitionDetails } from "./definitionService";

export interface SkillSummary { id: string; name: string; description: string; revision: number; enabled: boolean }
export interface SkillWorkspaceSnapshot {
  status: "loading" | "ready" | "error"; definitions: DefinitionMeta[]; published: SkillSummary[]; error?: string;
}
export class SkillWorkspace {
  private snapshot: SkillWorkspaceSnapshot = { status: "loading", definitions: [], published: [] };
  private listeners = new Set<() => void>();
  private starting?: Promise<void>;
  readonly service: DefinitionService;
  constructor(public readonly repository: AiDefinitionRepository) { this.service = new DefinitionService(repository); }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(snapshot: SkillWorkspaceSnapshot) { this.snapshot = snapshot; for (const listener of this.listeners) listener(); }
  start() {
    if (this.snapshot.status === "error") this.starting = undefined;
    return this.starting ??= this.initialize();
  }
  private async initialize() {
    this.emit({ ...this.snapshot, status: "loading", error: undefined });
    try {
      const list = await this.repository.list();
      if (!list.some((item) => item.id === "release-skill")) {
        // A new built-in example, not an automatic conversion of the old POC catalog.
        const source = createSkillSource("release-risk-review", "按 P0/P1 分类整理发布风险。", "# 发布风险检查\n\n检查回滚记录、灰度阈值和通知负责人，并按优先级汇总。\n\n参考 references/risk-levels.md。没有审批时不执行发布或回滚。\n");
        const bundle: SkillBundle = { rootDirectory: "release-risk-review", files: [
          { path: "SKILL.md", bytes: encodeText(source) },
          { path: "references/risk-levels.md", bytes: encodeText("# 风险等级\n\nP0：发布前必须关闭。\nP1：明确负责人和处理期限。\n") },
        ] };
        const prepared = await prepareSkillBundle(bundle); const time = new Date().toISOString();
        const record: DefinitionRecord = { format: "chat-runtime.ai-definition", schemaVersion: 1,
          meta: { id: "release-skill", kind: "skill", scope: { type: "user", id: "local-user" }, ownerId: "local-user",
            slug: bundle.rootDirectory, displayName: "发布风险检查", summary: "按 P0/P1 分类整理发布风险。", tags: [], createdAt: time, updatedAt: time, etag: crypto.randomUUID() },
          availability: { enabled: true }, draft: { spec: prepared.spec, etag: crypto.randomUUID(), updatedAt: time }, revisions: [] };
        try { await this.repository.commit(record, null, prepared.blobs); await this.service.publish(record); }
        catch (error) { if (!(error instanceof AiConfigError) || error.code !== "conflict") throw error; }
      }
      await this.refresh();
    } catch (error) { this.emit({ ...this.snapshot, status: "error", error: error instanceof Error ? error.message : "加载失败。" }); }
  }
  async refresh() {
    const definitions = (await this.repository.list()).filter((item) => item.kind === "skill" && !item.archivedAt);
    const records = await Promise.all(definitions.map((item) => this.repository.get(item.id)));
    const published = records.filter((item) => item.meta.publishedRevision && item.availability.enabled).map((item) => {
      const revision = item.revisions.find((entry) => entry.revision === item.meta.publishedRevision)!;
      // Display labels are separate from immutable execution content; the revision is the actual key.
      return { id: item.meta.id, name: item.meta.displayName, description: item.meta.summary, revision: revision.revision, enabled: true };
    });
    this.emit({ status: "ready", definitions, published });
  }
  async open(id: string) {
    const record = await this.repository.get(id);
    if (record.draft.spec.kind !== "skill") throw new AiConfigError("validation", "这不是 Skill 定义。");
    return { record, bundle: await readSkillBundle(record.draft.spec, this.repository.getBlob) };
  }
  async save(details: DefinitionDetails, bundle: SkillBundle, previous?: DefinitionRecord) {
    const prepared = await prepareSkillBundle(bundle);
    const record = await this.service.save(details, prepared.spec, previous, prepared.blobs);
    await this.refresh(); return record;
  }
  async publish(record: DefinitionRecord) { const next = await this.service.publish(record); await this.refresh(); return next; }
  async publishedSource(ref: PublishedRef) {
    const record = await this.repository.get(ref.id);
    if (!record.availability.enabled || record.meta.archivedAt) throw new AiConfigError("dependency", "Skill 已停用或归档。");
    const revision = record.revisions.find((item) => item.revision === ref.revision);
    if (!revision || revision.spec.kind !== "skill") throw new AiConfigError("not_found", "Skill 发布版本不存在。");
    const main = revision.spec.files.find((item) => item.path === "SKILL.md");
    if (!main) throw new AiConfigError("storage", "发布包缺少主文件。");
    const bytes = await this.repository.getBlob(main.blobId);
    if (bytes.byteLength !== main.sizeBytes || await sha256(bytes) !== main.sha256) throw new AiConfigError("storage", "Skill 主文件内容校验失败。");
    const source = decodeText(bytes);
    return parseSkillDocument(source, revision.spec.rootDirectory).body;
  }
}
