// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PendoProvider, usePendo } from "../../../src/features/pendo";
import { acquirePendo } from "../../../src/features/pendo/client";

describe("Pendo without browser globals", () => {
  it("can import and server-render the provider without loading the SDK", () => {
    const config = { enabled: true, publicAppId: "8c19687f-cf16-4f3c-9f9b-4ab8e9350c5c" };
    function Child() { usePendo(); return <span>Business content</span>; }
    expect(renderToString(<PendoProvider {...config}><Child/></PendoProvider>)).toBe("<span>Business content</span>");
    expect(acquirePendo(config)).toBeUndefined();
  });
});
