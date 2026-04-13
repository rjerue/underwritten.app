import type { Dispatch, SetStateAction } from "react";

import {
  Bold,
  Code,
  FileCode2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Table2,
  Underline,
} from "lucide-react";
import type { Editor } from "slate";
import { ReactEditor } from "slate-react";

import { Button } from "../ui/button";
import { TableSizeSelector } from "../table-editor";
import type { DocumentFormat, ViewMode } from "../../editor/types";
import {
  getSelectedText,
  insertBlockToken,
  insertMarkdownImage,
  insertMarkdownLink,
  insertListToken,
  insertMarkdownToken,
  insertWrappedToken,
} from "../../editor/slate-commands";

type EditorToolbarProps = {
  documentFormat: DocumentFormat;
  editor: Editor;
  onInsertCodeBlock: () => void;
  onInsertTable: (rows: number, cols: number) => void;
  setShowTableSelector: Dispatch<SetStateAction<boolean>>;
  showTableSelector: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
};

export function EditorToolbar({
  documentFormat,
  editor,
  onInsertCodeBlock,
  onInsertTable,
  setShowTableSelector,
  showTableSelector,
  viewMode,
  onViewModeChange,
}: EditorToolbarProps) {
  const availableViewModes: ViewMode[] =
    documentFormat === "markdown" ? ["write", "read", "raw"] : ["raw"];

  const refocusEditor = () => {
    requestAnimationFrame(() => {
      try {
        ReactEditor.focus(editor);

        if (editor.selection) {
          const domRange = ReactEditor.toDOMRange(editor, editor.selection);
          const domSelection = window.getSelection();
          domSelection?.removeAllRanges();
          domSelection?.addRange(domRange);
        }
      } catch {
        // Ignore focus errors while the prompt is dismissing.
      }
    });
  };

  const normalizeExternalUrl = (value: string) => {
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
  };

  const handleInsertLink = () => {
    const selectedText = getSelectedText(editor);
    const rawUrl = window.prompt("Paste the link URL");
    if (rawUrl === null) return;

    const normalizedUrl = normalizeExternalUrl(rawUrl);
    if (!normalizedUrl) {
      window.alert("Enter a valid http:// or https:// link URL.");
      refocusEditor();
      return;
    }

    const promptedText =
      selectedText.length === 0 ? (window.prompt("Optional link text", "") ?? "") : selectedText;

    insertMarkdownLink(editor, normalizedUrl, promptedText, {
      syncSelection: false,
    });
    refocusEditor();
  };

  const handleInsertImage = () => {
    const selectedText = getSelectedText(editor);
    const rawUrl = window.prompt("Paste the image URL");
    if (rawUrl === null) return;

    const normalizedUrl = normalizeExternalUrl(rawUrl);
    if (!normalizedUrl) {
      window.alert("Enter a valid http:// or https:// image URL.");
      refocusEditor();
      return;
    }

    const altText = window.prompt("Optional alt text", selectedText) ?? selectedText;

    insertMarkdownImage(editor, normalizedUrl, altText, {
      syncSelection: false,
    });
    refocusEditor();
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <div
        className="flex items-center overflow-hidden rounded-md border border-border text-sm"
        data-testid="view-mode-toggle"
      >
        {availableViewModes.map((mode) => (
          <button
            key={mode}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              onViewModeChange(mode);
            }}
            className={`px-3 py-1.5 capitalize transition-colors focus:outline-none ${
              viewMode === mode
                ? "bg-foreground font-medium text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-pressed={viewMode === mode}
            data-testid={`mode-${mode}`}
          >
            {mode}
          </button>
        ))}
      </div>

      {viewMode === "write" ? (
        <>
          <div className="mx-1 h-6 w-px bg-border" />

          <Button
            variant="outline"
            size="sm"
            aria-label="Bold"
            data-testid="toolbar-bold"
            onMouseDown={(event) => {
              event.preventDefault();
              insertMarkdownToken(editor, "**");
            }}
          >
            <Bold className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Italic"
            data-testid="toolbar-italic"
            onMouseDown={(event) => {
              event.preventDefault();
              insertMarkdownToken(editor, "*");
            }}
          >
            <Italic className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Underline"
            data-testid="toolbar-underline"
            onMouseDown={(event) => {
              event.preventDefault();
              insertWrappedToken(editor, "<u>", "</u>");
            }}
          >
            <Underline className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Strikethrough"
            data-testid="toolbar-strikethrough"
            onMouseDown={(event) => {
              event.preventDefault();
              insertMarkdownToken(editor, "~~");
            }}
          >
            <Strikethrough className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Link"
            data-testid="toolbar-link"
            onMouseDown={(event) => {
              event.preventDefault();
              handleInsertLink();
            }}
          >
            <Link2 className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Image"
            data-testid="toolbar-image"
            onMouseDown={(event) => {
              event.preventDefault();
              handleInsertImage();
            }}
          >
            <ImageIcon className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Code"
            data-testid="toolbar-code"
            onMouseDown={(event) => {
              event.preventDefault();
              insertMarkdownToken(editor, "`");
            }}
          >
            <Code className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-6 w-px bg-border" />

          <Button
            variant="outline"
            size="sm"
            data-testid="toolbar-heading"
            onMouseDown={(event) => {
              event.preventDefault();
              insertBlockToken(editor, "##");
            }}
          >
            H2
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Blockquote"
            data-testid="toolbar-blockquote"
            onMouseDown={(event) => {
              event.preventDefault();
              insertBlockToken(editor, ">");
            }}
          >
            <Quote className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Bulleted List"
            data-testid="toolbar-bulleted-list"
            onMouseDown={(event) => {
              event.preventDefault();
              insertListToken(editor, "-");
            }}
          >
            <List className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label="Numbered List"
            data-testid="toolbar-numbered-list"
            onMouseDown={(event) => {
              event.preventDefault();
              insertListToken(editor, "1.");
            }}
          >
            <ListOrdered className="h-4 w-4" />
          </Button>

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              aria-label="Insert Table"
              data-testid="toolbar-table"
              onMouseDown={(event) => {
                event.preventDefault();
                setShowTableSelector((previous) => !previous);
              }}
            >
              <Table2 className="h-4 w-4" />
            </Button>

            {showTableSelector ? (
              <div className="absolute left-0 top-full z-50 mt-1">
                <TableSizeSelector
                  onSelect={(rows, cols) => {
                    onInsertTable(rows, cols);
                  }}
                  onClose={() => setShowTableSelector(false)}
                />
              </div>
            ) : null}
          </div>

          <Button
            variant="outline"
            size="sm"
            aria-label="Code Block"
            data-testid="toolbar-code-block"
            onMouseDown={(event) => {
              event.preventDefault();
              onInsertCodeBlock();
            }}
          >
            <FileCode2 className="h-4 w-4" />
          </Button>
        </>
      ) : null}
    </div>
  );
}
