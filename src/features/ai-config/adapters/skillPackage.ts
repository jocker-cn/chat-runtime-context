import { Unzip, UnzipInflate, zipSync } from "fflate";
import { AiConfigError, type BlobWrite, type SkillSpec, type ValidationIssue } from "../domain/models";
import { machineNamePattern, parseSkillDocument } from "./skillDocument";

export interface WorkingFile { path: string; bytes: Uint8Array }
/** Transient editor/adapter data. Published specs contain file references only. */
export interface SkillBundle { rootDirectory: string; files: WorkingFile[] }
export const packageLimits = { files: 200, fileBytes: 2 * 1024 * 1024, totalBytes: 20 * 1024 * 1024, archiveBytes: 12 * 1024 * 1024 };
export const encodeText = (value: string) => new TextEncoder().encode(value);
export const decodeText = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
export function validPackagePath(path: string): boolean {
  return path.length > 0 && path.length <= 1024 && !/[\\:\x00-\x1f\x7f]/.test(path) && !path.startsWith("/") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export function validateSkillBundle(bundle: SkillBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, path = "package") => issues.push({ severity: "error" as const, code, message, path });
  if (!machineNamePattern.test(bundle.rootDirectory) || Array.from(bundle.rootDirectory).length > 64) add("root_invalid", "根目录需为合法的 Skill 机器名。");
  if (bundle.files.length > packageLimits.files) add("file_count", `文件数量不能超过 ${packageLimits.files}。`);
  let total = 0;
  const paths = new Set<string>();
  for (const file of bundle.files) {
    if (!validPackagePath(file.path)) add("path_unsafe", "文件路径必须是安全的相对路径。", file.path);
    const key = file.path.normalize("NFC").toLowerCase();
    if (paths.has(key)) add("path_duplicate", "文件路径重复或存在大小写/Unicode 冲突。", file.path);
    paths.add(key); total += file.bytes.byteLength;
    if (file.bytes.byteLength > packageLimits.fileBytes) add("file_size", "单文件不能超过 2 MiB。", file.path);
    if (file.path.startsWith("scripts/")) issues.push({ severity: "warning", code: "script_not_executable", path: file.path, message: "脚本仅保存，不会在浏览器或 BE 自动执行。" });
  }
  for (const path of paths) {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) {
      if (paths.has(segments.slice(0, i).join("/"))) add("path_conflict", "文件路径不能同时作为另一个文件的目录。", path);
    }
  }
  if (total > packageLimits.totalBytes) add("package_size", "文件包总大小不能超过 20 MiB。");
  const main = bundle.files.find((file) => file.path === "SKILL.md");
  if (!main) add("entry_missing", "文件包缺少 SKILL.md。");
  else {
    try { issues.push(...parseSkillDocument(decodeText(main.bytes), bundle.rootDirectory).issues); }
    catch { add("entry_encoding", "SKILL.md 必须是有效 UTF-8 文本。", "SKILL.md"); }
  }
  return issues;
}
export function assertPackageSafety(bundle: SkillBundle) {
  const issues = validateSkillBundle(bundle).filter((issue) => issue.severity === "error" && !["root_invalid", "entry_missing", "frontmatter_missing", "yaml_invalid", "yaml_alias", "yaml_tag", "frontmatter_object", "name_invalid", "name_directory", "description_invalid", "field_type", "compatibility_length", "metadata_type", "unsupported_field"].includes(issue.code));
  if (issues.length) throw new AiConfigError("validation", "文件包包含不安全的路径、编码或过大文件。", issues);
}
export async function sha256(bytes: Uint8Array) {
  const result = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(result), (value) => value.toString(16).padStart(2, "0")).join("");
}
export function mediaType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ md: "text/markdown", txt: "text/plain", json: "application/json", yaml: "application/yaml", yml: "application/yaml",
    py: "text/x-python", js: "text/javascript", ts: "text/plain", sh: "text/x-shellscript", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf", svg: "image/svg+xml" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}
export async function prepareSkillBundle(bundle: SkillBundle): Promise<{ spec: SkillSpec; blobs: BlobWrite[] }> {
  assertPackageSafety(bundle);
  const blobs: BlobWrite[] = [];
  const files = await Promise.all(bundle.files.map(async (file) => {
    const hash = await sha256(file.bytes); const id = `sha256:${hash}`;
    blobs.push({ id, bytes: new Uint8Array(file.bytes) });
    return { path: file.path, mediaType: mediaType(file.path), sizeBytes: file.bytes.byteLength, sha256: hash, blobId: id };
  }));
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { spec: { kind: "skill", format: "agent-skills", rootDirectory: bundle.rootDirectory, entry: "SKILL.md", files }, blobs };
}
export async function readSkillBundle(spec: SkillSpec, getBlob: (id: string) => Promise<Uint8Array>): Promise<SkillBundle> {
  const files = await Promise.all(spec.files.map(async (file) => {
    const bytes = await getBlob(file.blobId);
    if (bytes.byteLength !== file.sizeBytes || await sha256(bytes) !== file.sha256) throw new AiConfigError("storage", `文件 ${file.path} 的内容校验失败。`);
    return { path: file.path, bytes };
  }));
  return { rootDirectory: spec.rootDirectory, files };
}
export function bundleFromMarkdown(source: string): SkillBundle {
  const parsed = parseSkillDocument(source);
  return { rootDirectory: parsed.metadata?.name ?? "imported-skill", files: [{ path: "SKILL.md", bytes: encodeText(source) }] };
}

/** Inspect the central directory before inflating; duplicate paths/symlinks cannot disappear in a map. */
function inspectZip(bytes: Uint8Array) {
  if (bytes.length > packageLimits.archiveBytes) throw new AiConfigError("validation", "ZIP 文件不能超过 12 MiB。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || end < bytes.length - 65557 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) throw new AiConfigError("validation", "ZIP 目录无效。");
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count > packageLimits.files + 100 || count === 65535) throw new AiConfigError("validation", "不支持分卷、ZIP64 或过多文件。");
  const entries = new Map<string, number>(); let total = 0;
  let offset = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new AiConfigError("validation", "ZIP 目录损坏。");
    const length = view.getUint16(offset + 28, true); const next = offset + 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end) throw new AiConfigError("validation", "ZIP 路径数据损坏。");
    const name = decodeText(bytes.subarray(offset + 46, offset + 46 + length));
    const size = view.getUint32(offset + 24, true);
    const mode = view.getUint32(offset + 38, true) >>> 16;
    if ((mode & 0xf000) === 0xa000 || (view.getUint16(offset + 8, true) & 1) || ![0, 8].includes(view.getUint16(offset + 10, true))) throw new AiConfigError("validation", "ZIP 包含符号链接、加密或不支持的压缩方式。");
    const key = name.normalize("NFC").toLowerCase();
    if (!validPackagePath(name.endsWith("/") ? name.slice(0, -1) : name) || [...entries.keys()].some((item) => item.normalize("NFC").toLowerCase() === key)) throw new AiConfigError("validation", "ZIP 包含非法或重复路径。");
    if (!name.endsWith("/")) {
      if (size > packageLimits.fileBytes || (total += size) > packageLimits.totalBytes) throw new AiConfigError("validation", "ZIP 解压大小超过限制。");
      entries.set(name, size);
    }
    offset = next;
  }
  if (offset !== end || entries.size > packageLimits.files) throw new AiConfigError("validation", "ZIP 文件目录数量或范围无效。");
  return entries;
}
export function importSkillZip(bytes: Uint8Array): SkillBundle {
  try {
    const entries = inspectZip(bytes); const files: WorkingFile[] = []; let total = 0; let failure: Error | undefined;
    const seen = new Set<string>();
    const unzip = new Unzip((file) => {
      if (file.name.endsWith("/")) return;
      if (!entries.has(file.name) || seen.has(file.name)) { failure = new Error("ZIP 本地条目与目录不一致。"); return; }
      seen.add(file.name); const chunks: Uint8Array[] = []; let size = 0;
      file.ondata = (error, chunk, final) => {
        if (error) { failure = error; return; }
        size += chunk.length; total += chunk.length;
        if (size > packageLimits.fileBytes || total > packageLimits.totalBytes || size > entries.get(file.name)!) {
          failure = new Error("实际解压内容超过声明或大小限制。"); file.terminate(); return;
        }
        chunks.push(chunk);
        if (final) {
          if (size !== entries.get(file.name)) { failure = new Error("ZIP 声明与内容大小不一致。"); return; }
          const content = new Uint8Array(size); let offset = 0;
          for (const part of chunks) { content.set(part, offset); offset += part.length; }
          files.push({ path: file.name, bytes: content });
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length && !failure; offset += 1024) unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
    if (failure || files.length !== entries.size) throw failure ?? new Error("ZIP 未完整解压。");
    const mains = files.filter((file) => file.path === "SKILL.md" || /^[^/]+\/SKILL\.md$/.test(file.path));
    if (mains.length !== 1) throw new Error("ZIP 必须仅包含一个根 Skill 主文件。");
    const prefix = mains[0].path === "SKILL.md" ? "" : mains[0].path.slice(0, -8);
    if (prefix && files.some((file) => !file.path.startsWith(prefix))) throw new Error("ZIP 包含 Skill 根目录之外的文件。");
    const source = decodeText(mains[0].bytes);
    const bundle = { rootDirectory: prefix ? prefix.slice(0, -1) : parseSkillDocument(source).metadata?.name ?? "imported-skill",
      files: files.map((file) => ({ ...file, path: file.path.slice(prefix.length) })) };
    assertPackageSafety(bundle); return bundle;
  } catch (error) { throw error instanceof AiConfigError ? error : new AiConfigError("validation", error instanceof Error ? error.message : "ZIP 导入失败。"); }
}
export function exportSkillZip(bundle: SkillBundle) {
  assertPackageSafety(bundle);
  if (!machineNamePattern.test(bundle.rootDirectory) || Array.from(bundle.rootDirectory).length > 64) throw new AiConfigError("validation", "导出前请修复 Skill 根目录名称。");
  const entries: Record<string, Uint8Array> = Object.create(null);
  for (const file of bundle.files) entries[`${bundle.rootDirectory}/${file.path}`] = file.bytes;
  return zipSync(entries, { level: 6 });
}
