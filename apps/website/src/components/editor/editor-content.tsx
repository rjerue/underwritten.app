import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import { Editor, Range as SlateRange, type Descendant, type NodeEntry } from "slate";
import { Editable, type RenderElementProps, type RenderLeafProps, Slate } from "slate-react";

import { CodeBlockEditor } from "../code-block-editor";
import { Button } from "../ui/button";
import { serializeMarkdownFragment } from "../../editor/markdown";
import { syncEditorSelectionFromDom } from "../../editor/slate-commands";
import type { CodeBlockData, CustomElement, TableData, ViewMode } from "../../editor/types";

type EditorContentProps = {
  codeBlocks: CodeBlockData[];
  currentMarkdown: string;
  decorate: (entry: NodeEntry) => SlateRange[];
  editor: Editor;
  onEditorChange: (value: Descendant[]) => void;
  onEditorFocus: () => void;
  onRawMarkdownChange: (markdown: string) => void;
  onRawKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onTitleChange: (title: string) => void;
  onEditableKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  rawTextareaRef: RefObject<HTMLTextAreaElement | null>;
  renderElement: (props: RenderElementProps) => ReactElement;
  renderLeaf: (props: RenderLeafProps) => ReactElement;
  showLineNumbers: boolean;
  tables: TableData[];
  title: string;
  value: Descendant[];
  viewMode: ViewMode;
};

export function normalizeExternalUrl(value: string) {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
}

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const regex =
    /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|~~(.+?)~~|<u>(.+?)<\/u>|_(.+?)_|(?<!\*)\*([^*]+?)\*(?!\*)|`(.+?)`/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));

    if (match[1] !== undefined && match[2] !== undefined) {
      const imageUrl = normalizeExternalUrl(match[2]);

      parts.push(
        imageUrl ? (
          <img
            key={match.index}
            alt={match[1]}
            className="my-3 inline-block max-h-[28rem] max-w-full rounded-lg border border-border object-contain align-middle shadow-sm"
            loading="lazy"
            src={imageUrl}
          />
        ) : (
          match[0]
        ),
      );
    } else if (match[3] !== undefined && match[4] !== undefined) {
      const linkUrl = normalizeExternalUrl(match[4]);

      parts.push(
        linkUrl ? (
          <a
            key={match.index}
            className="text-primary underline decoration-primary/60 underline-offset-4"
            href={linkUrl}
            rel="noreferrer"
            target="_blank"
          >
            {match[3]}
          </a>
        ) : (
          match[0]
        ),
      );
    } else if (match[5] !== undefined) {
      parts.push(<strong key={match.index}>{match[5]}</strong>);
    } else if (match[6] !== undefined) {
      parts.push(<s key={match.index}>{match[6]}</s>);
    } else if (match[7] !== undefined) {
      parts.push(
        <span key={match.index} className="underline underline-offset-4">
          {match[7]}
        </span>,
      );
    } else if (match[8] !== undefined || match[9] !== undefined) {
      parts.push(<em key={match.index}>{match[8] ?? match[9]}</em>);
    } else if (match[10] !== undefined) {
      parts.push(
        <code
          key={match.index}
          className="rounded bg-muted px-1 py-0.5 text-sm font-mono [overflow-wrap:anywhere]"
        >
          {match[10]}
        </code>,
      );
    }

    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : text;
}

const centeredBlockLineNumberClass = "top-1/2 -translate-y-1/2 items-center";

export function LineNumberGutter({
  className,
  lineNumber,
}: {
  className?: string;
  lineNumber: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute right-full mr-2 flex w-6 select-none justify-end pr-1 sm:mr-3 sm:w-10 ${
        className ?? centeredBlockLineNumberClass
      }`}
      contentEditable={false}
      data-line-number={lineNumber}
      data-testid="editor-line-number"
    >
      <span className="translate-y-[0.02em] leading-none text-[10px] font-medium tabular-nums text-muted-foreground/45 sm:text-xs">
        {lineNumber}
      </span>
    </span>
  );
}

type WriteModeLinkLeafProps = {
  attributes: RenderLeafProps["attributes"];
  children: ReactNode;
  label: string;
  onEdit: () => void;
  previewPathKey: string;
  previewEndOffset: number;
  previewStartOffset: number;
  url: string;
};

export function WriteModeLinkLeaf({
  attributes,
  children,
  label,
  onEdit,
  previewEndOffset,
  previewPathKey,
  previewStartOffset,
  url,
}: WriteModeLinkLeafProps) {
  const displayLabel = label.trim() || url;

  return (
    <span className="group relative inline-block max-w-full align-baseline">
      <span
        {...attributes}
        className="text-primary underline decoration-primary/60 underline-offset-4"
        data-link-preview-end={previewEndOffset}
        data-link-preview-path={previewPathKey}
        data-link-preview-start={previewStartOffset}
        data-testid="write-link-preview"
        title={url}
      >
        {children || displayLabel}
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap">
        <button
          className="pointer-events-auto inline-flex w-max select-none whitespace-nowrap rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground opacity-0 shadow-sm transition-[opacity,colors] duration-150 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-muted hover:text-foreground"
          contentEditable={false}
          data-testid="write-link-edit"
          onClick={(event) => {
            event.preventDefault();
            onEdit();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          style={{ userSelect: "none" }}
          type="button"
        >
          Edit
        </button>
      </span>
    </span>
  );
}

type WriteModeImageBlockProps = {
  altText: string;
  attributes: RenderElementProps["attributes"];
  children: ReactNode;
  lineNumber?: number;
  onEdit: () => void;
  url: string;
};

export function WriteModeImageBlock({
  altText,
  attributes,
  children,
  lineNumber,
  onEdit,
  url,
}: WriteModeImageBlockProps) {
  const normalizedUrl = normalizeExternalUrl(url);
  const [hasLoadError, setHasLoadError] = useState(normalizedUrl === null);

  useEffect(() => {
    setHasLoadError(normalizedUrl === null);
  }, [normalizedUrl]);

  return (
    <div {...attributes} className="relative my-4" contentEditable={false}>
      {typeof lineNumber === "number" ? (
        <LineNumberGutter className={centeredBlockLineNumberClass} lineNumber={lineNumber} />
      ) : null}
      <div
        className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
        data-testid="write-image-preview"
      >
        <div className="flex min-h-48 items-center justify-center bg-muted/30">
          {normalizedUrl && !hasLoadError ? (
            <img
              alt={altText}
              className="max-h-[28rem] w-full object-contain"
              data-testid="write-image-preview-image"
              onError={() => setHasLoadError(true)}
              onLoad={() => setHasLoadError(false)}
              src={normalizedUrl}
            />
          ) : (
            <div
              className="px-6 py-10 text-center text-sm font-medium text-muted-foreground"
              data-testid="write-image-not-found"
            >
              Image not found
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {altText.trim() || "No alt text"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{url}</p>
          </div>

          <Button
            data-testid="write-image-edit"
            onClick={(event) => {
              event.preventDefault();
              onEdit();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Edit image
          </Button>
        </div>
      </div>

      <span style={{ display: "none" }}>{children}</span>
    </div>
  );
}

function getPlainText(value: Descendant[]) {
  return value
    .map((node) => (node as CustomElement).children.map((child) => child.text).join(""))
    .join("\n");
}

function shouldBypassMarkdownCopy(activeElement: Element | null) {
  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement?.closest('[data-testid="table-editor"], [data-testid="code-block-editor"]') !==
      null
  );
}

function selectionCoversNodeContents(selection: Selection, container: HTMLElement) {
  if (selection.rangeCount === 0) {
    return false;
  }

  const selectedRange = selection.getRangeAt(0);
  const contentRange = document.createRange();
  contentRange.selectNodeContents(container);

  return (
    selectedRange.compareBoundaryPoints(globalThis.Range.START_TO_START, contentRange) <= 0 &&
    selectedRange.compareBoundaryPoints(globalThis.Range.END_TO_END, contentRange) >= 0
  );
}

function getListDepth(indent: string) {
  let depth = 0;
  let pendingSpaces = 0;

  for (const character of indent) {
    if (character === "\t") {
      depth += 1;
      pendingSpaces = 0;
      continue;
    }

    if (character === " ") {
      pendingSpaces += 1;

      if (pendingSpaces === 2) {
        depth += 1;
        pendingSpaces = 0;
      }
    }
  }

  return depth;
}

function ReadModeDocument({
  codeBlocks,
  showLineNumbers,
  tables,
  value,
}: {
  codeBlocks: CodeBlockData[];
  showLineNumbers: boolean;
  tables: TableData[];
  value: Descendant[];
}) {
  const raw = getPlainText(value);
  const lines = raw.split("\n");

  return (
    <div className="min-h-[500px] whitespace-pre-wrap font-sans leading-relaxed text-foreground [overflow-wrap:anywhere]">
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const standaloneImageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);

        if (line.trim() === "") {
          return (
            <div key={index} className="relative h-6">
              {showLineNumbers ? (
                <LineNumberGutter
                  className="top-1/2 -translate-y-1/2 items-center"
                  lineNumber={lineNumber}
                />
              ) : null}
            </div>
          );
        }

        if (standaloneImageMatch) {
          return (
            <div key={index} className="relative my-3">
              {showLineNumbers ? (
                <LineNumberGutter
                  className={centeredBlockLineNumberClass}
                  lineNumber={lineNumber}
                />
              ) : null}
              <div>{renderInline(line)}</div>
            </div>
          );
        }

        const tableMatch = line.match(/\[TABLE:(table-[a-z0-9-]+)\]/i);
        if (tableMatch) {
          const tableId = tableMatch[1];
          const table = tables.find((currentTable) => currentTable.id === tableId);

          if (table) {
            return (
              <div key={index} className="relative">
                {showLineNumbers ? (
                  <LineNumberGutter
                    className={centeredBlockLineNumberClass}
                    lineNumber={lineNumber}
                  />
                ) : null}
                <div className="my-4 overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full table-auto border-collapse">
                    <thead>
                      <tr>
                        {table.data[0]?.map((cell, cellIndex) => (
                          <th
                            key={cellIndex}
                            className="border-r border-b border-border bg-muted/50 px-3 py-2 text-left align-top font-semibold whitespace-pre-wrap break-words last:border-r-0"
                          >
                            {cell}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.data.slice(1).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className="border-r border-b border-border px-3 py-2 align-top whitespace-pre-wrap break-words last:border-r-0"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }

          return null;
        }

        const codeBlockMatch = line.match(/\[CODEBLOCK:(code-block-[a-z0-9-]+)\]/i);
        if (codeBlockMatch) {
          const codeBlockId = codeBlockMatch[1];
          const codeBlock = codeBlocks.find(
            (currentCodeBlock) => currentCodeBlock.id === codeBlockId,
          );

          if (codeBlock) {
            return (
              <div key={index} className="relative">
                {showLineNumbers ? (
                  <LineNumberGutter
                    className={centeredBlockLineNumberClass}
                    lineNumber={lineNumber}
                  />
                ) : null}
                <CodeBlockEditor code={codeBlock.code} language={codeBlock.language} readOnly />
              </div>
            );
          }

          return null;
        }

        const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
          const level = headerMatch[1].length;
          const text = headerMatch[2];
          const sizes = ["text-4xl", "text-3xl", "text-2xl", "text-xl", "text-lg", "text-base"];

          return (
            <p
              key={index}
              className={`relative ${sizes[level - 1]} mb-2 mt-4 font-bold [overflow-wrap:anywhere]`}
            >
              {showLineNumbers ? (
                <LineNumberGutter
                  className="top-1/2 -translate-y-1/2 items-center"
                  lineNumber={lineNumber}
                />
              ) : null}
              {renderInline(text)}
            </p>
          );
        }

        const quoteMatch = line.match(/^((?:>\s+)+)(.*)$/);
        if (quoteMatch) {
          return (
            <p
              key={index}
              className="relative my-1 border-l-2 border-border pl-4 italic text-muted-foreground [overflow-wrap:anywhere]"
            >
              {showLineNumbers ? <LineNumberGutter lineNumber={lineNumber} /> : null}
              {renderInline(quoteMatch[2])}
            </p>
          );
        }

        const unorderedMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
        if (unorderedMatch) {
          const depth = getListDepth(unorderedMatch[1]);

          return (
            <p
              key={index}
              className="relative my-0.5 flex min-w-0 gap-2"
              style={{ paddingInlineStart: `${depth * 1.5}rem` }}
            >
              {showLineNumbers ? <LineNumberGutter lineNumber={lineNumber} /> : null}
              <span className="select-none">•</span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {renderInline(unorderedMatch[2])}
              </span>
            </p>
          );
        }

        const orderedMatch = line.match(/^(\s*)((?:\d+)|(?:[a-z]+))\.\s+(.*)$/i);
        if (orderedMatch) {
          const depth = getListDepth(orderedMatch[1]);

          return (
            <p
              key={index}
              className="relative my-0.5 flex min-w-0 gap-2"
              style={{ paddingInlineStart: `${depth * 1.5}rem` }}
            >
              {showLineNumbers ? <LineNumberGutter lineNumber={lineNumber} /> : null}
              <span className="select-none">{orderedMatch[2]}.</span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {renderInline(orderedMatch[3])}
              </span>
            </p>
          );
        }

        return (
          <p
            key={index}
            className="relative my-3 whitespace-pre-wrap [overflow-wrap:anywhere] first:mt-0 last:mb-0"
          >
            {showLineNumbers ? <LineNumberGutter lineNumber={lineNumber} /> : null}
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

export function defaultRenderLeaf({ attributes, children, leaf }: RenderLeafProps) {
  const style: CSSProperties = {};
  const isCurrentFindMatch = "currentFindMatch" in leaf && Boolean(leaf.currentFindMatch);
  let className = "";
  const textDecorations: string[] = [];

  if ("bold" in leaf && leaf.bold) {
    style.fontWeight = "bold";
  }

  if ("italic" in leaf && leaf.italic) {
    style.fontStyle = "italic";
  }

  if ("underline" in leaf && leaf.underline) {
    textDecorations.push("underline");
  }

  if ("strikethrough" in leaf && leaf.strikethrough) {
    textDecorations.push("line-through");
  }

  if (textDecorations.length > 0) {
    style.textDecoration = textDecorations.join(" ");
  }

  if ("code" in leaf && leaf.code) {
    className += " rounded bg-muted px-1 py-0.5 font-mono";

    if (!("header" in leaf && leaf.header)) {
      className += " text-sm";
    }
  }

  if ("blockquote" in leaf && leaf.blockquote) {
    className += " border-l-2 border-border pl-4 italic text-muted-foreground";
    style.display = "block";
  }

  if ("findMatch" in leaf && leaf.findMatch) {
    className +=
      " rounded bg-[color:oklch(0.91_0.12_92)]/70 text-foreground shadow-[inset_0_0_0_1px_rgba(120,87,12,0.15)]";

    if ("currentFindMatch" in leaf && leaf.currentFindMatch) {
      className +=
        " bg-sky-500/20 ring-1 ring-inset ring-sky-500/70 shadow-[inset_0_0_0_1px_rgba(14,116,144,0.2)]";
    }
  }

  return (
    <span
      {...attributes}
      className={className}
      data-current-find-match={isCurrentFindMatch ? "true" : undefined}
      style={style}
    >
      {children}
    </span>
  );
}

export function EditorContent({
  codeBlocks,
  currentMarkdown,
  decorate,
  editor,
  onEditorChange,
  onEditorFocus,
  onRawMarkdownChange,
  onRawKeyDown,
  onTitleChange,
  onEditableKeyDown,
  rawTextareaRef,
  renderElement,
  renderLeaf,
  showLineNumbers,
  tables,
  title,
  value,
  viewMode,
}: EditorContentProps) {
  const handleEditableCopy = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (viewMode !== "write" || shouldBypassMarkdownCopy(document.activeElement)) {
        return;
      }

      const domSelection = window.getSelection();
      if (domSelection && selectionCoversNodeContents(domSelection, event.currentTarget)) {
        event.preventDefault();
        event.clipboardData.setData("text/plain", currentMarkdown);
        event.clipboardData.setData("text/markdown", currentMarkdown);
        return;
      }

      syncEditorSelectionFromDom(editor);

      const selection = editor.selection;
      if (!selection || SlateRange.isCollapsed(selection)) {
        return;
      }

      try {
        const markdown = serializeMarkdownFragment(
          Editor.fragment(editor, selection),
          tables,
          codeBlocks,
        );
        if (markdown.length === 0) {
          return;
        }

        event.preventDefault();
        event.clipboardData.setData("text/plain", markdown);
        event.clipboardData.setData("text/markdown", markdown);
      } catch {
        // Fall back to the browser copy behavior if the Slate selection cannot be serialized.
      }
    },
    [codeBlocks, currentMarkdown, editor, tables, viewMode],
  );

  return (
    <>
      <input
        type="text"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        data-testid="document-title"
        className="mb-4 w-full border-none bg-transparent text-4xl font-bold text-foreground outline-none placeholder:text-muted-foreground"
        placeholder="Untitled Document"
      />

      {viewMode === "read" ? (
        <div data-testid="read-mode-content">
          <ReadModeDocument
            codeBlocks={codeBlocks}
            showLineNumbers={showLineNumbers}
            tables={tables}
            value={value}
          />
        </div>
      ) : viewMode === "raw" ? (
        <textarea
          data-testid="raw-mode-content"
          ref={rawTextareaRef}
          className="min-h-[500px] w-full resize-none overflow-hidden border-none bg-transparent font-mono leading-relaxed text-muted-foreground outline-none"
          onChange={(event) => {
            event.currentTarget.style.height = "0px";
            event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
            onRawMarkdownChange(event.target.value);
          }}
          onKeyDown={onRawKeyDown}
          rows={1}
          spellCheck={false}
          value={currentMarkdown}
        ></textarea>
      ) : (
        <Slate editor={editor} initialValue={value} onValueChange={onEditorChange}>
          <Editable
            decorate={viewMode === "write" ? decorate : undefined}
            renderLeaf={renderLeaf}
            renderElement={renderElement}
            placeholder="Start writing..."
            data-testid="editor-surface"
            className="min-h-[500px] whitespace-pre-wrap font-mono leading-relaxed focus:outline-none"
            spellCheck={viewMode === "write"}
            autoFocus
            onCopy={handleEditableCopy}
            onFocus={onEditorFocus}
            onKeyDown={onEditableKeyDown}
          />
        </Slate>
      )}
    </>
  );
}
