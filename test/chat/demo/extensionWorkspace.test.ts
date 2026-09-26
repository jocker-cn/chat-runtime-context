import { describe, expect, it } from "vitest";
import {
  createExtensionDraft,
  type ExtensionCatalog,
} from "../../../src/chat/demo/extension-poc/extensionModel";
import { ExtensionWorkspace } from "../../../src/chat/demo/extension-poc/extensionWorkspace";

describe("ExtensionWorkspace", () => {
  it("uses typed POJOs for slash choices and agent references", () => {
    let stored: ExtensionCatalog = { version: 1, items: [] };
    const workspace = new ExtensionWorkspace({
      load: () => stored,
      save: (catalog) => { stored = catalog; },
    });
    const skill = workspace.save({
      ...createExtensionDraft("skill"),
      kind: "skill",
      name: "发布检查",
      description: "发布风险",
      instructions: "检查回滚方案",
    });
    const mcp = workspace.save({
      ...createExtensionDraft("mcp"),
      kind: "mcp",
      name: "发布工具",
      endpoint: "https://example.com/mcp",
    });
    const agent = workspace.save({
      ...createExtensionDraft("agent"),
      kind: "agent",
      name: "发布助手",
      prompt: "先核对事实",
      skillIds: [skill.id],
      mcpIds: [mcp.id],
      pluginIds: [],
    });

    expect(workspace.choices("发布").map((item) => item.kind)).toEqual([
      "skill", "mcp", "agent",
    ]);
    expect(workspace.buildInvocation(agent.id, "检查今晚发布")).toEqual({
      target: { kind: "agent", id: agent.id },
      message: "检查今晚发布",
      agent: {
        prompt: "先核对事实",
        skillIds: [skill.id],
        mcpIds: [mcp.id],
        pluginIds: [],
      },
    });

    workspace.remove(skill.id);
    expect(workspace.buildInvocation(agent.id, "再次检查").agent?.skillIds).toEqual([]);
    workspace.save({ ...mcp, enabled: false });
    expect(workspace.choices("工具")).toEqual([]);
    expect(workspace.buildInvocation(agent.id, "再次检查").agent?.mcpIds).toEqual([]);
  });
});
