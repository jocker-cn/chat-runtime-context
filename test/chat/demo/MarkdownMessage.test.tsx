/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownMessage } from "../../../src/chat/demo/MarkdownMessage";

afterEach(cleanup);

describe("MarkdownMessage", () => {
  it("renders GFM content and safe external links", () => {
    render(
      <MarkdownMessage
        content={`## Release report

> Review the blocking items first.

| Risk | Status |
| --- | --- |
| Rollback | Pending |
| Metrics | Ready |

- [x] Build
- [ ] Rollback drill

[AG-UI docs](https://docs.ag-ui.com/)

\`inline-code\`

\`\`\`bash
pnpm release:check
\`\`\``}
      />,
    );

    expect(screen.getByRole("heading", { name: "Release report" })).toBeTruthy();
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("inline-code").tagName).toBe("CODE");
    expect(screen.getByText("pnpm release:check").tagName).toBe("CODE");

    const link = screen.getByRole("link", { name: "AG-UI docs" });
    expect(link.getAttribute("href")).toBe("https://docs.ag-ui.com/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("renders structured message actions as working buttons", () => {
    render(
      <MarkdownMessage
        content="Select an operation."
        actions={[
          {
            id: "check",
            label: "Run check",
            result: "Check started.",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run check" }));

    expect(screen.getByRole("status").textContent).toBe("Check started.");
  });
});
