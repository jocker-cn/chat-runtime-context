import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("neutral workbench theme tokens", () => {
  it("centralizes colors and resolves every semantic token used by workbench components", () => {
    const definitions = readFileSync("src/theme/tokens.css", "utf8");
    const tokens = new Set([...definitions.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    for (const path of [
      "src/chat/demo/extension-poc/ExtensionPocPage.module.css",
      "src/chat/demo/extension-poc/extensionToolMenu.module.css",
      "src/features/ai-config/ui/SkillLibrary.module.css",
      "src/features/ai-config/ui/DefinitionManager.module.css",
      "src/core/tools/ToolList.module.css",
      "src/core/tools/ToolMenu.module.css",
      "src/core/tools/ToolPresentation.module.css",
    ]) {
      const style = readFileSync(path, "utf8");
      expect(style, path).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
      expect(style, path).not.toMatch(/font-(?:size|weight):\s*[.\d]+(?:px|em|\b)/);
      expect(style, path).not.toMatch(/(?:^|[;{}])\s*(?:gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?):\s*-?\d+px/m);
      for (const match of style.matchAll(/var\((--[\w-]+)/g)) expect(tokens.has(match[1]), `${path}: ${match[1]}`).toBe(true);
    }
  });
});
