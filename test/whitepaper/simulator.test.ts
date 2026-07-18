import { describe, expect, it } from "vitest";
import { getRuntimeScenario } from "../../whitepaper/src/data/scenarios";
import { explainScenarioEvent } from "../../whitepaper/src/lib/explainScenarioEvent";
import { projectSimulatorGraph } from "../../whitepaper/src/lib/projectSimulatorGraph";
import { replayScenario } from "../../whitepaper/src/lib/simulator";

describe("whitepaper runtime simulator", () => {
  it("creates Turn and Branch topology before the first AI message", () => {
    const scenario = getRuntimeScenario("single-send");
    const topology = replayScenario(scenario, 1);

    expect(topology.turnId).toBe("turn-001");
    expect(Object.keys(topology.branches)).toEqual(["turn-001:main"]);
    expect(Object.keys(topology.assistantMessages)).toHaveLength(0);

    const graph = projectSimulatorGraph(topology);
    expect(graph.nodes.some((node) => node.id === "turn:turn-001")).toBe(true);
    expect(
      graph.nodes.some((node) => node.id === "branch:turn-001:main"),
    ).toBe(true);
  });

  it("updates one message node and only exposes content after frame flush", () => {
    const scenario = getRuntimeScenario("single-send");
    const sourceDelta = replayScenario(scenario, 4);
    const sourceMessage = sourceDelta.assistantMessages["assistant-turn-001"];

    expect(sourceMessage?.sourceRevision).toBe(1);
    expect(sourceMessage?.visibleRevision).toBe(0);
    expect(sourceDelta.projectedMessageIdsByBranchId["turn-001:main"]).toBeUndefined();

    const firstFlush = replayScenario(scenario, 5);
    const visibleMessage = firstFlush.assistantMessages["assistant-turn-001"];
    expect(visibleMessage?.visibleContent).toBe(visibleMessage?.sourceContent);
    expect(visibleMessage?.visibleRevision).toBe(1);

    const secondFlush = replayScenario(scenario, 7);
    expect(Object.keys(secondFlush.assistantMessages)).toEqual([
      "assistant-turn-001",
    ]);
    expect(secondFlush.assistantMessages["assistant-turn-001"]?.visibleRevision).toBe(2);
  });

  it("creates one Branch per selected Source in Compare mode", () => {
    const scenario = getRuntimeScenario("compare-send");
    const topology = replayScenario(scenario, 1);

    expect(Object.keys(topology.branches)).toEqual([
      "turn-compare-001:agent-a",
      "turn-compare-001:agent-b",
    ]);
  });

  it("projects Branch errors without inventing an Error Card", () => {
    const scenario = getRuntimeScenario("branch-error");
    const failed = replayScenario(scenario, 3);

    expect(failed.branches["turn-error-001:main"]?.status).toBe("error");
    expect(Object.keys(failed.assistantMessages)).toHaveLength(0);

    const settled = replayScenario(scenario, 4);
    expect(settled.runtimeStatus).toBe("error");
  });

  it("documents the atomic Turn/Branch commit fields and its design reason", () => {
    const scenario = getRuntimeScenario("single-send");
    const state = replayScenario(scenario, 1);
    const explanation = explainScenarioEvent(scenario.events[1], state);
    const fields = explanation.changes.flatMap((change) => change.fields).join("\n");

    expect(fields).toContain("inputMessageId");
    expect(fields).toContain("selectedBranchId");
    expect(fields).toContain("messageReader");
    expect(fields).toContain("AbortSignal");
    expect(fields).toContain("threadId, turnId, branchId, sourceId");
    expect(explanation.reasons.join("\n")).toContain("原子提交");
  });

  it("labels simulator revisions as explanatory and does not invent Message completion", () => {
    const scenario = getRuntimeScenario("single-send");
    const deltaState = replayScenario(scenario, 4);
    const delta = explainScenarioEvent(scenario.events[4], deltaState);
    expect(
      delta.changes.flatMap((change) => change.fields).join("\n"),
    ).toContain("不属于 Message schema");

    const completedState = replayScenario(scenario, 8);
    const completed = explainScenarioEvent(scenario.events[8], completedState);
    const completedFields = completed.changes
      .flatMap((change) => change.fields)
      .join("\n");
    expect(completedFields).toContain("由 Agent/message subtype 决定");
    expect(completedFields).not.toContain("Assistant Message.status: completed");
  });
});
