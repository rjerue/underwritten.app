import { describe, expect, test } from "vite-plus/test";

import { getCodeLanguageLabel, normalizeCodeLanguage, tokenizeCode } from "./code-block-editor";

describe("code block helpers", () => {
  test("normalizes known language aliases and plain-text inputs", () => {
    expect(normalizeCodeLanguage("TypeScript")).toBe("tsx");
    expect(normalizeCodeLanguage("plant uml")).toBe("plantuml");
    expect(normalizeCodeLanguage("txt")).toBeNull();
    expect(normalizeCodeLanguage("  brainfuck  ")).toBe("brainfuck");
  });

  test("resolves code language labels for aliases and unknown values", () => {
    expect(getCodeLanguageLabel("py")).toBe("Python");
    expect(getCodeLanguageLabel("plantuml")).toBe("PlantUML");
    expect(getCodeLanguageLabel("brainfuck")).toBe("brainfuck");
    expect(getCodeLanguageLabel(null)).toBe("Plain Text");
  });

  test("tokenizes JavaScript code with highlight classes", () => {
    expect(tokenizeCode("const answer = 42; // comment", "jsx")).toEqual([
      { className: "text-sky-700 dark:text-sky-300", value: "const" },
      { value: " answer = " },
      { className: "text-amber-700 dark:text-amber-300", value: "42" },
      { value: "; " },
      { className: "text-slate-500 italic dark:text-slate-400", value: "// comment" },
    ]);
  });

  test("returns a single plain token when no highlighter matches", () => {
    expect(tokenizeCode("some custom syntax", "brainfuck")).toEqual([
      { value: "some custom syntax" },
    ]);
  });
});
