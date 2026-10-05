import { createSkillSource, editSkillBody, editSkillFrontmatter, parseSkillDocument } from "../adapters/skillDocument";
import { decodeText, encodeText, mediaType, validPackagePath, validateSkillBundle, type SkillBundle } from "../adapters/skillPackage";
import { AiConfigError } from "../domain/models";

export interface SkillEditorModel { displayName: string; tags: string; bundle: SkillBundle }
export function newSkillEditor(): SkillEditorModel {
  return { displayName: "", tags: "", bundle: { rootDirectory: "my-skill", files: [{ path: "SKILL.md", bytes: encodeText(createSkillSource()) }] } };
}
export function skillEditorView(model: SkillEditorModel, selectedPath: string) {
  const main = model.bundle.files.find((file) => file.path === "SKILL.md");
  const source = main ? decodeText(main.bytes) : "";
  const parsed = parseSkillDocument(source, model.bundle.rootDirectory);
  const selected = model.bundle.files.find((file) => file.path === selectedPath);
  let text: string | undefined;
  if (selected && /^(text\/|application\/(json|yaml))/.test(mediaType(selected.path))) {
    try { text = decodeText(selected.bytes); } catch { /* Invalid text remains an opaque attachment. */ }
  }
  return { source, metadata: parsed.metadata, body: parsed.body, selected, text,
    diagnostics: validateSkillBundle(model.bundle),
    details: { displayName: model.displayName, slug: model.bundle.rootDirectory, summary: parsed.metadata?.description ?? "",
      tags: [...new Set(model.tags.split(/[,，]/).map((value) => value.trim()).filter(Boolean))] } };
}
export function updateSkillFile(model: SkillEditorModel, path: string, text: string): SkillEditorModel {
  return { ...model, bundle: { ...model.bundle, files: model.bundle.files.map((file) => file.path === path ? { ...file, bytes: encodeText(text) } : file) } };
}
export function updateSkillField(model: SkillEditorModel, key: string, value: string): SkillEditorModel {
  const source = skillEditorView(model, "SKILL.md").source;
  const next = updateSkillFile(model, "SKILL.md", key === "body" ? editSkillBody(source, value) : editSkillFrontmatter(source, { [key]: value }));
  return key === "name" ? { ...next, bundle: { ...next.bundle, rootDirectory: value } } : next;
}
export function addSkillFile(model: SkillEditorModel, path: string, bytes = encodeText("")): SkillEditorModel {
  if (!validPackagePath(path) || model.bundle.files.some((file) => file.path.normalize("NFC").toLowerCase() === path.normalize("NFC").toLowerCase())) throw new AiConfigError("validation", "文件路径不安全或已经存在。");
  return { ...model, bundle: { ...model.bundle, files: [...model.bundle.files, { path, bytes }] } };
}
export function removeSkillFile(model: SkillEditorModel, path: string): SkillEditorModel {
  if (path === "SKILL.md") throw new AiConfigError("validation", "不能删除 Skill 主文件。");
  return { ...model, bundle: { ...model.bundle, files: model.bundle.files.filter((file) => file.path !== path) } };
}
