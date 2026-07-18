import { describe, expect, it } from "vitest";
import { parseRoute } from "../../whitepaper/src/lib/hashRoute";

describe("whitepaper hash route", () => {
  it("parses architecture deep links", () => {
    expect(parseRoute("#/architecture/rendering/frame-slot")).toEqual({
      section: "architecture",
      sceneId: "rendering",
      nodeId: "frame-slot",
    });
  });

  it("parses deterministic lifecycle steps", () => {
    expect(parseRoute("#/lifecycle/compare-send/5")).toEqual({
      section: "lifecycle",
      scenarioId: "compare-send",
      eventIndex: 5,
    });
  });

  it("falls back to the overview", () => {
    expect(parseRoute("")).toEqual({
      section: "architecture",
      sceneId: "overview",
    });
  });
});
