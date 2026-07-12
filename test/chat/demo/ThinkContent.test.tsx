/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinkContent } from "../../../src/chat/demo/ThinkContent";

afterEach(cleanup);

describe("ThinkContent accessibility", () => {
  it("announces the processing title without making streamed content live", () => {
    render(<ThinkContent title="Processing" phase="processing" />);

    const card = screen.getByRole("article", { name: "Processing" });
    const status = screen.getByRole("status");

    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(card.hasAttribute("aria-describedby")).toBe(false);
    expect(card.hasAttribute("aria-live")).toBe(false);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
  });

  it("uses visible completed thinking as the card description", () => {
    render(
      <ThinkContent title="How AI Think" phase="completed">
        Compared rollback readiness and metrics.
      </ThinkContent>,
    );

    const card = screen.getByRole("article", { name: "How AI Think" });
    const descriptionId = card.getAttribute("aria-describedby");

    expect(card.getAttribute("aria-busy")).toBe("false");
    expect(descriptionId).not.toBeNull();
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      "Compared rollback readiness and metrics.",
    );
  });
});
