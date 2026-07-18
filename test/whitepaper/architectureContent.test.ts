import { describe, expect, it } from "vitest";
import {
  architectureScenes,
  getSceneBreadcrumbs,
  sceneById,
} from "../../whitepaper/src/data/architecture";
import {
  containmentScenes,
  flattenContainmentLayers,
} from "../../whitepaper/src/data/containment";
import { integrationSteps } from "../../whitepaper/src/data/integration";

describe("whitepaper architecture content", () => {
  it("uses unique scene IDs and valid node/edge references", () => {
    expect(new Set(architectureScenes.map((scene) => scene.id)).size).toBe(
      architectureScenes.length,
    );

    architectureScenes.forEach((scene) => {
      const nodeIds = new Set(scene.nodes.map((node) => node.id));
      expect(nodeIds.size).toBe(scene.nodes.length);

      scene.edges.forEach((edge) => {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      });

      scene.nodes.forEach((node) => {
        if (node.childSceneId) {
          expect(sceneById.has(node.childSceneId)).toBe(true);
        }
      });
    });
  });

  it("documents every field and points at real source files", () => {
    architectureScenes.forEach((scene) => {
      scene.nodes.forEach((node) => {
        expect(node.responsibilities.length).toBeGreaterThan(0);
        expect(node.purpose.length).toBeGreaterThan(0);
        expect(node.sourceRefs.length).toBeGreaterThan(0);

        node.sourceRefs.forEach((source) => {
          expect(source.path.startsWith("src/")).toBe(true);
          expect(source.path.endsWith(".ts") || source.path.endsWith(".tsx")).toBe(true);
        });

        const fieldNames = node.fields?.map((field) => field.name) ?? [];
        expect(new Set(fieldNames).size).toBe(fieldNames.length);
        node.fields?.forEach((field) => {
          expect(field.type.length).toBeGreaterThan(0);
          expect(field.description.length).toBeGreaterThan(0);
          expect(field.owner.length).toBeGreaterThan(0);
        });
      });
    });
  });

  it("keeps integration links and breadcrumbs valid", () => {
    integrationSteps.forEach((step) => {
      const scene = sceneById.get(step.sceneId);
      expect(scene).toBeDefined();
      expect(scene?.nodes.some((node) => node.id === step.nodeId)).toBe(true);
    });

    architectureScenes.forEach((scene) => {
      const breadcrumbs = getSceneBreadcrumbs(scene.id);
      expect(breadcrumbs.at(-1)?.id).toBe(scene.id);
      expect(breadcrumbs[0]?.id).toBe("overview");
    });
  });

  it("uses a valid, unique containment tree for every architecture scene", () => {
    expect(containmentScenes.map((scene) => scene.sceneId)).toEqual(
      architectureScenes.map((scene) => scene.id),
    );

    containmentScenes.forEach((composition) => {
      expect(composition.problem.length).toBeGreaterThan(0);
      expect(composition.designReason.length).toBeGreaterThan(0);
      expect(composition.principles.length).toBeGreaterThan(0);

      const layers = flattenContainmentLayers(composition.root);
      expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length);

      layers.forEach((layer) => {
        expect(Boolean(layer.target) || Boolean(layer.rationale)).toBe(true);
        if (!layer.target) return;

        const targetScene = sceneById.get(layer.target.sceneId);
        expect(targetScene).toBeDefined();
        expect(
          targetScene?.nodes.some((node) => node.id === layer.target?.nodeId),
        ).toBe(true);
      });
    });
  });

  it("models the overview as nested Core components without Host Application", () => {
    const overview = containmentScenes.find(
      (scene) => scene.sceneId === "overview",
    );
    const titles = overview
      ? flattenContainmentLayers(overview.root).map((layer) => layer.title)
      : [];

    expect(titles).toContain("Runtime Engine");
    expect(titles).toContain("React View System");
    expect(titles).toContain("FrameSlot");
    expect(titles).toContain("Business Card");
    expect(titles).not.toContain("Host Application");
    expect(
      architectureScenes
        .flatMap((scene) => scene.nodes)
        .some((node) => node.id === "host-app" || node.title === "Host Application"),
    ).toBe(false);
  });
});
