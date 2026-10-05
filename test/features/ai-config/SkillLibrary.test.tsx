// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillLibrary } from "../../../src/features/ai-config/ui/SkillLibrary";
import { SkillWorkspace, createMemoryAiRepository } from "../../../src/features/ai-config";
import { exportSkillZip } from "../../../src/features/ai-config/adapters/skillPackage";
import { bundle } from "./fixtures";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const repository = createMemoryAiRepository(); const workspace = new SkillWorkspace(repository); await workspace.start();
  render(<StrictMode><SkillLibrary workspace={workspace} /></StrictMode>);
  await waitFor(() => expect((screen.getByLabelText("Skill 展示名称") as HTMLInputElement).value).toBe("发布风险检查"));
  return { workspace, repository };
}

describe("Skill file package editor", () => {
  it("filters by machine name without discarding the selected Skill's edits", async () => {
    await setup();
    fireEvent.change(screen.getByLabelText("Skill 工作流指令"), { target: { value: "keep my workflow" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skill" }), { target: { value: "release-risk" } });
    expect(screen.getByRole("button", { name: "发布风险检查" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Skill" }), { target: { value: "missing" } });
    expect(screen.queryByRole("button", { name: "发布风险检查" })).toBeNull();
    expect(screen.getByText("没有匹配的 Skill，试试其他关键词。")).toBeTruthy();
    expect((screen.getByLabelText("Skill 工作流指令") as HTMLTextAreaElement).value).toBe("keep my workflow");
  });

  it("separates version/settings operations while retaining edits and save actions", async () => {
    await setup();
    fireEvent.change(screen.getByLabelText("Skill 工作流指令"), { target: { value: "retained across panels" } });
    expect(screen.queryByRole("button", { name: "停用 Skill" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "版本与设置" }));
    expect(screen.queryByRole("textbox", { name: "Skill 工作流指令" })).toBeNull();
    expect((screen.getByRole("button", { name: "停用 Skill" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("Skill 包根目录")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText(/草稿已保存/);
    expect((screen.getByRole("button", { name: "停用 Skill" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "内容编辑" }));
    expect((screen.getByLabelText("Skill 工作流指令") as HTMLTextAreaElement).value).toBe("retained across panels");
  });

  it("saves drafts separately, publishes and reads immutable historical versions", async () => {
    const { workspace } = await setup();
    fireEvent.change(screen.getByLabelText("Skill 工作流指令"), { target: { value: "new revision content" } });
    fireEvent.change(screen.getByLabelText("新增文件路径"), { target: { value: "references/new.md" } });
    fireEvent.click(screen.getByRole("button", { name: "添加文本文件" }));
    fireEvent.change(screen.getByLabelText("references/new.md 源码"), { target: { value: "supporting content" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText(/草稿已保存/);
    expect(workspace.getSnapshot().published[0].revision).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "校验并发布" }));
    await screen.findByText(/已发布 v2；/);
    expect(workspace.getSnapshot().published[0].revision).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "版本与设置" }));
    fireEvent.click(screen.getByRole("button", { name: "查看 v1" }));
    await screen.findByRole("heading", { name: "发布版本 v1 · 只读" });
    expect(screen.getByLabelText("Skill 工作流指令").matches(":disabled")).toBe(true);
    expect((screen.getByLabelText("Skill 工作流指令") as HTMLTextAreaElement).value).not.toContain("new revision content");
    fireEvent.click(screen.getByRole("button", { name: "返回草稿" }));
    await waitFor(() => expect((screen.getByLabelText("Skill 工作流指令") as HTMLTextAreaElement).value).toBe("new revision content"));
  });
  it("allows repairable source drafts but does not publish them or lose source text", async () => {
    const { workspace } = await setup();
    fireEvent.click(screen.getByRole("tab", { name: "源码" }));
    const invalid = "---\nname: wrong-name\ndescription: test\ncustom: retained\n---\nworkflow";
    fireEvent.change(screen.getByLabelText("SKILL.md 源码"), { target: { value: invalid } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText(/草稿已保存/);
    fireEvent.click(screen.getByRole("button", { name: "校验并发布" }));
    expect(screen.getByRole("alert").textContent).toContain("请先修复校验错误");
    expect(workspace.getSnapshot().published[0].revision).toBe(1);
    expect((screen.getByLabelText("SKILL.md 源码") as HTMLTextAreaElement).value).toBe(invalid);
  });
  it("does not report saving success on persistence failure and retains edits", async () => {
    const { repository } = await setup();
    vi.spyOn(repository, "commit").mockRejectedValue(new Error("Quota exceeded"));
    fireEvent.change(screen.getByLabelText("Skill 工作流指令"), { target: { value: "keep these edits" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("Quota exceeded");
    expect(screen.queryByText(/草稿已保存/)).toBeNull();
    expect((screen.getByLabelText("Skill 工作流指令") as HTMLTextAreaElement).value).toBe("keep these edits");
    expect(screen.getByText("未保存修改")).toBeTruthy();
  });
  it("imports a ZIP as a new unpublished draft, keeping binary attachments", async () => {
    const { repository } = await setup();
    const original = bundle("imported-skill"); original.files.push({ path: "assets/data.bin", bytes: new Uint8Array([0, 255, 23]) });
    const zip = exportSkillZip(original);
    const file = new File([new Uint8Array(zip)], "skill.zip", { type: "application/zip" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => zip.buffer });
    fireEvent.change(screen.getByLabelText("导入 Skill 文件包"), { target: { files: [file] } });
    await screen.findByText(/文件包已载入编辑器/);
    fireEvent.click(screen.getByRole("button", { name: "assets/data.bin" }));
    expect(screen.getByText(/二进制附件 · 3 bytes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText(/草稿已保存/);
    const metadata = (await repository.list()).find((item) => item.slug === "imported-skill")!;
    expect(metadata.publishedRevision).toBeUndefined();
    const record = await repository.get(metadata.id);
    if (record.draft.spec.kind !== "skill") throw new Error();
    const binary = record.draft.spec.files.find((item) => item.path === "assets/data.bin")!;
    expect(await repository.getBlob(binary.blobId)).toEqual(new Uint8Array([0, 255, 23]));
  });
  it("exports the full package and removes disabled skills from the callable projection", async () => {
    const { workspace } = await setup();
    let downloaded: Blob | undefined;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob) => { downloaded = blob; return "blob:export"; }) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "导出 ZIP" }));
    expect(downloaded?.type).toBe("application/zip");
    // jsdom's Blob lacks arrayBuffer; the full adapter round-trip is independently verified.
    fireEvent.click(screen.getByRole("button", { name: "版本与设置" }));
    fireEvent.click(screen.getByRole("button", { name: "停用 Skill" }));
    await waitFor(() => expect(workspace.getSnapshot().published).toEqual([]));
    expect((await workspace.repository.get("release-skill")).revisions).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "启用 Skill" }));
    await waitFor(() => expect(workspace.getSnapshot().published).toHaveLength(1));
  });
});
