import { describe, expect, test } from "vite-plus/test";

import {
  createParagraph,
  getNodeText,
  parseMarkdownDocument,
  serializeMarkdown,
  serializeMarkdownFragment,
} from "./markdown";

describe("markdown document helpers", () => {
  test("parses fenced code blocks into embedded code block placeholders", () => {
    const draft = parseMarkdownDocument('before\n```jsx\nconsole.log("yo")\n```\nafter');

    expect(draft.codeBlocks).toEqual([
      {
        code: 'console.log("yo")',
        id: "code-block-import-1",
        language: "jsx",
        position: 0,
      },
    ]);
    expect(draft.value.map(getNodeText)).toEqual([
      "before",
      "[CODEBLOCK:code-block-import-1]",
      "after",
    ]);
  });

  test("parses markdown tables into embedded table placeholders", () => {
    const draft = parseMarkdownDocument("| Name | Role |\n| --- | --- |\n| Ada | Writer |");

    expect(draft.tables).toEqual([
      {
        data: [
          ["Name", "Role"],
          ["Ada", "Writer"],
        ],
        id: "table-import-1",
        position: 0,
      },
    ]);
    expect(draft.value.map(getNodeText)).toEqual(["[TABLE:table-import-1]", ""]);
  });

  test("serializes a trailing fenced code block with a trailing newline", () => {
    expect(
      serializeMarkdown(
        [createParagraph("[CODEBLOCK:code-block-1]")],
        [],
        [
          {
            code: "graph TD\nA[Start] --> B[Finish]",
            id: "code-block-1",
            language: "mermaid",
            position: 0,
          },
        ],
      ),
    ).toBe("```mermaid\ngraph TD\nA[Start] --> B[Finish]\n```\n");
  });

  test("serializes embedded block fragments without appending a trailing blank paragraph", () => {
    expect(
      serializeMarkdownFragment(
        [createParagraph("[TABLE:table-1]"), createParagraph("[CODEBLOCK:code-block-1]")],
        [
          {
            data: [
              ["Mode", "Best for"],
              ["write", "Drafting"],
            ],
            id: "table-1",
            position: 0,
          },
        ],
        [
          {
            code: "flowchart LR\nA --> B",
            id: "code-block-1",
            language: "mermaid",
            position: 0,
          },
        ],
      ),
    ).toBe(
      "| Mode | Best for |\n| --- | --- |\n| write | Drafting |\n```mermaid\nflowchart LR\nA --> B\n```",
    );
  });
});
