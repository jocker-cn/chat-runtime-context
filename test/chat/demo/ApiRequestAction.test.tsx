/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestAction } from "../../../src/chat/demo/ApiRequestAction";

afterEach(cleanup);

describe("ApiRequestAction", () => {
  it("requests and renders an API response when the card mounts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: 1, title: "Test API result" }),
    } as Response);

    render(<ApiRequestAction endpoint="/api/demo" fetcher={fetcher} />);

    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(await screen.findByText(/Test API result/)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/demo",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
