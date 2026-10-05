import { createIndexedDB } from "../../../core/indexedDB";
import { AiConfigError, type DefinitionRecord } from "../domain/models";
import { checkCommit, validateBlobWrites, type AiDefinitionRepository } from "./repository";
import { validateDefinitionRecord } from "../domain/validation";

const storageError = (cause: unknown): never => {
  if (cause instanceof AiConfigError) throw cause;
  throw new AiConfigError("storage", "本地存储操作失败，请检查浏览器权限或存储配额。未保存的内容仍保留在编辑器中。");
};
function domainRecord(stored: DefinitionRecord & { identity?: string }): DefinitionRecord {
  const { identity: _identity, ...domain } = stored;
  const issues = validateDefinitionRecord(domain);
  if (issues.length) throw new AiConfigError("storage", "本地定义的格式或版本不支持。", issues);
  return domain;
}
export const aiDatabaseName = "chat-runtime.ai-config.v1";
type AiStores = {
  definitions: { key: string; value: DefinitionRecord & { identity: string }; indexes: { identity: string } };
  blobs: { key: string; value: Uint8Array };
};

export function createIndexedDbAiRepository(name = aiDatabaseName): AiDefinitionRepository {
  const database = createIndexedDB<AiStores>({
    name,
    version: 1,
    upgrade({ database, oldVersion }) {
      if (oldVersion >= 1) return;
      const records = database.createObjectStore("definitions", { keyPath: "meta.id" });
      records.createIndex("identity", "identity", { unique: true });
      database.createObjectStore("blobs");
    },
  });
  return {
    async list() { try {
      const records = await database.getAll("definitions");
      return records.map((record) => domainRecord(record).meta);
    } catch (error) { return storageError(error); } },
    async get(id) { try {
      const record = await database.get("definitions", id);
      if (!record) throw new AiConfigError("not_found", "定义不存在。");
      return domainRecord(record);
    } catch (error) { return storageError(error); } },
    async commit(record, expected, blobs = []) { try {
      await validateBlobWrites(blobs);
      await database.transaction(["definitions", "blobs"], "readwrite", async (tx) => {
        const definitions = tx.store("definitions");
        const records = (await definitions.getAll()).map(domainRecord);
        checkCommit(records, record, expected);
        const identity = JSON.stringify([record.meta.scope.type, record.meta.scope.id, record.meta.kind, record.meta.slug]);
        await definitions.put({ ...record, identity });
        for (const blob of blobs) await tx.store("blobs").put(new Uint8Array(blob.bytes), blob.id);
      });
    } catch (error) { storageError(error); } },
    async getBlob(id) { try {
      const bytes = await database.get("blobs", id);
      if (!(bytes instanceof Uint8Array)) throw new AiConfigError("storage", "Skill 文件内容不存在。");
      return bytes;
    } catch (error) { return storageError(error); } },
    close() { database.close(); },
  };
}
