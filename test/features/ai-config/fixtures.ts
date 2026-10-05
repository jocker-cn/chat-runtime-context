import { createSkillSource } from "../../../src/features/ai-config/adapters/skillDocument";
import { encodeText, type SkillBundle } from "../../../src/features/ai-config/adapters/skillPackage";
import type { AgentSpec, McpSpec } from "../../../src/features/ai-config/domain/models";

export const bundle = (name = "test-skill", body = "# 工作流\n\n检查发布风险。\n"): SkillBundle => ({
  rootDirectory: name, files: [{ path: "SKILL.md", bytes: encodeText(createSkillSource(name, "检查发布风险。", body)) }],
});
export const details = (slug = "test-skill") => ({ displayName: "测试技能", slug, summary: "检查发布风险。", tags: [] });
export const mcpSpec = (): McpSpec => ({
  kind: "mcp", transport: { type: "streamable-http", url: "https://example.com/mcp", publicHeaders: {} },
  auth: { type: "none" }, protocol: { mode: "auto" }, limits: { requestTimeoutMs: 30000, maxResponseBytes: 1048576 },
});
export const agentSpec = (): AgentSpec => ({
  kind: "agent", instructions: "汇总风险。", model: { profileId: "default" }, skills: [], mcp: [], builtInCapabilityIds: [],
  output: { type: "text" }, execution: { maxSteps: 20, maxConcurrentToolCalls: 2, runTimeoutMs: 60000 }, policyProfileId: "default",
});
