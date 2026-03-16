import { describe, expect, test } from "vite-plus/test";

import { applyMarkdownTextEdits, buildMarkdownOutline } from "./contract.js";

describe("contract helpers", () => {
  test("applies sequential markdown edits", () => {
    const markdown = "# Title\n\nAlpha\nBeta\n";

    expect(
      applyMarkdownTextEdits(markdown, [
        {
          newText: "Intro\n",
          target: { text: "Alpha" },
          type: "insert_before",
        },
        {
          newText: "Gamma",
          target: { text: "Beta" },
          type: "replace",
        },
      ]),
    ).toBe("# Title\n\nIntro\nAlpha\nGamma\n");
  });

  test("requires occurrence when the target text is ambiguous", () => {
    expect(() =>
      applyMarkdownTextEdits("repeat\nrepeat\n", [
        {
          target: { text: "repeat" },
          type: "delete",
        },
      ]),
    ).toThrow("ambiguous");
  });

  test("builds a markdown outline with heading depth and line numbers", () => {
    expect(buildMarkdownOutline("# Title\n\n## First\nBody\n### Nested\n")).toEqual([
      { depth: 1, line: 1, text: "Title" },
      { depth: 2, line: 3, text: "First" },
      { depth: 3, line: 5, text: "Nested" },
    ]);
  });
});
