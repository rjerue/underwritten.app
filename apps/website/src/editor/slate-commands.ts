import type { Descendant } from "slate";
import { Editor, Node, Path, Range, Transforms } from "slate";
import { ReactEditor } from "slate-react";

import {
  createParagraph,
  getNodeText,
  isEmbeddedBlockPlaceholder,
  isParagraphNode,
} from "./markdown";

const linkPreviewSelector =
  "[data-link-preview-path][data-link-preview-start][data-link-preview-end]";

export function normalizeCollapsedLinkSelection(editor: Editor, selection: Range) {
  if (!Range.isCollapsed(selection)) {
    return selection;
  }

  const focusPoint = selection.focus;
  if (!Node.has(editor, focusPoint.path)) {
    return selection;
  }

  const textNode = Node.get(editor, focusPoint.path);
  if (typeof textNode !== "object" || !("text" in textNode) || typeof textNode.text !== "string") {
    return selection;
  }

  const text = textNode.text;
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    if (text[match.index - 1] === "!") {
      continue;
    }

    const label = match[1] ?? "";
    const matchStartOffset = match.index;
    const labelStartOffset = matchStartOffset + 1;
    const labelEndOffset = labelStartOffset + label.length;
    const matchEndOffset = matchStartOffset + match[0].length;

    if (focusPoint.offset >= matchStartOffset && focusPoint.offset < labelStartOffset) {
      return {
        anchor: {
          offset: labelStartOffset,
          path: focusPoint.path,
        },
        focus: {
          offset: labelStartOffset,
          path: focusPoint.path,
        },
      };
    }

    if (focusPoint.offset > labelEndOffset && focusPoint.offset <= matchEndOffset) {
      return {
        anchor: {
          offset: matchEndOffset,
          path: focusPoint.path,
        },
        focus: {
          offset: matchEndOffset,
          path: focusPoint.path,
        },
      };
    }
  }

  return selection;
}

function getClosestLinkPreviewElement(node: globalThis.Node | null) {
  if (!node) return null;

  const element = node instanceof HTMLElement ? node : node.parentElement;
  if (!element) return null;

  return element.closest(linkPreviewSelector);
}

function findPreviewInNode(node: globalThis.Node | null, direction: "previous" | "next") {
  if (!node) return null;

  const previewElement = getClosestLinkPreviewElement(node);
  if (previewElement instanceof HTMLElement) {
    return previewElement;
  }

  if (!(node instanceof HTMLElement)) {
    return null;
  }

  if (node.matches(linkPreviewSelector)) {
    return node;
  }

  const previewElements = node.querySelectorAll<HTMLElement>(linkPreviewSelector);
  if (previewElements.length === 0) {
    return null;
  }

  return direction === "previous"
    ? (previewElements[previewElements.length - 1] ?? null)
    : (previewElements[0] ?? null);
}

function isHiddenMarkdownElement(node: globalThis.Node | null) {
  return node instanceof HTMLElement && node.getAttribute("aria-hidden") !== null;
}

function findAdjacentPreview(
  root: HTMLElement,
  startNode: globalThis.Node | null,
  direction: "previous" | "next",
) {
  let currentNode: globalThis.Node | null = startNode;

  while (currentNode && currentNode !== root) {
    let sibling = direction === "previous" ? currentNode.previousSibling : currentNode.nextSibling;

    while (sibling) {
      const previewElement = findPreviewInNode(sibling, direction);
      if (previewElement instanceof HTMLElement) {
        return previewElement;
      }

      if (!isHiddenMarkdownElement(sibling)) {
        break;
      }

      sibling = direction === "previous" ? sibling.previousSibling : sibling.nextSibling;
    }

    currentNode = currentNode.parentNode;
  }

  return null;
}

function getLinkBoundarySelection(editor: Editor, domSelection: Selection) {
  if (!domSelection.isCollapsed) {
    return null;
  }

  const anchorNode = domSelection.anchorNode;
  if (!anchorNode) {
    return null;
  }

  const editorElement = ReactEditor.toDOMNode(editor, editor);
  if (!(editorElement instanceof HTMLElement) || !editorElement.contains(anchorNode)) {
    return null;
  }

  if (getClosestLinkPreviewElement(anchorNode)) {
    return null;
  }

  let targetPreview: HTMLElement | null = null;
  let targetOffsetAttribute: "data-link-preview-end" | "data-link-preview-start" | null = null;

  if (anchorNode.nodeType === window.Node.TEXT_NODE) {
    const textLength = anchorNode.textContent?.length ?? 0;

    if (domSelection.anchorOffset === 0) {
      targetPreview = findAdjacentPreview(editorElement, anchorNode, "previous");
      targetOffsetAttribute = "data-link-preview-end";
    } else if (domSelection.anchorOffset === textLength) {
      targetPreview = findAdjacentPreview(editorElement, anchorNode, "next");
      targetOffsetAttribute = "data-link-preview-start";
    }
  } else if (anchorNode instanceof HTMLElement) {
    const previousNode =
      domSelection.anchorOffset > 0 ? anchorNode.childNodes[domSelection.anchorOffset - 1] : null;
    const nextNode =
      domSelection.anchorOffset < anchorNode.childNodes.length
        ? anchorNode.childNodes[domSelection.anchorOffset]
        : null;

    if (previousNode) {
      targetPreview =
        findPreviewInNode(previousNode, "previous") ??
        findAdjacentPreview(editorElement, previousNode, "previous");
      targetOffsetAttribute = "data-link-preview-end";
    }

    if (!targetPreview && nextNode) {
      targetPreview =
        findPreviewInNode(nextNode, "next") ?? findAdjacentPreview(editorElement, nextNode, "next");
      targetOffsetAttribute = "data-link-preview-start";
    }
  }

  if (!targetPreview || !targetOffsetAttribute) {
    return null;
  }

  const pathText = targetPreview.getAttribute("data-link-preview-path");
  const offsetText = targetPreview.getAttribute(targetOffsetAttribute);
  if (!pathText || !offsetText) {
    return null;
  }

  const path = pathText.split(".").map((segment) => Number.parseInt(segment, 10));
  const offset = Number.parseInt(offsetText, 10);

  if (path.some((segment) => Number.isNaN(segment)) || Number.isNaN(offset)) {
    return null;
  }

  return {
    anchor: { offset, path },
    focus: { offset, path },
  } satisfies Range;
}

function getDomLinkPreviewEdgeSelection(domSelection: Selection) {
  if (!domSelection.isCollapsed) {
    return null;
  }

  const anchorNode = domSelection.anchorNode;
  if (anchorNode?.nodeType !== window.Node.TEXT_NODE) {
    return null;
  }

  const previewElement = anchorNode.parentElement?.closest(linkPreviewSelector);
  if (!(previewElement instanceof HTMLElement)) {
    return null;
  }

  const pathText = previewElement.getAttribute("data-link-preview-path");
  const startOffsetText = previewElement.getAttribute("data-link-preview-start");
  const endOffsetText = previewElement.getAttribute("data-link-preview-end");
  if (!pathText || !startOffsetText || !endOffsetText) {
    return null;
  }

  const path = pathText.split(".").map((segment) => Number.parseInt(segment, 10));
  const startOffset = Number.parseInt(startOffsetText, 10);
  const endOffset = Number.parseInt(endOffsetText, 10);
  if (
    path.some((segment) => Number.isNaN(segment)) ||
    Number.isNaN(startOffset) ||
    Number.isNaN(endOffset)
  ) {
    return null;
  }

  const textLength = anchorNode.textContent?.length ?? 0;
  if (domSelection.anchorOffset !== 0 && domSelection.anchorOffset !== textLength) {
    return null;
  }

  return {
    edge: domSelection.anchorOffset === 0 ? "start" : "end",
    endOffset,
    path,
    startOffset,
  } as const;
}

function getPreservedLinkEdgeSelection(editor: Editor, domSelection: Selection) {
  const edgeSelection = getDomLinkPreviewEdgeSelection(domSelection);
  if (!edgeSelection || !editor.selection || !Range.isCollapsed(editor.selection)) {
    return null;
  }

  if (
    !Path.equals(editor.selection.anchor.path, edgeSelection.path) ||
    !Path.equals(editor.selection.focus.path, edgeSelection.path)
  ) {
    return null;
  }

  if (
    edgeSelection.edge === "start" &&
    editor.selection.focus.offset === edgeSelection.startOffset
  ) {
    return editor.selection;
  }

  if (edgeSelection.edge === "end" && editor.selection.focus.offset === edgeSelection.endOffset) {
    return editor.selection;
  }

  return null;
}

function syncDomSelectionToEditorSelection(editor: Editor, selection: Range) {
  try {
    const domRange = ReactEditor.toDOMRange(editor, selection);
    const domSelection = window.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(domRange);
  } catch {
    // Ignore DOM sync failures while the editor is reconciling decorations.
  }
}

export function syncEditorSelectionFromDom(editor: Editor) {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) return;

  const boundarySelection = getLinkBoundarySelection(editor, domSelection);
  if (boundarySelection) {
    Transforms.select(editor, boundarySelection);
    syncDomSelectionToEditorSelection(editor, boundarySelection);
    return;
  }

  const previewEdgeSelection = getDomLinkPreviewEdgeSelection(domSelection);
  if (previewEdgeSelection) {
    const offset =
      previewEdgeSelection.edge === "start"
        ? previewEdgeSelection.startOffset
        : previewEdgeSelection.endOffset;

    Transforms.select(editor, {
      anchor: {
        offset,
        path: previewEdgeSelection.path,
      },
      focus: {
        offset,
        path: previewEdgeSelection.path,
      },
    });
    syncDomSelectionToEditorSelection(editor, {
      anchor: {
        offset,
        path: previewEdgeSelection.path,
      },
      focus: {
        offset,
        path: previewEdgeSelection.path,
      },
    });
    return;
  }

  const preservedSelection = getPreservedLinkEdgeSelection(editor, domSelection);
  if (preservedSelection) {
    Transforms.select(editor, preservedSelection);
    syncDomSelectionToEditorSelection(editor, preservedSelection);
    return;
  }

  const selection = ReactEditor.toSlateRange(editor, domSelection, {
    exactMatch: false,
    suppressThrow: true,
  });

  if (!selection) return;

  Transforms.select(editor, normalizeCollapsedLinkSelection(editor, selection));
}

function repairEmbeddedPlaceholderText(editor: Editor) {
  const childCount = editor.children.length;

  for (let index = 0; index < childCount; index += 1) {
    const path = [index];

    if (!Node.has(editor, path)) continue;

    const node = Node.get(editor, path);
    if (!isParagraphNode(node)) continue;

    const text = Editor.string(editor, path);
    const match = text.match(
      /^(\[(?:TABLE:table-[a-z0-9-]+|CODEBLOCK:code-block-[a-z0-9-]+)\])(.*)$/i,
    );

    if (!match) continue;

    const [, placeholder = "", trailingText = ""] = match;
    if (trailingText.length === 0) continue;

    const nextPath = Path.next(path);

    Editor.withoutNormalizing(editor, () => {
      Transforms.select(editor, {
        anchor: Editor.start(editor, path),
        focus: Editor.end(editor, path),
      });
      Editor.insertText(editor, placeholder);

      if (Node.has(editor, nextPath)) {
        const nextNode = Node.get(editor, nextPath);

        if (isParagraphNode(nextNode)) {
          const nextText = Editor.string(editor, nextPath);

          if (!isEmbeddedBlockPlaceholder(nextText)) {
            Transforms.select(editor, Editor.start(editor, nextPath));
            Editor.insertText(editor, trailingText);
            return;
          }
        }
      }

      Transforms.insertNodes(editor, createParagraph(trailingText), {
        at: nextPath,
      });
    });

    return;
  }
}

export function insertMarkdownToken(editor: Editor, token: string) {
  syncEditorSelectionFromDom(editor);

  const { selection } = editor;

  if (selection && Range.isCollapsed(selection)) {
    Editor.insertText(editor, `${token}${token}`);
    Transforms.move(editor, { distance: token.length, reverse: true });
  } else if (selection) {
    const selectedText = Editor.string(editor, selection);
    Editor.insertText(editor, `${token}${selectedText}${token}`);
  } else {
    Editor.insertText(editor, `${token}${token}`);
  }
}

export function getSelectedText(editor: Editor, options?: { syncSelection?: boolean }) {
  if (options?.syncSelection !== false) {
    syncEditorSelectionFromDom(editor);
  }

  const { selection } = editor;
  if (!selection || Range.isCollapsed(selection)) {
    return "";
  }

  return Editor.string(editor, selection);
}

export function insertWrappedToken(
  editor: Editor,
  openingToken: string,
  closingToken: string,
  options?: { syncSelection?: boolean },
) {
  if (options?.syncSelection !== false) {
    syncEditorSelectionFromDom(editor);
  }

  const { selection } = editor;

  if (selection && Range.isCollapsed(selection)) {
    Editor.insertText(editor, `${openingToken}${closingToken}`);
    Transforms.move(editor, { distance: closingToken.length, reverse: true });
    return;
  }

  if (selection) {
    const selectedText = Editor.string(editor, selection);
    Editor.insertText(editor, `${openingToken}${selectedText}${closingToken}`);
    return;
  }

  Editor.insertText(editor, `${openingToken}${closingToken}`);
  Transforms.move(editor, { distance: closingToken.length, reverse: true });
}

export function insertMarkdownLink(
  editor: Editor,
  url: string,
  text?: string,
  options?: { syncSelection?: boolean },
) {
  const selectedText = getSelectedText(editor, options);
  const linkText = text?.trim() || selectedText || url;

  Editor.insertText(editor, `[${linkText}](${url})`);
}

export function insertMarkdownImage(
  editor: Editor,
  url: string,
  altText?: string,
  options?: { syncSelection?: boolean },
) {
  const selectedText = getSelectedText(editor, options);
  const resolvedAltText = altText?.trim() || selectedText;

  Editor.insertText(editor, `![${resolvedAltText}](${url})`);
}

function insertLinePrefixToken(editor: Editor, token: string) {
  syncEditorSelectionFromDom(editor);

  const { selection } = editor;
  if (!selection) return;

  const blockEntry = Editor.above(editor, {
    at: selection,
    match: isParagraphNode,
  });

  if (blockEntry) {
    const [, blockPath] = blockEntry;
    const blockText = Editor.string(editor, blockPath);
    const blockStart = Editor.start(editor, blockPath);
    const leadingWhitespaceLength = blockText.match(/^\s*/)?.[0].length ?? 0;
    const existingPrefixMatch = blockText.slice(leadingWhitespaceLength).match(/^(\S+)(\s|$)/);
    const textBeforeSelection = Range.isCollapsed(selection)
      ? Editor.string(editor, {
          anchor: blockStart,
          focus: selection.anchor,
        })
      : "";

    if (
      Range.isCollapsed(selection) &&
      textBeforeSelection.length <= leadingWhitespaceLength &&
      existingPrefixMatch?.[1] === token
    ) {
      return;
    }

    const isEmbeddedBlock = isEmbeddedBlockPlaceholder(blockText);

    if (isEmbeddedBlock) {
      const nextPath = Path.next(blockPath);

      if (Node.has(editor, nextPath)) {
        const nextNode = Node.get(editor, nextPath);

        if (isParagraphNode(nextNode)) {
          const nextText = Editor.string(editor, nextPath);

          if (!isEmbeddedBlockPlaceholder(nextText)) {
            Transforms.select(editor, Editor.start(editor, nextPath));
            Editor.insertText(editor, `${token} `);
            return;
          }
        }
      }

      const insertionPath = Path.next(blockPath);

      Editor.withoutNormalizing(editor, () => {
        Transforms.insertNodes(editor, createParagraph(`${token} `), {
          at: insertionPath,
        });
        Transforms.select(editor, Editor.end(editor, insertionPath));
      });
      return;
    }
  }

  Transforms.move(editor, { unit: "line", reverse: true });
  Editor.insertText(editor, `${token} `);
  repairEmbeddedPlaceholderText(editor);
}

export function insertBlockToken(editor: Editor, token: string) {
  insertLinePrefixToken(editor, token);
}

export function insertListToken(editor: Editor, token: string) {
  if (token === "1.") {
    syncEditorSelectionFromDom(editor);

    const { selection } = editor;
    const blockEntry = selection
      ? Editor.above(editor, {
          at: selection,
          match: isParagraphNode,
        })
      : null;
    const indent = blockEntry
      ? (Editor.string(editor, blockEntry[1]).match(/^\s*/)?.[0] ?? "")
      : "";

    insertLinePrefixToken(editor, `${formatOrderedListOrdinal(1, getOrderedListDepth(indent))}.`);
    return;
  }

  insertLinePrefixToken(editor, token);
}

type MarkdownListContinuation = {
  currentPrefix: string;
  nextPrefix: string;
};

const literalTab = "\t";

function getOrderedListDepth(indent: string) {
  return (indent.match(/\t/g)?.length ?? 0) + 1;
}

function isAlphabeticOrderedDepth(depth: number) {
  return depth % 2 === 0;
}

function parseOrderedListOrdinal(marker: string) {
  if (/^\d+$/.test(marker)) {
    return Number.parseInt(marker, 10);
  }

  if (!/^[a-z]+$/i.test(marker)) return null;

  let value = 0;

  for (const character of marker.toLowerCase()) {
    value = value * 26 + (character.charCodeAt(0) - 96);
  }

  return value;
}

function toAlphabeticOrdinal(value: number) {
  let current = Math.max(value, 1);
  let result = "";

  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(97 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }

  return result;
}

function formatOrderedListOrdinal(index: number, depth: number) {
  return isAlphabeticOrderedDepth(depth) ? toAlphabeticOrdinal(index) : String(index);
}

function getMarkdownListContinuation(text: string): MarkdownListContinuation | null {
  const unorderedMatch = text.match(/^(\s*)([-*+])\s(.*)$/);
  if (unorderedMatch) {
    const [, indent = "", marker = "-"] = unorderedMatch;

    return {
      currentPrefix: `${indent}${marker} `,
      nextPrefix: `${indent}${marker} `,
    };
  }

  const orderedMatch = text.match(/^(\s*)(\d+|[a-z]+)\.\s(.*)$/i);
  if (orderedMatch) {
    const [, indent = "", rawIndex = "1"] = orderedMatch;
    const currentIndex = parseOrderedListOrdinal(rawIndex);
    if (currentIndex === null) return null;
    const depth = getOrderedListDepth(indent);
    const nextIndex = currentIndex + 1;

    return {
      currentPrefix: `${indent}${rawIndex}. `,
      nextPrefix: `${indent}${formatOrderedListOrdinal(nextIndex, depth)}. `,
    };
  }

  return null;
}

function replaceBlockText(editor: Editor, blockPath: Path, nextText: string, nextOffset: number) {
  Editor.withoutNormalizing(editor, () => {
    Transforms.select(editor, {
      anchor: Editor.start(editor, blockPath),
      focus: Editor.end(editor, blockPath),
    });
    Editor.insertText(editor, nextText);

    const startPoint = Editor.start(editor, blockPath);
    Transforms.select(editor, {
      anchor: {
        path: startPoint.path,
        offset: nextOffset,
      },
      focus: {
        path: startPoint.path,
        offset: nextOffset,
      },
    });
  });
}

function getForwardMarkdownTabTransform(text: string, offset: number) {
  const headingMatch = text.match(/^(#{1,6})(\s+)/);
  if (headingMatch && offset <= headingMatch[0].length) {
    const hashes = headingMatch[1] ?? "#";
    if (hashes.length < 6) {
      return {
        nextOffset: offset + 1,
        nextText: `${hashes}#${text.slice(hashes.length)}`,
      };
    }
  }

  const blockquoteMatch = text.match(/^((?:>\s+)+)/);
  if (blockquoteMatch && offset <= blockquoteMatch[0].length) {
    const prefix = blockquoteMatch[1] ?? "> ";
    return {
      nextOffset: offset + 2,
      nextText: `${prefix}> ${text.slice(prefix.length)}`,
    };
  }

  const unorderedMatch = text.match(/^(\s*[-*+]\s+)/);
  if (unorderedMatch && offset <= unorderedMatch[0].length) {
    return {
      nextOffset: offset + literalTab.length,
      nextText: `${literalTab}${text}`,
    };
  }

  const orderedMatch = text.match(/^(\s*)(\d+|[a-z]+)(\.\s+)(.*)$/i);
  if (orderedMatch) {
    const [, indent = "", rawIndex = "1", separator = ". ", content = ""] = orderedMatch;
    const prefixLength = `${indent}${rawIndex}${separator}`.length;
    if (offset > prefixLength) return null;
    const currentIndex = parseOrderedListOrdinal(rawIndex);
    if (currentIndex === null) return null;
    const nextIndent = `${literalTab}${indent}`;
    const nextDepth = getOrderedListDepth(nextIndent);

    return {
      nextOffset: offset + literalTab.length,
      nextText: `${nextIndent}${formatOrderedListOrdinal(currentIndex, nextDepth)}. ${content}`,
    };
  }

  return null;
}

function getReverseMarkdownTabTransform(text: string, offset: number) {
  const headingMatch = text.match(/^(#{1,6})(\s+)/);
  if (headingMatch && offset <= headingMatch[0].length) {
    const hashes = headingMatch[1] ?? "#";
    if (hashes.length > 1) {
      return {
        nextOffset: Math.max(offset - 1, 0),
        nextText: `${hashes.slice(0, -1)}${text.slice(hashes.length)}`,
      };
    }
  }

  const blockquoteMatch = text.match(/^((?:>\s+)+)/);
  if (blockquoteMatch && offset <= blockquoteMatch[0].length) {
    const prefix = blockquoteMatch[1] ?? "> ";
    const levels = prefix.match(/>\s+/g)?.length ?? 0;
    if (levels > 1) {
      return {
        nextOffset: Math.max(offset - 2, 0),
        nextText: text.replace(/^>\s+/, ""),
      };
    }
  }

  const unorderedMatch = text.match(/^(\t+)(\s*[-*+]\s+)/);
  if (unorderedMatch && offset <= unorderedMatch[0].length) {
    const tabs = unorderedMatch[1] ?? literalTab;
    if (tabs.length > 0) {
      return {
        nextOffset: Math.max(offset - literalTab.length, 0),
        nextText: text.slice(literalTab.length),
      };
    }
  }

  const orderedMatch = text.match(/^(\t+)(\d+|[a-z]+)(\.\s+)(.*)$/i);
  if (orderedMatch) {
    const [, indent = "", rawIndex = "1", separator = ". ", content = ""] = orderedMatch;
    const prefixLength = `${indent}${rawIndex}${separator}`.length;
    if (offset > prefixLength) return null;
    const currentIndex = parseOrderedListOrdinal(rawIndex);
    if (currentIndex === null) return null;
    if (indent.length > 0) {
      const nextIndent = indent.slice(literalTab.length);
      const nextDepth = getOrderedListDepth(nextIndent);

      return {
        nextOffset: Math.max(offset - literalTab.length, 0),
        nextText: `${nextIndent}${formatOrderedListOrdinal(currentIndex, nextDepth)}. ${content}`,
      };
    }
  }

  return null;
}

export function handleEditorTab(editor: Editor, reverse = false) {
  syncEditorSelectionFromDom(editor);

  const { selection } = editor;
  if (!selection) return false;

  if (!Range.isCollapsed(selection)) {
    if (reverse) return true;

    Editor.insertText(editor, literalTab);
    return true;
  }

  const blockEntry = Editor.above(editor, {
    at: selection,
    match: isParagraphNode,
  });

  if (!blockEntry) {
    if (reverse) return true;

    Editor.insertText(editor, literalTab);
    return true;
  }

  const [, blockPath] = blockEntry;
  const blockText = Editor.string(editor, blockPath);
  if (isEmbeddedBlockPlaceholder(blockText)) return false;

  const blockStart = Editor.start(editor, blockPath);
  const textBeforeSelection = Editor.string(editor, {
    anchor: blockStart,
    focus: selection.anchor,
  });
  const transform = reverse
    ? getReverseMarkdownTabTransform(blockText, textBeforeSelection.length)
    : getForwardMarkdownTabTransform(blockText, textBeforeSelection.length);

  if (transform) {
    replaceBlockText(editor, blockPath, transform.nextText, transform.nextOffset);
    return true;
  }

  if (reverse) return true;

  Editor.insertText(editor, literalTab);
  return true;
}

export function continueMarkdownList(editor: Editor) {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) return false;

  const blockEntry = Editor.above(editor, {
    match: isParagraphNode,
  });
  if (!blockEntry) return false;

  const [, blockPath] = blockEntry;
  const blockText = Editor.string(editor, blockPath);
  if (isEmbeddedBlockPlaceholder(blockText)) return false;

  const continuation = getMarkdownListContinuation(blockText);
  if (!continuation) return false;

  const blockStart = Editor.start(editor, blockPath);
  const blockEnd = Editor.end(editor, blockPath);
  const textBeforeSelection = Editor.string(editor, {
    anchor: blockStart,
    focus: selection.anchor,
  });
  if (
    textBeforeSelection.length < continuation.currentPrefix.length ||
    !textBeforeSelection.startsWith(continuation.currentPrefix)
  ) {
    return false;
  }

  const textAfterSelection = Editor.string(editor, {
    anchor: selection.anchor,
    focus: blockEnd,
  });
  const currentLine = textBeforeSelection;
  const nextLine = `${continuation.nextPrefix}${textAfterSelection}`;
  const nextPath = Path.next(blockPath);
  const nextPoint = {
    path: [...nextPath, 0],
    offset: continuation.nextPrefix.length,
  };

  Editor.withoutNormalizing(editor, () => {
    Transforms.removeNodes(editor, { at: blockPath });
    Transforms.insertNodes(editor, [createParagraph(currentLine), createParagraph(nextLine)], {
      at: blockPath,
    });
    Transforms.select(editor, {
      anchor: nextPoint,
      focus: nextPoint,
    });
  });

  return true;
}

export function withDocumentGuards(editor: Editor) {
  const { normalizeNode } = editor;

  editor.normalizeNode = (entry) => {
    const [node] = entry;

    if (Editor.isEditor(node)) {
      if (node.children.length === 0) {
        Transforms.insertNodes(editor, createParagraph(), { at: [0] });
        return;
      }

      const lastNode = node.children.at(-1);
      if (
        lastNode &&
        isParagraphNode(lastNode) &&
        isEmbeddedBlockPlaceholder(getNodeText(lastNode as Descendant))
      ) {
        Transforms.insertNodes(editor, createParagraph(), { at: [node.children.length] });
        return;
      }
    }

    normalizeNode(entry);
  };

  return editor;
}
