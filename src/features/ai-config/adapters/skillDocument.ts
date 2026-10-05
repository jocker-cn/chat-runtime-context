import { LineCounter, isAlias, parseDocument, visit } from "yaml";
import type { ValidationIssue } from "../domain/models";

export interface SkillMetadata {
  name: string; description: string; license?: string; compatibility?: string;
  metadata?: Record<string, string>; allowedTools?: string;
}
export interface ParsedSkill { metadata?: SkillMetadata; body: string; issues: ValidationIssue[] }
export const machineNamePattern = /^(?!.*[\p{Lu}\p{Lt}])[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
function split(source: string) {
  const match = source.match(/^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  return match ? { yaml: match[1], body: source.slice(match[0].length), prefix: match[0] } : undefined;
}

export function parseSkillDocument(source: string, rootDirectory?: string): ParsedSkill {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, line?: number, severity: "error" | "warning" = "error") =>
    issues.push({ severity, code, message, path: "SKILL.md", line });
  const parts = split(source);
  if (!parts) return { body: source, issues: [{ severity: "error", code: "frontmatter_missing", path: "SKILL.md", line: 1, message: "主文件必须以 YAML frontmatter 开始并以 --- 结束。" }] };
  const counter = new LineCounter();
  const doc = parseDocument(parts.yaml, { lineCounter: counter, uniqueKeys: true, stringKeys: true, strict: true, logLevel: "silent" });
  for (const error of doc.errors) add("yaml_invalid", error.message, counter.linePos(error.pos[0]).line + 1);
  visit(doc, (_key, node) => {
    if (isAlias(node)) add("yaml_alias", "不支持 YAML alias，请展开为明确内容。", node.range ? counter.linePos(node.range[0]).line + 1 : undefined);
    if (node && typeof node === "object" && "tag" in node && typeof node.tag === "string" && !["tag:yaml.org,2002:str", "tag:yaml.org,2002:map", "tag:yaml.org,2002:seq"].includes(node.tag)) add("yaml_tag", "不支持自定义或非文本 YAML tag。");
  });
  for (const warning of doc.warnings) add("yaml_warning", warning.message, undefined, "warning");
  if (issues.some((issue) => issue.severity === "error")) return { body: parts.body, issues };
  let raw: unknown;
  try { raw = doc.toJS({ maxAliasCount: 0 }); } catch { add("yaml_invalid", "无法解析 YAML。"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { add("frontmatter_object", "frontmatter 必须是字段对象。"); return { body: parts.body, issues }; }
  const data = raw as Record<string, unknown>;
  if (typeof data.name !== "string" || !machineNamePattern.test(data.name) || Array.from(data.name).length > 64) add("name_invalid", "机器名需为 1–64 个小写字母/数字，使用单个连字符分隔。", 2);
  if (rootDirectory && data.name !== rootDirectory) add("name_directory", "name 必须与 Skill 根目录名称一致。", 2);
  if (typeof data.description !== "string" || !data.description.trim() || Array.from(data.description).length > 1024) add("description_invalid", "description 需为非空字符串，最多 1024 个字符。");
  for (const key of ["license", "compatibility", "allowed-tools"]) if (data[key] !== undefined && (typeof data[key] !== "string" || !(data[key] as string).trim())) add("field_type", `${key} 必须为非空字符串。`);
  if (typeof data.compatibility === "string" && Array.from(data.compatibility).length > 500) add("compatibility_length", "compatibility 最多 500 个字符。");
  if (data.metadata !== undefined && (!data.metadata || typeof data.metadata !== "object" || Array.isArray(data.metadata) || Object.values(data.metadata).some((item) => typeof item !== "string"))) add("metadata_type", "metadata 必须为字符串键值对象。");
  const known = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"];
  for (const key of Object.keys(data)) if (!known.includes(key)) add("unsupported_field", `扩展字段 ${key} 原文保留，但当前执行语义不支持；请确认后调整再发布。`);
  if (data["allowed-tools"] !== undefined) add("experimental_tools", "allowed-tools 已保留；本阶段不执行工具，也不把该字段当成授权。", undefined, "warning");
  if (!parts.body.trim()) add("instructions_empty", "正文没有工作流指令。", undefined, "warning");
  return { body: parts.body, issues, metadata: typeof data.name === "string" && typeof data.description === "string" ? {
    name: data.name, description: data.description, license: data.license as string | undefined,
    compatibility: data.compatibility as string | undefined, metadata: data.metadata as Record<string, string> | undefined,
    allowedTools: data["allowed-tools"] as string | undefined,
  } : undefined };
}

/** Edits the one source file, preserving comments and fields that the UI does not understand. */
export function editSkillFrontmatter(source: string, patch: Record<string, string | undefined>): string {
  const parts = split(source);
  if (!parts) throw new Error("请先修复 frontmatter，再使用表单编辑。");
  const doc = parseDocument(parts.yaml, { uniqueKeys: true, stringKeys: true, logLevel: "silent" });
  if (doc.errors.length) throw new Error("请先修复 YAML 错误，再使用表单编辑。");
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "") doc.delete(key); else doc.set(key, value);
  }
  return `---\n${doc.toString()}---\n${parts.body}`;
}
export function editSkillBody(source: string, body: string): string {
  const parts = split(source);
  if (!parts) throw new Error("请先修复 frontmatter。");
  return parts.prefix + body;
}
export function createSkillSource(name = "my-skill", description = "描述这个 Skill 的用途，以及何时使用。", body = "# 工作流\n\n描述处理步骤、输出要求与注意事项。\n") {
  return editSkillFrontmatter(`---\nname: my-skill\ndescription: skill\n---\n${body}`, { name, description });
}
