import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createMemoryAiRepository, type AiDefinitionRepository } from "../../../src/features/ai-config/data/repository";
import { createIndexedDbAiRepository } from "../../../src/features/ai-config/data/indexedDbRepository";
import { DefinitionService } from "../../../src/features/ai-config/controllers/definitionService";
import { SkillWorkspace } from "../../../src/features/ai-config/controllers/skillWorkspace";
import { validateDefinitionRecord, validateDefinitionSpec } from "../../../src/features/ai-config/domain/validation";
import { encodeText, prepareSkillBundle } from "../../../src/features/ai-config/adapters/skillPackage";
import { agentSpec, bundle, details, mcpSpec } from "./fixtures";

describe("Agent / MCP formal schemas", () => {
  it("accepts explicit model, capability, transport and authentication contracts", () => {
    expect(validateDefinitionSpec("agent", agentSpec())).toEqual([]);
    expect(validateDefinitionSpec("mcp", mcpSpec())).toEqual([]);
    const stdio = { ...mcpSpec(), transport: { type: "stdio", runnerProfileId: "local", command: "runner", args: ["--tag", "x", "--tag", "y"], publicEnv: {} } };
    expect(validateDefinitionSpec("mcp", stdio)).toEqual([]);
  });
  it("rejects secrets, unsupported properties and mismatched auth transports", () => {
    for (const value of [
      { ...mcpSpec(), apiKey: "must-not-store" },
      { ...mcpSpec(), transport: { ...mcpSpec().transport, url: "http://user:password@example.com" } },
      { ...mcpSpec(), transport: { ...mcpSpec().transport, publicHeaders: { Authorization: "must-not-store" } } },
      { ...mcpSpec(), auth: { type: "static-secret", delivery: { type: "env", name: "TOKEN" } } },
    ]) expect(validateDefinitionSpec("mcp", value).some((item) => item.severity === "error")).toBe(true);
    expect(validateDefinitionSpec("agent", { ...agentSpec(), model: { profileId: "default", apiKey: "secret" } })).not.toEqual([]);
  });
  it("bounds schemas and reports external references / duplicate bindings", () => {
    expect(validateDefinitionSpec("agent", { ...agentSpec(), inputSchema: { $ref: "https://example.com/schema" } })).not.toEqual([]);
    expect(validateDefinitionSpec("agent", { ...agentSpec(), inputSchema: { description: "x".repeat(70000) } })).not.toEqual([]);
    const ref = { skill: { id: "skill", revision: 1 }, mode: "available", required: true };
    expect(validateDefinitionSpec("agent", { ...agentSpec(), skills: [ref, ref] })).not.toEqual([]);
    expect(validateDefinitionRecord({ format: "old-poc", version: 1 })).not.toEqual([]);
  });
});

for (const [name, factory] of [
  ["memory", () => createMemoryAiRepository()],
  ["IndexedDB", () => createIndexedDbAiRepository(`test-${crypto.randomUUID()}`)],
] as const) describe(`${name} repository, drafts and immutable publishing`, () => {
  it("stores blobs separately, saves invalid source drafts and blocks invalid publishing", async () => {
    const repo = factory(); const service = new DefinitionService(repo); const prepared = await prepareSkillBundle(bundle());
    const draft = await service.save(details(), prepared.spec, undefined, prepared.blobs);
    expect(draft.meta.publishedRevision).toBeUndefined();
    const published = await service.publish(draft);
    expect(published.meta.publishedRevision).toBe(1);
    const bad = { ...bundle(), files: [{ path: "SKILL.md", bytes: encodeText("---\nname: wrong\n---\nbody") }] };
    const broken = await prepareSkillBundle(bad);
    const saved = await service.save(details(), broken.spec, published, broken.blobs);
    await expect(service.publish(saved)).rejects.toMatchObject({ code: "validation" });
    expect((await repo.get(saved.meta.id)).revisions[0]).toEqual(published.revisions[0]);
    expect(await repo.getBlob(prepared.spec.files[0].blobId)).toEqual(prepared.blobs[0].bytes);
    repo.close();
  });
  it("rejects stale ETags, duplicate names and published revision changes without partial writes", async () => {
    const repo = factory(); const service = new DefinitionService(repo); const prepared = await prepareSkillBundle(bundle());
    const first = await service.save(details(), prepared.spec, undefined, prepared.blobs);
    const published = await service.publish(first);
    await expect(service.save(details(), prepared.spec, first)).rejects.toMatchObject({ code: "conflict" });
    await expect(service.save(details(), prepared.spec)).rejects.toMatchObject({ code: "conflict" });
    const changed = structuredClone(published); changed.meta.etag = crypto.randomUUID(); changed.revisions[0].spec = { ...agentSpec() };
    await expect(repo.commit(changed, published.meta.etag)).rejects.toMatchObject({ code: "validation" });
    const tampered = structuredClone(published); tampered.meta.etag = crypto.randomUUID();
    tampered.revisions[0].publishedBy = "different-owner";
    await expect(repo.commit(tampered, published.meta.etag)).rejects.toMatchObject({ code: "conflict" });
    await expect(repo.commit({ ...published, meta: { ...published.meta, etag: crypto.randomUUID() } }, published.meta.etag,
      [{ id: prepared.spec.files[0].blobId, bytes: encodeText("tampered") }])).rejects.toMatchObject({ code: "validation" });
    expect((await repo.get(first.meta.id)).meta.etag).toBe(published.meta.etag);
    repo.close();
  });
  it("keeps fixed revisions while publishing, disabling and archiving", async () => {
    const repo = factory(); const workspace = new SkillWorkspace(repo); await workspace.start();
    const first = await repo.get("release-skill");
    const next = await workspace.save({ ...details(first.meta.slug), displayName: first.meta.displayName }, bundle(first.meta.slug, "new workflow"), first);
    const second = await workspace.publish(next);
    expect(await workspace.publishedSource({ id: first.meta.id, revision: 1 })).not.toContain("new workflow");
    expect(await workspace.publishedSource({ id: first.meta.id, revision: 2 })).toBe("new workflow");
    const disabled = await workspace.service.setEnabled(second, false); await workspace.refresh();
    expect(workspace.getSnapshot().published).toEqual([]);
    await expect(workspace.publishedSource({ id: first.meta.id, revision: 1 })).rejects.toMatchObject({ code: "dependency" });
    const archived = await workspace.service.archive(disabled); await workspace.refresh();
    expect(workspace.getSnapshot().definitions).toEqual([]);
    expect((await repo.get(first.meta.id)).revisions).toHaveLength(2);
    await expect(workspace.service.publish(archived)).rejects.toMatchObject({ code: "validation" });
    repo.close();
  });
  it("requires published, enabled dependencies when publishing an Agent", async () => {
    const repo = factory(); const service = new DefinitionService(repo);
    const agent = agentSpec(); agent.skills.push({ skill: { id: "missing", revision: 1 }, mode: "available", required: true });
    const draft = await service.save(details("agent"), agent);
    await expect(service.publish(draft)).rejects.toMatchObject({ issues: [{ code: "dependency_unavailable" }] });
    repo.close();
  });
});

describe("IndexedDB lifecycle and atomic conflicts", () => {
  it("survives closing/reopening and isolates immutable blobs from returned objects", async () => {
    const name = `test-${crypto.randomUUID()}`; const first = createIndexedDbAiRepository(name); const workspace = new SkillWorkspace(first);
    await workspace.start(); expect(workspace.getSnapshot().status).toBe("ready");
    first.close();
    const next = createIndexedDbAiRepository(name);
    const record = await next.get("release-skill");
    expect(record.meta.publishedRevision).toBe(1);
    expect(record).not.toHaveProperty("identity");
    if (record.draft.spec.kind !== "skill") throw new Error();
    const blob = await next.getBlob(record.draft.spec.files[0].blobId); const oldByte = blob[0]; blob[0] = 0;
    expect((await next.getBlob(record.draft.spec.files[0].blobId))[0]).toBe(oldByte);
    next.close();
  });
  it("allows exactly one of two competing writes", async () => {
    const name = `test-${crypto.randomUUID()}`; const a = createIndexedDbAiRepository(name); const b = createIndexedDbAiRepository(name);
    const workspace = new SkillWorkspace(a); await workspace.start(); const initial = await a.get("release-skill");
    const serviceA = new DefinitionService(a); const serviceB = new DefinitionService(b);
    const results = await Promise.allSettled([
      serviceA.save({ ...details(initial.meta.slug), displayName: "writer A" }, initial.draft.spec, initial),
      serviceB.save({ ...details(initial.meta.slug), displayName: "writer B" }, initial.draft.spec, initial),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
    a.close(); b.close();
  });
  it("reports persistence failure without changing the workspace to a ready empty catalog", async () => {
    const repo = createMemoryAiRepository();
    const failing: AiDefinitionRepository = { ...repo, commit: async () => { throw new Error("QuotaExceededError"); } };
    const workspace = new SkillWorkspace(failing); await workspace.start();
    expect(workspace.getSnapshot()).toMatchObject({ status: "error", error: "QuotaExceededError" });
  });
});
