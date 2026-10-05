import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { createSkillSource, editSkillBody, editSkillFrontmatter, parseSkillDocument } from "../../../src/features/ai-config/adapters/skillDocument";
import { assertPackageSafety, bundleFromMarkdown, decodeText, encodeText, exportSkillZip, importSkillZip, prepareSkillBundle, readSkillBundle, validateSkillBundle, validPackagePath } from "../../../src/features/ai-config/adapters/skillPackage";
import { addSkillFile, newSkillEditor, removeSkillFile, skillEditorView, updateSkillField } from "../../../src/features/ai-config/controllers/skillEditorModel";
import { bundle } from "./fixtures";

describe("standard Skill document and editor", () => {
  it("parses all supported standard metadata and keeps body separate", () => {
    const source = `---\nname: 发布检查\ndescription: 在发布前检查风险\nlicense: MIT\ncompatibility: 需要发布资料\nmetadata:\n  author: Joker\n  version: "1.0"\nallowed-tools: Read\n---\n# 检查\n`;
    const parsed = parseSkillDocument(source, "发布检查");
    expect(parsed.metadata).toMatchObject({ name: "发布检查", license: "MIT", metadata: { version: "1.0" }, allowedTools: "Read" });
    expect(parsed.body).toBe("# 检查\n");
    expect(parsed.issues.filter((item) => item.severity === "error")).toEqual([]);
    expect(parsed.issues.some((item) => item.code === "experimental_tools")).toBe(true);
  });
  it.each([
    ["name: bad--name\ndescription: test", "name_invalid"],
    ["name: name\ndescription: test", "name_directory"],
    ["name: test-skill\ndescription: 1", "description_invalid"],
    ["name: test-skill\nname: repeated\ndescription: test", "yaml_invalid"],
    ["name: &name test-skill\ndescription: *name", "yaml_alias"],
    ["name: !!int 1\ndescription: test", "yaml_tag"],
    ["name: test-skill\ndescription: test\nunrecognized: keep", "unsupported_field"],
  ])("reports %s without executing YAML", (header, code) => {
    expect(parseSkillDocument(`---\n${header}\n---\nworkflow`, "test-skill").issues.some((item) => item.code === code)).toBe(true);
  });
  it("preserves comments, metadata and unknown fields through form edits", () => {
    const source = "---\n# preserve\nname: test-skill\ndescription: old\nmetadata:\n  version: '1'\ncustom-field: preserved\n---\nbody";
    const changed = editSkillFrontmatter(source, { description: "new" });
    expect(changed).toContain("# preserve");
    expect(changed).toContain("custom-field: preserved");
    expect(parseSkillDocument(changed).metadata?.metadata).toEqual({ version: "1" });
    expect(editSkillBody(changed, "changed body")).toContain("custom-field: preserved");
  });
  it("has a single content source for source and form modes", () => {
    let model = newSkillEditor();
    model = updateSkillField(model, "name", "risk-review");
    model = updateSkillField(model, "body", "Use references/a.md.");
    model = addSkillFile(model, "references/a.md", encodeText("reference"));
    expect(model.bundle.rootDirectory).toBe("risk-review");
    expect(skillEditorView(model, "SKILL.md").source).toContain("name: risk-review");
    expect(skillEditorView(model, "SKILL.md").body).toBe("Use references/a.md.");
    expect(skillEditorView(model, "references/a.md").text).toBe("reference");
    expect(() => removeSkillFile(model, "SKILL.md")).toThrow();
    expect(() => addSkillFile(model, "../outside.txt")).toThrow();
  });
});

describe("Skill file packages", () => {
  it("round-trips all text, script and binary files without executing or truncating them", async () => {
    const original = bundle();
    original.files.push({ path: "references/guide.md", bytes: encodeText("指南\n") },
      { path: "scripts/check.py", bytes: encodeText("raise Exception('never execute')") },
      { path: "assets/a.bin", bytes: new Uint8Array([0, 255, 42, 13, 10]) });
    const imported = importSkillZip(exportSkillZip(original));
    expect(imported).toEqual(original);
    expect(validateSkillBundle(imported).filter((item) => item.severity === "error")).toEqual([]);
    expect(validateSkillBundle(imported).some((item) => item.code === "script_not_executable")).toBe(true);
    const prepared = await prepareSkillBundle(original);
    const map = new Map(prepared.blobs.map((item) => [item.id, item.bytes]));
    const restored = await readSkillBundle(prepared.spec, async (id) => map.get(id)!);
    expect(restored.files.map((file) => file.path)).toEqual(["SKILL.md", "assets/a.bin", "references/guide.md", "scripts/check.py"]);
    expect(prepared.spec.files[0].blobId).toBe(`sha256:${prepared.spec.files[0].sha256}`);
    expect(JSON.stringify(prepared.spec)).not.toContain("never execute");
  });
  it.each(["../escape", "/absolute", "C:/drive", "foo\\bar", "foo//bar", "foo/../bar", "CON.txt", "foo.", "a\0b"])("rejects unsafe path %s", (path) => {
    expect(validPackagePath(path)).toBe(false);
    expect(() => importSkillZip(zipSync({ "SKILL.md": encodeText(createSkillSource("test-skill")), [path]: encodeText("x") }))).toThrow();
  });
  it("rejects case collisions, file/directory collisions and oversized files", () => {
    for (const extra of [
      [{ path: "skill.md", bytes: encodeText("collision") }],
      [{ path: "assets", bytes: encodeText("x") }, { path: "assets/file.txt", bytes: encodeText("x") }],
      [{ path: "assets/huge.bin", bytes: new Uint8Array(2 * 1024 * 1024 + 1) }],
    ]) expect(() => assertPackageSafety({ ...bundle(), files: [...bundle().files, ...extra] })).toThrow();
  });
  it("allows repairable invalid YAML in a draft but still diagnoses missing standard content", async () => {
    const draft = bundleFromMarkdown("---\nname: [broken\n---\nbody");
    expect(validateSkillBundle(draft).some((item) => item.severity === "error")).toBe(true);
    await expect(prepareSkillBundle(draft)).resolves.toBeTruthy();
    expect(validateSkillBundle({ rootDirectory: "test-skill", files: [] }).some((item) => item.code === "entry_missing")).toBe(true);
  });
  it("rejects multiple roots and corrupt or forged ZIP metadata", () => {
    expect(() => importSkillZip(zipSync({ "a/SKILL.md": bundle().files[0].bytes, "b/SKILL.md": bundle().files[0].bytes }))).toThrow();
    expect(() => importSkillZip(new Uint8Array([1, 2]))).toThrow();
    const archive = exportSkillZip(bundle()); const view = new DataView(archive.buffer);
    let central = 0; while (view.getUint32(central, true) !== 0x02014b50) central++;
    view.setUint32(central + 24, 1, true);
    expect(() => importSkillZip(archive)).toThrow();
  });
  it.each(["symlink", "encrypted"])("rejects %s archives before decompression", (mode) => {
    const archive = exportSkillZip(bundle()); const view = new DataView(archive.buffer);
    let central = 0; while (view.getUint32(central, true) !== 0x02014b50) central++;
    if (mode === "symlink") view.setUint32(central + 38, 0xa000 << 16, true);
    else view.setUint16(central + 8, 1, true);
    expect(() => importSkillZip(archive)).toThrow();
  });
  it("verifies blob integrity and rejects unsafe roots on export", async () => {
    const prepared = await prepareSkillBundle(bundle());
    await expect(readSkillBundle(prepared.spec, async () => encodeText("tampered"))).rejects.toMatchObject({ code: "storage" });
    expect(() => exportSkillZip({ ...bundle(), rootDirectory: "../escape" })).toThrow();
    expect(decodeText(bundle().files[0].bytes)).toContain("name: test-skill");
  });
});
