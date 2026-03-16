import type { Descendant, Node } from "slate";
import { Editor, Element as SlateElement } from "slate";

import { blankDocumentValue, defaultTitle } from "./constants";
import type { CodeBlockData, CustomElement, StoredDraft, TableData } from "./types";
import { normalizeCodeLanguage } from "../components/code-block-editor";

export function createParagraph(text = ""): CustomElement {
  return {
    type: "paragraph",
    children: [{ text }],
  };
}

export function isParagraphNode(node: Node): node is CustomElement {
  return !Editor.isEditor(node) && SlateElement.isElement(node) && node.type === "paragraph";
}

export function getTablePlaceholderId(text: string): string | null {
  return text.trim().match(/^\[TABLE:(table-[a-z0-9-]+)\]$/i)?.[1] ?? null;
}

export function getCodeBlockPlaceholderId(text: string): string | null {
  return text.trim().match(/^\[CODEBLOCK:(code-block-[a-z0-9-]+)\]$/i)?.[1] ?? null;
}

export function isEmbeddedBlockPlaceholder(text: string) {
  return getTablePlaceholderId(text) !== null || getCodeBlockPlaceholderId(text) !== null;
}

export function getNodeText(node: Descendant) {
  return (node as CustomElement).children.map((child) => child.text).join("");
}

export function normalizeDocumentValue(documentValue: Descendant[]) {
  if (documentValue.length === 0) {
    return blankDocumentValue;
  }

  const lastNode = documentValue.at(-1);
  if (!lastNode) {
    return blankDocumentValue;
  }

  if (isEmbeddedBlockPlaceholder(getNodeText(lastNode))) {
    return [...documentValue, createParagraph()];
  }

  return documentValue;
}

function isMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isMarkdownTableSeparator(line: string) {
  if (!isMarkdownTableRow(line)) return false;

  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim())
    .every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitMarkdownTableCells(line: string) {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

export function getMarkdownCodeFenceLanguage(line: string) {
  return line.match(/^```([A-Za-z0-9_+.#-]*)\s*$/)?.[1] ?? null;
}

export function parseMarkdownDocument(markdown: string): StoredDraft {
  const lines = markdown.split("\n");
  const nextValue: Descendant[] = [];
  const nextCodeBlocks: CodeBlockData[] = [];
  const nextTables: TableData[] = [];
  let codeBlockCount = 1;
  let tableCount = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";

    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(nextLine)) {
      const headerRow = splitMarkdownTableCells(line);
      const rows: string[][] = [];
      let cursor = index + 2;

      while (cursor < lines.length && isMarkdownTableRow(lines[cursor] ?? "")) {
        rows.push(splitMarkdownTableCells(lines[cursor] ?? ""));
        cursor += 1;
      }

      const tableId = `table-import-${tableCount}`;
      tableCount += 1;
      nextTables.push({
        id: tableId,
        data: [headerRow, ...rows],
        position: nextTables.length,
      });
      nextValue.push(createParagraph(`[TABLE:${tableId}]`));
      index = cursor - 1;
      continue;
    }

    const rawLanguage = getMarkdownCodeFenceLanguage(line);
    if (rawLanguage !== null) {
      const codeLines: string[] = [];
      let cursor = index + 1;
      let closed = false;

      while (cursor < lines.length) {
        const currentLine = lines[cursor] ?? "";
        if (/^```\s*$/.test(currentLine)) {
          closed = true;
          break;
        }

        codeLines.push(currentLine);
        cursor += 1;
      }

      if (closed) {
        const codeBlockId = `code-block-import-${codeBlockCount}`;
        codeBlockCount += 1;
        nextCodeBlocks.push({
          code: codeLines.join("\n"),
          id: codeBlockId,
          language: normalizeCodeLanguage(rawLanguage),
          position: nextCodeBlocks.length,
        });
        nextValue.push(createParagraph(`[CODEBLOCK:${codeBlockId}]`));
        index = cursor;
        continue;
      }
    }

    nextValue.push(createParagraph(line));
  }

  return {
    codeBlocks: nextCodeBlocks,
    title: defaultTitle,
    value: normalizeDocumentValue(nextValue),
    tables: nextTables,
    version: 2,
  };
}

export function serializeMarkdown(
  documentValue: Descendant[],
  tables: TableData[],
  codeBlocks: CodeBlockData[],
) {
  const normalizedDocumentValue = normalizeDocumentValue(documentValue);

  return normalizedDocumentValue
    .map((node) => {
      const text = getNodeText(node);
      const tableId = getTablePlaceholderId(text);

      if (tableId) {
        const table = tables.find((currentTable) => currentTable.id === tableId);
        if (!table) {
          return text;
        }

        if (table.data.length === 0) {
          return "";
        }

        const headerRow = table.data[0] ?? [];
        const separatorRow = headerRow.map(() => "---");
        const bodyRows = table.data.slice(1);

        return [
          `| ${headerRow.join(" | ")} |`,
          `| ${separatorRow.join(" | ")} |`,
          ...bodyRows.map((row) => `| ${row.join(" | ")} |`),
        ].join("\n");
      }

      const codeBlockId = getCodeBlockPlaceholderId(text);
      if (codeBlockId) {
        const codeBlock = codeBlocks.find(
          (currentCodeBlock) => currentCodeBlock.id === codeBlockId,
        );
        if (!codeBlock) {
          return text;
        }

        const openingFence = codeBlock.language ? `\`\`\`${codeBlock.language}` : "```";
        return [openingFence, codeBlock.code, "```"].join("\n");
      }

      return text;
    })
    .join("\n");
}

export function buildDocumentFingerprint(title: string, markdown: string) {
  return JSON.stringify({ markdown, title });
}

export function titleFromFileName(fileName: string) {
  const segments = fileName.split("/").filter(Boolean);
  return (segments.at(-1) ?? fileName).replace(/\.[^.]+$/, "");
}

function sanitizePathSegments(input: string) {
  const segments = input
    .split("/")
    .map((segment) => segment.trim().replace(/[\\:*?"<>|]+/g, "-"))
    .filter(Boolean);

  return segments.length > 0 ? segments : null;
}

export function sanitizeFolderPath(folderPath: string) {
  const segments = sanitizePathSegments(folderPath);
  return segments ? segments.join("/") : null;
}

export function sanitizeFilePath(filePath: string) {
  const segments = sanitizePathSegments(filePath);
  if (!segments) return null;

  const lastIndex = segments.length - 1;
  const fileName = segments[lastIndex];
  if (!fileName) return null;

  segments[lastIndex] = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
  return segments.join("/");
}

export function dirname(filePath: string) {
  const parts = filePath.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

export function joinPath(parentPath: string, childPath: string) {
  return [parentPath, childPath].filter(Boolean).join("/");
}

export function replacePathPrefix(
  path: string | null,
  sourcePath: string,
  destinationPath: string,
) {
  if (!path) return null;
  if (path === sourcePath) return destinationPath;
  if (path.startsWith(`${sourcePath}/`)) {
    return `${destinationPath}${path.slice(sourcePath.length)}`;
  }
  return path;
}

export function suggestFileName(title: string) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitizeFilePath(slug || "untitled-document") ?? "untitled-document.md";
}
