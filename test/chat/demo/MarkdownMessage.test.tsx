/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("renders a two-by-two table with working actions and external links", () => {
    render(
      <MarkdownMessage
        content={`| [生成检查单](#action:checklist) | [查看回滚方案](#action:rollback) |
| --- | --- |
| [AG-UI 文档](https://docs.ag-ui.com/) | [React 文档](https://react.dev/) |`}
        actions={[
          { id: "checklist", label: "生成检查单", result: "检查单已生成。" },
          { id: "rollback", label: "查看回滚方案", result: "停止扩量，回退版本。" },
        ]}
      />,
    );

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(row.children).toHaveLength(2));

    fireEvent.click(within(table).getByRole("button", { name: "生成检查单" }));
    expect(screen.getByRole("status").textContent).toBe("检查单已生成。");
    fireEvent.click(within(table).getByRole("button", { name: "查看回滚方案" }));
    expect(screen.getByRole("status").textContent).toBe("停止扩量，回退版本。");

    const links = within(table).getAllByRole("link");
    expect(links).toHaveLength(2);
    links.forEach((link) => {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    });
  });

  it("does not turn unregistered action links into buttons", () => {
    render(<MarkdownMessage content="[Unknown](#action:unknown)" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("#action:unknown");
  });
});
