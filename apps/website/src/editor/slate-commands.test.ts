import { createEditor, Editor } from "slate";
import { beforeEach, describe, expect, test } from "vite-plus/test";

import { createParagraph } from "./markdown";
import {
  continueMarkdownList,
  handleEditorTab,
  insertMarkdownImage,
  insertMarkdownLink,
  normalizeCollapsedLinkSelection,
} from "./slate-commands";

function createTestEditor(text: string) {
  const editor = createEditor();
  editor.children = [createParagraph(text)];
  editor.selection = {
    anchor: { offset: 0, path: [0, 0] },
    focus: { offset: 0, path: [0, 0] },
  };
  return editor;
}

function setSelection(editor: Editor, anchorOffset: number, focusOffset = anchorOffset) {
  editor.selection = {
    anchor: { offset: anchorOffset, path: [0, 0] },
    focus: { offset: focusOffset, path: [0, 0] },
  };
}

function getParagraphTexts(editor: Editor) {
  return editor.children.map((_, index) => Editor.string(editor, [index]));
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      getSelection: () => ({ rangeCount: 0 }),
    },
  });
});

describe("slate commands", () => {
  test("normalizes collapsed selections at markdown link boundaries", () => {
    const editor = createTestEditor("[docs](https://example.com)");

    expect(
      normalizeCollapsedLinkSelection(editor, {
        anchor: { offset: 0, path: [0, 0] },
        focus: { offset: 0, path: [0, 0] },
      }),
    ).toEqual({
      anchor: { offset: 1, path: [0, 0] },
      focus: { offset: 1, path: [0, 0] },
    });

    expect(
      normalizeCollapsedLinkSelection(editor, {
        anchor: { offset: 6, path: [0, 0] },
        focus: { offset: 6, path: [0, 0] },
      }),
    ).toEqual({
      anchor: { offset: 27, path: [0, 0] },
      focus: { offset: 27, path: [0, 0] },
    });
  });

  test("does not treat image markdown as a navigable link boundary", () => {
    const editor = createTestEditor("![docs](https://example.com)");
    const selection = {
      anchor: { offset: 0, path: [0, 0] as number[] },
      focus: { offset: 0, path: [0, 0] as number[] },
    };

    expect(normalizeCollapsedLinkSelection(editor, selection)).toEqual(selection);
  });

  test("inserts markdown links from the selected text", () => {
    const editor = createTestEditor("Visit docs");
    setSelection(editor, 6, 10);

    insertMarkdownLink(editor, "https://example.com/docs", undefined, { syncSelection: false });

    expect(Editor.string(editor, [0])).toBe("Visit [docs](https://example.com/docs)");
  });

  test("inserts markdown images with an empty alt text", () => {
    const editor = createTestEditor("");

    insertMarkdownImage(editor, "https://example.com/no-alt.png", "", { syncSelection: false });

    expect(Editor.string(editor, [0])).toBe("![](https://example.com/no-alt.png)");
  });

  test.each([
    ["# Heading", "## Heading"],
    ["> Quote", "> > Quote"],
    ["- Item", "\t- Item"],
    ["1. Item", "\ta. Item"],
    ["\ta. Item", "\t\t1. Item"],
  ])("deepens markdown structure with Tab: %s", (initialText, expectedText) => {
    const editor = createTestEditor(initialText);

    expect(handleEditorTab(editor)).toBe(true);
    expect(Editor.string(editor, [0])).toBe(expectedText);
  });

  test.each([
    ["## Heading", "# Heading"],
    ["> > Quote", "> Quote"],
    ["\t- Item", "- Item"],
    ["\ta. Item", "1. Item"],
    ["\t\t1. Item", "\ta. Item"],
  ])("reverses markdown depth with Shift+Tab: %s", (initialText, expectedText) => {
    const editor = createTestEditor(initialText);

    expect(handleEditorTab(editor, true)).toBe(true);
    expect(Editor.string(editor, [0])).toBe(expectedText);
  });

  test.each([
    ["Plain text", 10, "Plain text\t"],
    ["# Heading", 9, "# Heading\t"],
    ["- Item", 6, "- Item\t"],
  ])("inserts a literal tab outside markdown prefixes: %s", (initialText, offset, expectedText) => {
    const editor = createTestEditor(initialText);
    setSelection(editor, offset);

    expect(handleEditorTab(editor)).toBe(true);
    expect(Editor.string(editor, [0])).toBe(expectedText);
  });

  test("Shift+Tab outside markdown prefixes leaves text unchanged", () => {
    const editor = createTestEditor("Plain text");
    setSelection(editor, 10);

    expect(handleEditorTab(editor, true)).toBe(true);
    expect(Editor.string(editor, [0])).toBe("Plain text");
  });

  test.each([
    ["- First", ["- First", "- "], 2],
    ["1. First", ["1. First", "2. "], 3],
    ["\ta. First", ["\ta. First", "\tb. "], 4],
  ])(
    "continues markdown list markers on Enter: %s",
    (initialText, expectedTexts, expectedOffset) => {
      const editor = createTestEditor(initialText);
      setSelection(editor, initialText.length);

      expect(continueMarkdownList(editor)).toBe(true);
      expect(getParagraphTexts(editor)).toEqual(expectedTexts);
      expect(editor.selection).toEqual({
        anchor: { offset: expectedOffset, path: [1, 0] },
        focus: { offset: expectedOffset, path: [1, 0] },
      });
    },
  );
});
