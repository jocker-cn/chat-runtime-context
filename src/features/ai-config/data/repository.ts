import { AiConfigError, type BlobWrite, type DefinitionMeta, type DefinitionRecord } from "../domain/models";
import { validateDefinitionRecord } from "../domain/validation";

export interface AiDefinitionRepository {
  list(): Promise<DefinitionMeta[]>;
  get(id: string): Promise<DefinitionRecord>;
  commit(record: DefinitionRecord, expectedEtag: string | null, blobs?: BlobWrite[]): Promise<void>;
  getBlob(id: string): Promise<Uint8Array>;
  close(): void;
}
export function checkCommit(records: DefinitionRecord[], next: DefinitionRecord, expected: string | null) {
  const issues = validateDefinitionRecord(next);
  if (issues.length) throw new AiConfigError("validation", "定义记录无效。", issues);
  const previous = records.find((record) => record.meta.id === next.meta.id);
  if ((previous?.meta.etag ?? null) !== expected) throw new AiConfigError("conflict", "配置已被其他页面修改。请重新载入，避免覆盖。");
  if (previous && previous.meta.kind !== next.meta.kind) throw new AiConfigError("validation", "已有定义不能更改类型。");
  if (previous && (JSON.stringify(previous.meta.scope) !== JSON.stringify(next.meta.scope) || previous.meta.ownerId !== next.meta.ownerId)) throw new AiConfigError("validation", "已有定义不能更改范围或所有者。");
  if (previous && previous.meta.etag === next.meta.etag) throw new AiConfigError("conflict", "写入需要新的 ETag。");
  if (records.some((record) => record.meta.id !== next.meta.id && record.meta.kind === next.meta.kind &&
    record.meta.scope.type === next.meta.scope.type && record.meta.scope.id === next.meta.scope.id && record.meta.slug === next.meta.slug)) {
    throw new AiConfigError("conflict", "当前范围已存在同类型、同机器名的定义。");
  }
  if (previous && previous.revisions.some((revision) => JSON.stringify(next.revisions.find((item) => item.revision === revision.revision)) !== JSON.stringify(revision))) {
    throw new AiConfigError("conflict", "已发布版本不可修改或移除。");
  }
}
export async function validateBlobWrites(writes: BlobWrite[]) {
  for (const write of writes) {
    const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(write.bytes));
    const id = `sha256:${Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("")}`;
    if (write.id !== id) throw new AiConfigError("validation", "文件内容与寻址摘要不一致。");
  }
}
export function createMemoryAiRepository(): AiDefinitionRepository {
  const records = new Map<string, DefinitionRecord>(); const blobs = new Map<string, Uint8Array>();
  return {
    async list() { return [...records.values()].map((record) => structuredClone(record.meta)); },
    async get(id) { const record = records.get(id); if (!record) throw new AiConfigError("not_found", "定义不存在。"); return structuredClone(record); },
    async commit(record, expected, writes = []) {
      await validateBlobWrites(writes);
      checkCommit([...records.values()], record, expected);
      const copy = structuredClone(record);
      for (const file of writes) blobs.set(file.id, new Uint8Array(file.bytes));
      records.set(record.meta.id, copy);
    },
    async getBlob(id) { const bytes = blobs.get(id); if (!bytes) throw new AiConfigError("storage", "文件内容丢失。"); return new Uint8Array(bytes); },
    close() {},
  };
}
