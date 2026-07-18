import { useSyncExternalStore } from "react";
import type { ScenarioId, WhitepaperSection } from "../data/model";

export type WhitepaperRoute =
  | {
      section: "architecture";
      sceneId: string;
      nodeId?: string;
    }
  | {
      section: "lifecycle";
      scenarioId: ScenarioId;
      eventIndex: number;
    }
  | {
      section: "integration";
      stepId?: string;
    };

const defaultRoute: WhitepaperRoute = {
  section: "architecture",
  sceneId: "overview",
};

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function getHashSnapshot() {
  return window.location.hash;
}

export function useWhitepaperRoute(): WhitepaperRoute {
  const hash = useSyncExternalStore(subscribe, getHashSnapshot, () => "");
  return parseRoute(hash);
}

export function parseRoute(hash: string): WhitepaperRoute {
  const normalized = hash.replace(/^#\/?/, "");
  const [section, first, second] = normalized.split("/").filter(Boolean);

  if (section === "lifecycle") {
    const eventIndex = Number(second);
    return {
      section: "lifecycle",
      scenarioId: isScenarioId(first) ? first : "single-send",
      eventIndex: Number.isInteger(eventIndex) ? Math.max(-1, eventIndex) : -1,
    };
  }

  if (section === "integration") {
    return {
      section: "integration",
      stepId: first,
    };
  }

  if (section === "architecture") {
    return {
      section: "architecture",
      sceneId: first || "overview",
      nodeId: second,
    };
  }

  return defaultRoute;
}

export function navigateToArchitecture(sceneId: string, nodeId?: string) {
  setHash(["architecture", sceneId, nodeId].filter(Boolean).join("/"));
}

export function navigateToLifecycle(
  scenarioId: ScenarioId,
  eventIndex = -1,
) {
  setHash(`lifecycle/${scenarioId}/${eventIndex}`);
}

export function navigateToIntegration(stepId?: string) {
  setHash(["integration", stepId].filter(Boolean).join("/"));
}

export function navigateToSection(section: WhitepaperSection) {
  if (section === "architecture") navigateToArchitecture("overview");
  if (section === "lifecycle") navigateToLifecycle("single-send");
  if (section === "integration") navigateToIntegration();
}

function setHash(path: string) {
  window.location.hash = `#/${path}`;
}

function isScenarioId(value: string | undefined): value is ScenarioId {
  return value === "single-send" || value === "compare-send" || value === "branch-error";
}
