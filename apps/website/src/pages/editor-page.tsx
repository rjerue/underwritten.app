import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { strToU8, zipSync } from "fflate";
import {
  applyMarkdownTextEdits,
  buildMarkdownOutline,
  type BridgeSessionState,
  type MarkdownEdit,
  type UnderwrittenBridgeAction,
} from "underwritten-bridge-contract";
import {
  createEditor,
  type Descendant,
  Editor,
  Node,
  type NodeEntry,
  Path,
  Point,
  Range,
  Text,
  Transforms,
} from "slate";
import { withHistory } from "slate-history";
import { type RenderElementProps, type RenderLeafProps, ReactEditor, withReact } from "slate-react";
import { Image as ImageIcon, Link2, Settings2, X } from "lucide-react";

import { BrandNavigation } from "../components/brand-navigation";
import {
  CodeBlockEditor,
  type CodeBlockNavigationApi,
  normalizeCodeLanguage,
} from "../components/code-block-editor";
import {
  EditorContent,
  LineNumberGutter,
  WriteModeImageBlock,
  WriteModeLinkLeaf,
  defaultRenderLeaf,
  normalizeExternalUrl,
} from "../components/editor/editor-content";
import { EditorToolbar } from "../components/editor/editor-toolbar";
import { FileSidebar } from "../components/file-sidebar";
import { ModeToggle } from "../components/mode-toggle";
import { SettingsDialog } from "../components/settings-dialog";
import { TableEditor, type TableNavigationApi } from "../components/table-editor";
import { Button } from "../components/ui/button";
import { useApplyAppearanceSettings } from "../editor/appearance";
import {
  appWindowTitle,
  autosaveDelayMs,
  blankDocumentValue,
  defaultAppearance,
  defaultAutosaveEnabled,
  defaultMcpEnabled,
  defaultPageWidthMode,
  defaultShowLineNumbers,
  defaultSidebarCollapsed,
  defaultSidebarSide,
  defaultStorageMode,
  defaultTitle,
  fontPresets,
  initialCodeBlocksValue,
  initialTablesValue,
  initialValue,
  starterTitle,
} from "../editor/constants";
import { buildInlineMarkdownRanges } from "../editor/inline-markdown";
import { getPageWidthClass, getSidebarDesktopOffsetClass } from "../editor/layout";
import {
  buildPageTitle,
  buildDocumentFingerprint,
  createParagraph,
  dirname,
  getDocumentFormatFromFilePath,
  getCodeBlockPlaceholderId,
  getMarkdownCodeFenceLanguage,
  getNodeText,
  getTablePlaceholderId,
  isEmbeddedBlockPlaceholder,
  isParagraphNode,
  joinPath,
  normalizeDocumentValue,
  parseDocumentContent,
  replacePathPrefix,
  sanitizeFilePath,
  sanitizeFolderPath,
  serializeMarkdown,
  suggestFileName,
  titleFromFileName,
} from "../editor/markdown";
import {
  continueMarkdownList,
  handleEditorTab,
  normalizeCollapsedLinkSelection,
  syncEditorSelectionFromDom,
  withDocumentGuards,
} from "../editor/slate-commands";
import {
  loadAppearance,
  loadDraft,
  loadWorkspaceSettings,
  saveDraft,
  saveWorkspaceSettings,
} from "../editor/storage";
import type { CodeBlockData, DocumentFormat, TableData, ViewMode } from "../editor/types";
import {
  createDirectory,
  deletePath,
  loadStoredNativeDirectoryHandle,
  listDirectory,
  movePath,
  pickNativeDirectory,
  readFile,
  saveNativeDirectoryHandle,
  snapshotWorkspace,
  supportsNativeDirectoryAccess,
  type BrowserTreeEntry,
  type FileStorageMode,
  writeFile,
} from "../lib/file-system";
import { cn } from "../lib/utils";
import { useUnderwrittenBridge } from "../mcp/bridge-client";

function triggerBlobDownload(blob: Blob, fileName: string) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.click();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
}

function createWorkspaceArchiveName() {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return `underwritten-workspace-${timestamp}.zip`;
}

function isDirectorySelected(
  path: string | null,
  entriesByPath: Record<string, BrowserTreeEntry[]>,
  expandedDirectories: string[],
) {
  if (!path) return false;
  if (path in entriesByPath || expandedDirectories.includes(path)) {
    return true;
  }

  return Object.values(entriesByPath)
    .flat()
    .some((entry) => entry.path === path && entry.kind === "directory");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while accessing files.";
}

function isMissingPathError(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "NotFoundError";
  }

  if (error instanceof Error) {
    return /not found|does not exist/i.test(error.message);
  }

  return false;
}

async function collectWorkspacePaths(
  mode: FileStorageMode,
  nativeDirectoryHandle: FileSystemDirectoryHandle | null,
  path = "",
  recursive = false,
  includeDirectories = false,
): Promise<string[]> {
  const entries = await listDirectory(mode, nativeDirectoryHandle, path);
  const paths: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "directory") {
      if (includeDirectories) {
        paths.push(entry.path);
      }

      if (recursive) {
        paths.push(
          ...(await collectWorkspacePaths(
            mode,
            nativeDirectoryHandle,
            entry.path,
            recursive,
            includeDirectories,
          )),
        );
      }

      continue;
    }

    paths.push(entry.path);
  }

  return paths.sort((left, right) => left.localeCompare(right));
}

function focusEditorAtCurrentSelection(editor: Editor) {
  const selection = editor.selection;
  if (!selection) return;

  if (syncDomSelectionToVisibleLinkPreview(editor, selection)) {
    ReactEditor.focus(editor);
    return;
  }

  try {
    const domRange = ReactEditor.toDOMRange(editor, selection);
    const domSelection = window.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(domRange);
    ReactEditor.focus(editor);
  } catch {
    requestAnimationFrame(() => {
      try {
        const nextSelection = editor.selection;
        if (!nextSelection) return;

        if (syncDomSelectionToVisibleLinkPreview(editor, nextSelection)) {
          ReactEditor.focus(editor);
          return;
        }

        const domRange = ReactEditor.toDOMRange(editor, nextSelection);
        const domSelection = window.getSelection();
        domSelection?.removeAllRanges();
        domSelection?.addRange(domRange);
        ReactEditor.focus(editor);
      } catch {
        // Ignore DOM range sync failures while focus is settling.
      }
    });
  }
}

function getStickyEditorChromeBottom() {
  const candidates = [
    document.querySelector('[data-testid="view-mode-toggle"]'),
    document.querySelector('[data-testid="editor-find-replace"]'),
  ];

  return candidates.reduce((maxBottom, element) => {
    if (!(element instanceof HTMLElement)) {
      return maxBottom;
    }

    return Math.max(maxBottom, element.getBoundingClientRect().bottom);
  }, 0);
}

function centerViewportOnRect(rect: DOMRect | null) {
  if (!rect) {
    return;
  }

  const stickyBottom = getStickyEditorChromeBottom();
  const availableHeight = Math.max(window.innerHeight - stickyBottom, 1);
  const targetCenter = stickyBottom + availableHeight / 2;
  const currentRectCenter = rect.top + rect.height / 2;
  const nextTop = window.scrollY + currentRectCenter - targetCenter;

  window.scrollTo({
    behavior: "auto",
    top: Math.max(0, nextTop),
  });
}

function getEditorMatchRect(editor: Editor, match: MarkdownTextRange) {
  if (!Node.has(editor, match.path)) {
    return null;
  }

  const domRange = document.createRange();
  const [startNode, startOffset] = ReactEditor.toDOMPoint(editor, {
    path: match.path,
    offset: match.startOffset,
  });
  const [endNode, endOffset] = ReactEditor.toDOMPoint(editor, {
    path: match.path,
    offset: match.endOffset,
  });

  domRange.setStart(startNode, startOffset);
  domRange.setEnd(endNode, endOffset);
  return domRange.getBoundingClientRect();
}

function syncEditorSelectionToDom(editor: Editor, options?: { focus?: boolean }) {
  const selection = editor.selection;
  if (!selection) return null;

  const shouldFocus = options?.focus ?? false;

  if (syncDomSelectionToVisibleLinkPreview(editor, selection)) {
    if (shouldFocus) {
      ReactEditor.focus(editor);
    }

    return null;
  }

  const domRange = ReactEditor.toDOMRange(editor, selection);
  const domSelection = window.getSelection();
  domSelection?.removeAllRanges();
  domSelection?.addRange(domRange);

  if (shouldFocus) {
    ReactEditor.focus(editor);
  }

  return domRange.getBoundingClientRect();
}

function centerEditorSelectionInViewport(editor: Editor, options?: { focus?: boolean }) {
  try {
    const rect = syncEditorSelectionToDom(editor, options);
    centerViewportOnRect(rect);
    return;
  } catch {
    requestAnimationFrame(() => {
      try {
        const rect = syncEditorSelectionToDom(editor, options);
        centerViewportOnRect(rect);
      } catch {
        // Ignore DOM range sync failures while focus is settling.
      }
    });
  }
}

function measureTextareaSelectionRect(textarea: HTMLTextAreaElement) {
  const startOffset = textarea.selectionStart ?? 0;
  const endOffset = textarea.selectionEnd ?? startOffset;
  const computedStyle = window.getComputedStyle(textarea);
  const marker = document.createElement("span");
  const mirror = document.createElement("div");
  const beforeSelection = textarea.value.slice(0, startOffset);
  const selectedText = textarea.value.slice(startOffset, endOffset) || "\u200b";

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = "break-word";
  mirror.style.boxSizing = computedStyle.boxSizing;
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.style.padding = computedStyle.padding;
  mirror.style.border = computedStyle.border;
  mirror.style.font = computedStyle.font;
  mirror.style.fontFamily = computedStyle.fontFamily;
  mirror.style.fontSize = computedStyle.fontSize;
  mirror.style.fontStyle = computedStyle.fontStyle;
  mirror.style.fontWeight = computedStyle.fontWeight;
  mirror.style.letterSpacing = computedStyle.letterSpacing;
  mirror.style.lineHeight = computedStyle.lineHeight;
  mirror.style.textTransform = computedStyle.textTransform;
  mirror.style.textIndent = computedStyle.textIndent;
  mirror.style.textRendering = computedStyle.textRendering;
  mirror.style.tabSize = computedStyle.tabSize;
  mirror.style.top = `${window.scrollY + textarea.getBoundingClientRect().top}px`;
  mirror.style.left = `${window.scrollX + textarea.getBoundingClientRect().left}px`;

  mirror.textContent = beforeSelection;
  marker.textContent = selectedText;
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const rect = marker.getBoundingClientRect();
  mirror.remove();
  return rect;
}

function centerTextareaSelectionInViewport(textarea: HTMLTextAreaElement) {
  centerViewportOnRect(measureTextareaSelectionRect(textarea));
}

type MarkdownTextRange = {
  endOffset: number;
  path: Path;
  startOffset: number;
};

type WriteFindMatch = MarkdownTextRange;

type RawFindMatch = {
  endOffset: number;
  startOffset: number;
};

type LinkEditorState = MarkdownTextRange & {
  label: string;
  url: string;
};

type ImageEditorState = MarkdownTextRange & {
  altText: string;
  url: string;
};

type ExternalFileConflict = {
  acknowledged: boolean;
  detectedAt: number;
  diskFingerprint: string;
  diskMarkdown: string;
  filePath: string;
};

type BridgeFlashbar = {
  action: "apply_markdown_edits" | "replace_current_document";
  detectedAt: number;
};

function BottomFlashbar({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId: string;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-4"
      data-testid={testId}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto w-full max-w-3xl rounded-2xl border px-4 py-4 shadow-lg backdrop-blur-sm",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function findTextMatchRanges(text: string, query: string) {
  if (query.length === 0) {
    return [];
  }

  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const matches: Array<{
    endOffset: number;
    startOffset: number;
  }> = [];
  let searchIndex = 0;

  while (searchIndex <= normalizedText.length - normalizedQuery.length) {
    const nextIndex = normalizedText.indexOf(normalizedQuery, searchIndex);
    if (nextIndex === -1) {
      break;
    }

    matches.push({
      endOffset: nextIndex + query.length,
      startOffset: nextIndex,
    });
    searchIndex = nextIndex + Math.max(query.length, 1);
  }

  return matches;
}

function isFindShortcut(event: {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLocaleLowerCase() === "f"
  );
}

function isReplaceShortcut(event: {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
}) {
  const key = event.key.toLocaleLowerCase();
  return (
    (event.ctrlKey && !event.metaKey && !event.altKey && key === "h") ||
    (event.metaKey && event.altKey && key === "f")
  );
}

function isSelectAllShortcut(event: {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLocaleLowerCase() === "a"
  );
}

function getStandaloneImageMarkdownMatch(text: string) {
  return text.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
}

function isStandaloneImageParagraph(editor: Editor, path: Path) {
  if (!Node.has(editor, path)) {
    return false;
  }

  const node = Node.get(editor, path);
  if (!isParagraphNode(node)) {
    return false;
  }

  return getStandaloneImageMarkdownMatch(Editor.string(editor, path)) !== null;
}

function InlineEditorDialog({
  children,
  description,
  onClose,
  open,
  testId,
  title,
}: {
  children: ReactNode;
  description: string;
  onClose: () => void;
  open: boolean;
  testId: string;
  title: string;
}) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm"
        onClick={onClose}
        type="button"
      />

      <div
        aria-labelledby={`${testId}-title`}
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        data-testid={testId}
        role="dialog"
      >
        <div className="w-full max-w-lg rounded-2xl border border-border bg-popover p-6 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                {title.includes("Link") ? (
                  <Link2 className="h-4 w-4" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
                Inline preview
              </div>
              <h2 className="text-xl font-semibold text-popover-foreground" id={`${testId}-title`}>
                {title}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>

            <Button aria-label={`Close ${title}`} onClick={onClose} size="icon" variant="ghost">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {children}
        </div>
      </div>
    </>
  );
}

function getExpandedLinkSelectionRange(editor: Editor) {
  const { selection } = editor;
  if (!selection || Range.isCollapsed(selection)) {
    return null;
  }

  if (!Path.equals(selection.anchor.path, selection.focus.path)) {
    return null;
  }

  const [startPoint, endPoint] = Range.edges(selection);
  const path = startPoint.path;
  const textNode = Node.get(editor, path);
  if (!Text.isText(textNode)) {
    return null;
  }

  const text = textNode.text;
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    if (text[match.index - 1] === "!") {
      continue;
    }

    const label = match[1] ?? "";
    const labelStartOffset = match.index + 1;
    const labelEndOffset = labelStartOffset + label.length;

    if (
      startPoint.offset >= labelStartOffset &&
      endPoint.offset <= labelEndOffset &&
      startPoint.offset !== endPoint.offset
    ) {
      return {
        endOffset: match.index + match[0].length,
        path,
        startOffset: match.index,
      } satisfies MarkdownTextRange;
    }
  }

  return null;
}

function getLinkNavigationJump(editor: Editor, direction: "left" | "right") {
  const { selection } = editor;
  if (!selection) {
    return null;
  }

  const focusPoint = selection.focus;
  if (!Node.has(editor, focusPoint.path)) {
    return null;
  }

  const textNode = Node.get(editor, focusPoint.path);
  if (!Text.isText(textNode)) {
    return null;
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
    const nextOffsetInsideLabel = Math.min(labelStartOffset + 1, labelEndOffset);
    const previousOffsetInsideLabel = Math.max(labelEndOffset - 1, labelStartOffset);
    const previousVisibleOffset = Math.max(matchStartOffset - 1, 0);
    const nextVisibleOffset = Math.min(matchEndOffset + 1, text.length);

    if (direction === "left") {
      if (focusPoint.offset >= labelEndOffset && focusPoint.offset <= matchEndOffset) {
        if (previousOffsetInsideLabel === focusPoint.offset) {
          continue;
        }

        return {
          offset: previousOffsetInsideLabel,
          path: focusPoint.path,
        };
      }

      if (focusPoint.offset >= matchStartOffset && focusPoint.offset <= labelStartOffset) {
        if (previousVisibleOffset === focusPoint.offset) {
          continue;
        }

        return {
          offset: previousVisibleOffset,
          path: focusPoint.path,
        };
      }

      continue;
    }

    if (focusPoint.offset >= matchStartOffset && focusPoint.offset <= labelStartOffset) {
      if (nextOffsetInsideLabel === focusPoint.offset) {
        continue;
      }

      return {
        offset: nextOffsetInsideLabel,
        path: focusPoint.path,
      };
    }

    if (focusPoint.offset >= labelEndOffset && focusPoint.offset <= matchEndOffset) {
      if (nextVisibleOffset === focusPoint.offset) {
        continue;
      }

      return {
        offset: nextVisibleOffset,
        path: focusPoint.path,
      };
    }
  }

  return null;
}

function getCollapsedLinkSelectionInfo(editor: Editor, selection: Range) {
  if (!Range.isCollapsed(selection)) {
    return null;
  }

  const focusPoint = selection.focus;
  if (!Node.has(editor, focusPoint.path)) {
    return null;
  }

  const textNode = Node.get(editor, focusPoint.path);
  if (!Text.isText(textNode)) {
    return null;
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

    if (focusPoint.offset < matchStartOffset || focusPoint.offset > matchEndOffset) {
      continue;
    }

    return {
      endOffset: matchEndOffset,
      label,
      labelEndOffset,
      labelStartOffset,
      path: focusPoint.path,
      startOffset: matchStartOffset,
    };
  }

  return null;
}

function getDomLinkPreviewEdgeSelection(domSelection: Selection) {
  if (!domSelection.isCollapsed) {
    return null;
  }

  const anchorNode = domSelection.anchorNode;
  if (anchorNode?.nodeType !== window.Node.TEXT_NODE) {
    return null;
  }

  const parentElement = anchorNode.parentElement;
  const previewElement = parentElement?.closest(
    "[data-link-preview-path][data-link-preview-start][data-link-preview-end]",
  );
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

function syncDomSelectionToVisibleLinkPreview(editor: Editor, selection: Range) {
  const linkInfo = getCollapsedLinkSelectionInfo(editor, selection);
  if (!linkInfo) {
    return false;
  }

  const editorElement = ReactEditor.toDOMNode(editor, editor);
  if (!(editorElement instanceof HTMLElement)) {
    return false;
  }

  const previewSelector = [
    `[data-link-preview-path="${linkInfo.path.join(".")}"]`,
    `[data-link-preview-start="${linkInfo.startOffset}"]`,
    `[data-link-preview-end="${linkInfo.endOffset}"]`,
  ].join("");
  const previewElement = editorElement.querySelector(previewSelector);
  if (!(previewElement instanceof HTMLElement)) {
    return false;
  }

  const textWalker = document.createTreeWalker(previewElement, NodeFilter.SHOW_TEXT);
  const previewTextNode = textWalker.nextNode();
  if (!previewTextNode || previewTextNode.nodeType !== window.Node.TEXT_NODE) {
    return false;
  }

  const domOffset =
    selection.focus.offset <= linkInfo.labelStartOffset
      ? 0
      : selection.focus.offset >= linkInfo.labelEndOffset
        ? linkInfo.label.length
        : selection.focus.offset - linkInfo.labelStartOffset;
  const boundedOffset = Math.max(0, Math.min(domOffset, previewTextNode.textContent?.length ?? 0));
  const domRange = document.createRange();
  domRange.setStart(previewTextNode, boundedOffset);
  domRange.collapse(true);

  const domSelection = window.getSelection();
  domSelection?.removeAllRanges();
  domSelection?.addRange(domRange);
  return true;
}

export function EditorPage() {
  const initialDraft = useMemo(() => loadDraft(), []);
  const initialAppearance = useMemo(() => loadAppearance(), []);
  const initialWorkspace = useMemo(() => loadWorkspaceSettings(), []);
  const initialTitle = initialDraft?.title ?? starterTitle;
  const initialDocumentValue = initialDraft?.value ?? initialValue;
  const initialCodeBlocks = initialDraft?.codeBlocks ?? initialCodeBlocksValue;
  const initialTables = initialDraft?.tables ?? initialTablesValue;
  const initialMarkdown = useMemo(
    () => serializeMarkdown(initialDocumentValue, initialTables, initialCodeBlocks),
    [initialCodeBlocks, initialDocumentValue, initialTables],
  );
  const blankDocumentFingerprint = useMemo(() => buildDocumentFingerprint("", ""), []);
  const starterDocumentFingerprint = useMemo(
    () => buildDocumentFingerprint(starterTitle, initialMarkdown),
    [initialMarkdown],
  );
  const currentDocumentFingerprint = buildDocumentFingerprint(initialTitle, initialMarkdown);
  const [title, setTitle] = useState(initialTitle);
  const [codeBlocks, setCodeBlocks] = useState<CodeBlockData[]>(initialCodeBlocks);
  const [value, setValue] = useState<Descendant[]>(initialDocumentValue);
  const [documentFormat, setDocumentFormat] = useState<DocumentFormat>("markdown");
  const [viewMode, setViewMode] = useState<ViewMode>("write");
  const [tables, setTables] = useState<TableData[]>(initialTables);
  const [showTableSelector, setShowTableSelector] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceExpanded, setFindReplaceExpanded] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [activeFindMatchIndex, setActiveFindMatchIndex] = useState(0);
  const [linkEditorState, setLinkEditorState] = useState<LinkEditorState | null>(null);
  const [imageEditorState, setImageEditorState] = useState<ImageEditorState | null>(null);
  const [activeSelection, setActiveSelection] = useState<Range | null>(null);
  const [selectionRenderVersion, setSelectionRenderVersion] = useState(0);
  const [appearanceSettings, setAppearanceSettings] = useState(
    initialAppearance ?? defaultAppearance,
  );
  const [sidebarSide, setSidebarSide] = useState(
    initialWorkspace?.sidebarSide ?? defaultSidebarSide,
  );
  const [pageWidthMode, setPageWidthMode] = useState(
    initialWorkspace?.pageWidthMode ?? defaultPageWidthMode,
  );
  const [showLineNumbers, setShowLineNumbers] = useState(
    initialWorkspace?.showLineNumbers ?? defaultShowLineNumbers,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof initialWorkspace?.sidebarCollapsed === "boolean") {
      return initialWorkspace.sidebarCollapsed;
    }

    if (typeof window !== "undefined") {
      return window.matchMedia("(max-width: 1023px)").matches;
    }

    return defaultSidebarCollapsed;
  });
  const [fileStorageMode, setFileStorageMode] = useState<FileStorageMode>(
    initialWorkspace?.storageMode ?? defaultStorageMode,
  );
  const [autosaveEnabled, setAutosaveEnabled] = useState(
    initialWorkspace?.autosaveEnabled ?? defaultAutosaveEnabled,
  );
  const [bridgeEnabled, setBridgeEnabled] = useState(
    initialWorkspace?.bridgeEnabled ?? defaultMcpEnabled,
  );
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(
    initialWorkspace?.currentFileName ?? null,
  );
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState<string | null>(
    initialWorkspace?.lastSavedFingerprint ??
      (initialWorkspace?.currentFileName
        ? currentDocumentFingerprint
        : initialDraft
          ? null
          : starterDocumentFingerprint),
  );
  const [treeEntriesByPath, setTreeEntriesByPath] = useState<Record<string, BrowserTreeEntry[]>>(
    {},
  );
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([]);
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<string[]>([]);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [selectedTreeKind, setSelectedTreeKind] = useState<BrowserTreeEntry["kind"] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [externalFileConflict, setExternalFileConflict] = useState<ExternalFileConflict | null>(
    null,
  );
  const [bridgeFlashbar, setBridgeFlashbar] = useState<BridgeFlashbar | null>(null);
  const [lastSavedMarkdown, setLastSavedMarkdown] = useState<string | null>(null);
  const [tableRenderVersion, setTableRenderVersion] = useState(0);
  const [nativeDirectoryHandle, setNativeDirectoryHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [nativeDirectoryReady, setNativeDirectoryReady] = useState(false);
  const nativeFolderSupported = useMemo(() => supportsNativeDirectoryAccess(), []);
  const editor = useMemo(() => withDocumentGuards(withHistory(withReact(createEditor()))), []);
  const codeBlockNavigationRef = useRef<Record<string, CodeBlockNavigationApi>>({});
  const codeBlocksRef = useRef(codeBlocks);
  const tablesRef = useRef(tables);
  const currentFilePathRef = useRef(currentFilePath);
  const currentFingerprintRef = useRef<string | null>(null);
  const currentMarkdownRef = useRef("");
  const externalFileConflictRef = useRef<ExternalFileConflict | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const lastSavedMarkdownRef = useRef<string | null>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const tableNavigationRef = useRef<Record<string, TableNavigationApi>>({});
  const pendingCodeBlockFocusRef = useRef<string | null>(null);
  const pendingTableFocusRef = useRef<string | null>(null);

  useEffect(() => {
    codeBlocksRef.current = codeBlocks;
  }, [codeBlocks]);

  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

  useEffect(() => {
    if (viewMode !== "write") return;

    const handleSelectionChange = () => {
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;

      const editorElement = ReactEditor.toDOMNode(editor, editor);
      const anchorNode = domSelection.anchorNode;
      const focusNode = domSelection.focusNode;
      const selectionInsideEditor =
        (!!anchorNode && editorElement.contains(anchorNode)) ||
        (!!focusNode && editorElement.contains(focusNode));

      if (!selectionInsideEditor) return;

      const previewEdgeSelection = getDomLinkPreviewEdgeSelection(domSelection);
      const nextSelection = previewEdgeSelection
        ? {
            anchor: {
              offset:
                previewEdgeSelection.edge === "start"
                  ? previewEdgeSelection.startOffset
                  : previewEdgeSelection.endOffset,
              path: previewEdgeSelection.path,
            },
            focus: {
              offset:
                previewEdgeSelection.edge === "start"
                  ? previewEdgeSelection.startOffset
                  : previewEdgeSelection.endOffset,
              path: previewEdgeSelection.path,
            },
          }
        : ReactEditor.toSlateRange(editor, domSelection, {
            exactMatch: false,
            suppressThrow: true,
          });

      if (!nextSelection) return;
      const normalizedSelection = normalizeCollapsedLinkSelection(editor, nextSelection);
      if (editor.selection && Range.equals(editor.selection, normalizedSelection)) {
        if (Range.isCollapsed(normalizedSelection)) {
          syncDomSelectionToVisibleLinkPreview(editor, normalizedSelection);
        }

        return;
      }

      editor.selection = normalizedSelection;
      setActiveSelection(normalizedSelection);
      setSelectionRenderVersion((previous) => previous + 1);

      if (Range.isCollapsed(normalizedSelection)) {
        syncDomSelectionToVisibleLinkPreview(editor, normalizedSelection);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [editor, viewMode]);

  const currentMarkdown = useMemo(
    () => serializeMarkdown(value, tables, codeBlocks),
    [codeBlocks, tables, value],
  );
  const tableIdentityKey = useMemo(() => tables.map((table) => table.id).join("|"), [tables]);
  const renderTables = useMemo(() => tables, [tableIdentityKey, tableRenderVersion]);
  const currentFingerprint = useMemo(
    () => buildDocumentFingerprint(title, currentMarkdown),
    [currentMarkdown, title],
  );

  useEffect(() => {
    currentFingerprintRef.current = currentFingerprint;
  }, [currentFingerprint]);

  useEffect(() => {
    currentMarkdownRef.current = currentMarkdown;
  }, [currentMarkdown]);

  useEffect(() => {
    document.title = buildPageTitle(title, currentFilePath);

    return () => {
      document.title = appWindowTitle;
    };
  }, [currentFilePath, title]);

  const shouldSyncTitleWithFilePath = useCallback(
    (nextFilePath: string) => {
      const nextTitle = titleFromFileName(nextFilePath);
      const currentPath = currentFilePathRef.current;

      if (title.trim().length === 0 || title === defaultTitle || title === starterTitle) {
        return true;
      }

      if (currentPath && title === titleFromFileName(currentPath)) {
        return true;
      }

      return title === nextTitle;
    },
    [title],
  );

  useEffect(() => {
    if (viewMode !== "raw") return;

    const textarea = rawTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [currentMarkdown, viewMode]);

  const writeFindMatches = useMemo(() => {
    if (findQuery.length === 0) {
      return [] as WriteFindMatch[];
    }

    const matches: WriteFindMatch[] = [];

    value.forEach((node, blockIndex) => {
      if (!isParagraphNode(node)) {
        return;
      }

      const blockText = getNodeText(node);
      if (isEmbeddedBlockPlaceholder(blockText)) {
        return;
      }

      node.children.forEach((child, textIndex) => {
        const childPath = [blockIndex, textIndex];

        for (const match of findTextMatchRanges(child.text, findQuery)) {
          matches.push({
            endOffset: match.endOffset,
            path: childPath,
            startOffset: match.startOffset,
          });
        }
      });
    });

    return matches;
  }, [findQuery, value]);

  const rawFindMatches = useMemo(
    () =>
      findTextMatchRanges(currentMarkdown, findQuery).map(
        (match): RawFindMatch => ({
          endOffset: match.endOffset,
          startOffset: match.startOffset,
        }),
      ),
    [currentMarkdown, findQuery],
  );

  const activeFindMatchCount =
    viewMode === "raw" ? rawFindMatches.length : viewMode === "write" ? writeFindMatches.length : 0;
  const boundedActiveFindMatchIndex =
    activeFindMatchCount === 0 ? 0 : Math.min(activeFindMatchIndex, activeFindMatchCount - 1);
  const activeWriteFindMatch =
    viewMode === "write" && activeFindMatchCount > 0
      ? (writeFindMatches[boundedActiveFindMatchIndex] ?? null)
      : null;
  const activeRawFindMatch =
    viewMode === "raw" && activeFindMatchCount > 0
      ? (rawFindMatches[boundedActiveFindMatchIndex] ?? null)
      : null;
  const findMatchSummary =
    activeFindMatchCount === 0
      ? "0 results"
      : `${boundedActiveFindMatchIndex + 1} of ${activeFindMatchCount}`;

  useEffect(() => {
    setActiveFindMatchIndex(0);
  }, [findQuery, viewMode]);

  useEffect(() => {
    if (activeFindMatchCount === 0) {
      if (activeFindMatchIndex !== 0) {
        setActiveFindMatchIndex(0);
      }
      return;
    }

    if (activeFindMatchIndex >= activeFindMatchCount) {
      setActiveFindMatchIndex(activeFindMatchCount - 1);
    }
  }, [activeFindMatchCount, activeFindMatchIndex]);

  useEffect(() => {
    if (viewMode !== "read") {
      return;
    }

    setFindReplaceOpen(false);
  }, [viewMode]);

  const selectedEntry = useMemo(() => {
    if (!selectedTreePath) return null;

    return (
      Object.values(treeEntriesByPath)
        .flat()
        .find((entry) => entry.path === selectedTreePath) ?? null
    );
  }, [selectedTreePath, treeEntriesByPath]);

  const selectedDirectoryPath = useMemo(() => {
    const effectiveSelectedKind = selectedEntry?.kind ?? selectedTreeKind;

    if (
      effectiveSelectedKind === "directory" ||
      isDirectorySelected(selectedTreePath, treeEntriesByPath, expandedDirectories)
    ) {
      return selectedTreePath ?? "";
    }

    if (selectedTreePath) {
      return dirname(selectedTreePath);
    }

    if (currentFilePath) {
      return dirname(currentFilePath);
    }

    return "";
  }, [
    currentFilePath,
    expandedDirectories,
    selectedEntry?.kind,
    selectedTreeKind,
    selectedTreePath,
    treeEntriesByPath,
  ]);

  const unsavedBaselineFingerprint = lastSavedFingerprint ?? blankDocumentFingerprint;
  const hasUnsavedChanges = useMemo(
    () => currentFingerprint !== unsavedBaselineFingerprint,
    [currentFingerprint, unsavedBaselineFingerprint],
  );

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    lastSavedMarkdownRef.current = lastSavedMarkdown;
  }, [lastSavedMarkdown]);

  useEffect(() => {
    externalFileConflictRef.current = externalFileConflict;
  }, [externalFileConflict]);

  useEffect(() => {
    if (!bridgeFlashbar) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setBridgeFlashbar((previous) =>
        previous?.detectedAt === bridgeFlashbar.detectedAt ? null : previous,
      );
    }, 120000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [bridgeFlashbar]);

  useEffect(() => {
    setShowTableSelector(false);
  }, [viewMode]);

  useEffect(() => {
    if (viewMode === "write") return;

    setLinkEditorState(null);
    setImageEditorState(null);
    setActiveSelection(null);
  }, [viewMode]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const storedHandle = await loadStoredNativeDirectoryHandle();
      if (!active) return;

      setNativeDirectoryHandle(storedHandle);
      setNativeDirectoryReady(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  const loadDirectoryEntries = useCallback(
    async (
      directoryPath = "",
      modeOverride?: FileStorageMode,
      nativeHandleOverride?: FileSystemDirectoryHandle | null,
    ) => {
      const effectiveMode = modeOverride ?? fileStorageMode;
      const effectiveNativeHandle = nativeHandleOverride ?? nativeDirectoryHandle;

      if (effectiveMode === "native-folder" && !nativeDirectoryReady && !nativeHandleOverride) {
        return;
      }

      setLoadingDirectoryPaths((previous) =>
        previous.includes(directoryPath) ? previous : [...previous, directoryPath],
      );

      try {
        const entries = await listDirectory(effectiveMode, effectiveNativeHandle, directoryPath);
        setTreeEntriesByPath((previous) => ({
          ...previous,
          [directoryPath]: entries,
        }));
        setFileError(null);
      } catch (error) {
        setTreeEntriesByPath((previous) => ({
          ...previous,
          [directoryPath]: [],
        }));
        if (
          directoryPath === "" &&
          effectiveMode === "native-folder" &&
          effectiveNativeHandle === null
        ) {
          setFileError(null);
        } else {
          setFileError(getErrorMessage(error));
        }
      } finally {
        setLoadingDirectoryPaths((previous) => previous.filter((path) => path !== directoryPath));
      }
    },
    [fileStorageMode, nativeDirectoryHandle, nativeDirectoryReady],
  );

  useEffect(() => {
    void loadDirectoryEntries("");
  }, [loadDirectoryEntries]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const directoryPaths = new Set(["", ...expandedDirectories]);

      for (const directoryPath of directoryPaths) {
        void loadDirectoryEntries(directoryPath);
      }
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [expandedDirectories, loadDirectoryEntries]);

  const ensureEditorContent = useCallback(() => {
    if (editor.children.length === 0) {
      Transforms.insertNodes(editor, {
        type: "paragraph",
        children: [{ text: "" }],
      });
    }
  }, [editor]);

  const handleEditorFocus = useCallback(() => {
    try {
      ensureEditorContent();
    } catch (error) {
      console.warn("Focus error handled:", error);
    }
  }, [ensureEditorContent]);

  const handleEditorChange = useCallback((nextValue: Descendant[]) => {
    setValue(nextValue);

    if (nextValue.length === 0) {
      setValue(blankDocumentValue);
    }
  }, []);

  const replaceTextRange = useCallback(
    (
      range: MarkdownTextRange,
      nextText: string,
      options?: {
        focus?: boolean;
      },
    ) => {
      if (!Node.has(editor, range.path)) {
        return false;
      }

      Editor.withoutNormalizing(editor, () => {
        Transforms.select(editor, {
          anchor: {
            path: range.path,
            offset: range.startOffset,
          },
          focus: {
            path: range.path,
            offset: range.endOffset,
          },
        });
        Editor.insertText(editor, nextText);
        Transforms.collapse(editor, { edge: "end" });
      });

      setValue(normalizeDocumentValue(editor.children as Descendant[]));
      setActiveSelection(editor.selection);
      setSelectionRenderVersion((previous) => previous + 1);

      if (options?.focus !== false) {
        requestAnimationFrame(() => {
          try {
            ReactEditor.focus(editor);
          } catch {
            // Ignore focus failures while the editor is reconciling.
          }
        });
      }

      return true;
    },
    [editor],
  );

  const replaceAllWriteMatches = useCallback(
    (matches: WriteFindMatch[], nextText: string) => {
      if (matches.length === 0) {
        return false;
      }

      Editor.withoutNormalizing(editor, () => {
        for (const match of [...matches].reverse()) {
          if (!Node.has(editor, match.path)) {
            continue;
          }

          Transforms.select(editor, {
            anchor: {
              path: match.path,
              offset: match.startOffset,
            },
            focus: {
              path: match.path,
              offset: match.endOffset,
            },
          });
          Editor.insertText(editor, nextText);
        }

        if (editor.selection) {
          Transforms.collapse(editor, { edge: "end" });
        }
      });

      setValue(normalizeDocumentValue(editor.children as Descendant[]));
      setActiveSelection(editor.selection);
      setSelectionRenderVersion((previous) => previous + 1);
      return true;
    },
    [editor],
  );

  useEffect(() => {
    if (viewMode !== "write") return;

    for (let index = 0; index < editor.children.length; index += 1) {
      const path = [index];
      const node = editor.children[index];
      if (!node || !isParagraphNode(node)) continue;

      const text = Editor.string(editor, path);
      if (isEmbeddedBlockPlaceholder(text)) continue;

      const rawLanguage = getMarkdownCodeFenceLanguage(text.trim());
      if (rawLanguage === null) continue;

      const codeBlockId = `code-block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nextCodeBlock: CodeBlockData = {
        code: "",
        id: codeBlockId,
        language: normalizeCodeLanguage(rawLanguage),
        position: codeBlocksRef.current.length,
      };
      const nextCodeBlocks = [...codeBlocksRef.current, nextCodeBlock];

      codeBlocksRef.current = nextCodeBlocks;
      pendingCodeBlockFocusRef.current = codeBlockId;
      setCodeBlocks(nextCodeBlocks);

      Editor.withoutNormalizing(editor, () => {
        Transforms.removeNodes(editor, { at: path });
        Transforms.insertNodes(
          editor,
          [createParagraph(`[CODEBLOCK:${codeBlockId}]`), createParagraph()],
          { at: path },
        );
        Transforms.select(editor, Editor.start(editor, Path.next(path)));
      });

      setValue(normalizeDocumentValue(editor.children as Descendant[]));
      return;
    }
  }, [editor, viewMode, value]);

  const replaceEditorDocument = useCallback(
    (
      nextTitle: string,
      nextValue: Descendant[],
      nextTables: TableData[],
      nextCodeBlocks: CodeBlockData[],
    ) => {
      const normalizedValue = normalizeDocumentValue(nextValue);
      const childPaths = Array.from(Node.children(editor, []))
        .map(([, path]) => path)
        .reverse();
      codeBlocksRef.current = nextCodeBlocks;
      tablesRef.current = nextTables;

      Editor.withoutNormalizing(editor, () => {
        try {
          ReactEditor.blur(editor);
        } catch {
          // Raw/read mode may not have a mounted Slate DOM node to blur.
        }
        Transforms.deselect(editor);

        for (const path of childPaths) {
          Transforms.removeNodes(editor, { at: path });
        }

        Transforms.insertNodes(editor, normalizedValue, { at: [0] });
        Transforms.select(editor, Editor.start(editor, [0]));
      });

      setShowTableSelector(false);
      setTitle(nextTitle);
      setCodeBlocks(nextCodeBlocks);
      setValue(normalizedValue);
      setTables(nextTables);
      setTableRenderVersion((previous) => previous + 1);
    },
    [editor],
  );

  const clearExternalFileConflict = useCallback(() => {
    setExternalFileConflict(null);
  }, []);

  const loadCurrentFileFromDisk = useCallback(
    (filePath: string, content: string) => {
      const nextDocumentFormat = getDocumentFormatFromFilePath(filePath);
      const parsedDocument = parseDocumentContent(content, nextDocumentFormat);
      const nextTitle = titleFromFileName(filePath);

      replaceEditorDocument(
        nextTitle,
        parsedDocument.value,
        parsedDocument.tables,
        parsedDocument.codeBlocks,
      );
      setCurrentFilePath(filePath);
      setDocumentFormat(nextDocumentFormat);
      setSelectedTreePath(filePath);
      setSelectedTreeKind("file");
      if (nextDocumentFormat === "plain-text") {
        setViewMode("raw");
      }
      setLastSavedFingerprint(buildDocumentFingerprint(nextTitle, content));
      setLastSavedMarkdown(content);
      clearExternalFileConflict();
      setFileError(null);
    },
    [clearExternalFileConflict, replaceEditorDocument],
  );

  const markExternalFileConflict = useCallback((filePath: string, diskMarkdown: string) => {
    const diskFingerprint = buildDocumentFingerprint(titleFromFileName(filePath), diskMarkdown);

    setExternalFileConflict((previous) => {
      if (previous?.filePath === filePath && previous.diskFingerprint === diskFingerprint) {
        return previous;
      }

      return {
        acknowledged: false,
        detectedAt: Date.now(),
        diskFingerprint,
        diskMarkdown,
        filePath,
      };
    });
  }, []);

  const confirmNavigateAwayFromUnsaved = useCallback(() => {
    if (!hasUnsavedChanges) {
      return true;
    }

    return window.confirm(
      "You have unsaved changes in the current file. Open another file anyway?",
    );
  }, [hasUnsavedChanges]);

  const writeCurrentFileToPath = useCallback(
    async (
      filePath: string,
      options?: {
        activateSelection?: boolean;
        fingerprint?: string;
      },
    ) => {
      const shouldSyncTitle =
        options?.activateSelection !== false && shouldSyncTitleWithFilePath(filePath);
      const nextTitle = shouldSyncTitle ? titleFromFileName(filePath) : title;
      const savedFingerprint =
        options?.fingerprint ?? buildDocumentFingerprint(nextTitle, currentMarkdown);
      const isSavingCurrentFile = currentFilePathRef.current === filePath;

      if (isSavingCurrentFile) {
        try {
          const diskMarkdown = await readFile(fileStorageMode, nativeDirectoryHandle, filePath);
          const diskFingerprint = buildDocumentFingerprint(
            titleFromFileName(filePath),
            diskMarkdown,
          );
          const knownSavedMarkdown = lastSavedMarkdownRef.current;
          const diskDiffersFromBaseline =
            knownSavedMarkdown === null
              ? diskMarkdown !== currentMarkdownRef.current
              : diskMarkdown !== knownSavedMarkdown;
          const overwriteAllowed =
            externalFileConflictRef.current?.acknowledged === true &&
            externalFileConflictRef.current.filePath === filePath &&
            externalFileConflictRef.current.diskFingerprint === diskFingerprint;

          if (diskDiffersFromBaseline && !overwriteAllowed) {
            markExternalFileConflict(filePath, diskMarkdown);
            return false;
          }

          if (!diskDiffersFromBaseline) {
            clearExternalFileConflict();
            setLastSavedMarkdown(diskMarkdown);
          }
        } catch (error) {
          if (!isMissingPathError(error)) {
            setFileError(getErrorMessage(error));
            return false;
          }
        }
      }

      try {
        await writeFile(fileStorageMode, nativeDirectoryHandle, filePath, currentMarkdown);
        const nextDocumentFormat = getDocumentFormatFromFilePath(filePath);

        if (options?.activateSelection !== false) {
          if (shouldSyncTitle) {
            setTitle(nextTitle);
          }
          setCurrentFilePath(filePath);
          setDocumentFormat(nextDocumentFormat);
          if (nextDocumentFormat === "plain-text") {
            setViewMode("raw");
          }
          setSelectedTreePath(filePath);
          setSelectedTreeKind("file");
          setLastSavedFingerprint(savedFingerprint);
        } else if (
          currentFilePathRef.current === filePath &&
          currentFingerprintRef.current === savedFingerprint
        ) {
          setLastSavedFingerprint(savedFingerprint);
        }

        setLastSavedMarkdown(currentMarkdown);
        clearExternalFileConflict();
        setFileError(null);
        await loadDirectoryEntries("");

        const segments = filePath.split("/");
        const directoryPaths = segments
          .slice(0, -1)
          .map((_, index) => segments.slice(0, index + 1).join("/"));
        if (directoryPaths.length > 0) {
          setExpandedDirectories((previous) =>
            Array.from(new Set([...previous, ...directoryPaths])),
          );
          for (const directoryPath of directoryPaths) {
            await loadDirectoryEntries(directoryPath);
          }
        }

        return true;
      } catch (error) {
        setFileError(getErrorMessage(error));
        return false;
      }
    },
    [
      clearExternalFileConflict,
      currentFingerprint,
      currentMarkdown,
      fileStorageMode,
      loadDirectoryEntries,
      markExternalFileConflict,
      nativeDirectoryHandle,
      shouldSyncTitleWithFilePath,
    ],
  );

  const persistCurrentFile = useCallback(
    async (explicitFilePath?: string | null) => {
      const defaultSavePath =
        currentFilePath ?? joinPath(selectedDirectoryPath, suggestFileName(title));
      const promptResult =
        explicitFilePath === null ? window.prompt("Save file as", defaultSavePath) : undefined;
      const candidatePath =
        explicitFilePath === null
          ? promptResult
          : (explicitFilePath ?? currentFilePath ?? window.prompt("Save file as", defaultSavePath));
      if (!candidatePath) return false;

      const normalizedCandidatePath =
        selectedDirectoryPath && !candidatePath.includes("/")
          ? joinPath(selectedDirectoryPath, candidatePath)
          : candidatePath;
      const sanitizedFilePath = sanitizeFilePath(normalizedCandidatePath);
      if (!sanitizedFilePath) return false;

      return await writeCurrentFileToPath(sanitizedFilePath);
    },
    [currentFilePath, selectedDirectoryPath, title, writeCurrentFileToPath],
  );

  useEffect(() => {
    if (
      !autosaveEnabled ||
      !currentFilePath ||
      !hasUnsavedChanges ||
      (externalFileConflict !== null && !externalFileConflict.acknowledged)
    ) {
      return;
    }

    const autosaveFingerprint = currentFingerprint;
    const timeoutId = window.setTimeout(() => {
      void writeCurrentFileToPath(currentFilePath, {
        activateSelection: false,
        fingerprint: autosaveFingerprint,
      });
    }, autosaveDelayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    autosaveEnabled,
    currentFilePath,
    currentFingerprint,
    externalFileConflict,
    hasUnsavedChanges,
    writeCurrentFileToPath,
  ]);

  const loadDocumentFromFile = useCallback(
    async (filePath: string) => {
      if (filePath === currentFilePath) return;
      if (!confirmNavigateAwayFromUnsaved()) return;

      try {
        const markdown = await readFile(fileStorageMode, nativeDirectoryHandle, filePath);
        loadCurrentFileFromDisk(filePath, markdown);
      } catch (error) {
        setFileError(getErrorMessage(error));
      }
    },
    [
      confirmNavigateAwayFromUnsaved,
      currentFilePath,
      fileStorageMode,
      loadCurrentFileFromDisk,
      nativeDirectoryHandle,
    ],
  );

  const refreshExplorerTree = useCallback(
    async (directoryPaths: string[] = expandedDirectories) => {
      await loadDirectoryEntries("");

      const uniquePaths = Array.from(new Set(directoryPaths.filter(Boolean)));
      for (const directoryPath of uniquePaths) {
        await loadDirectoryEntries(directoryPath);
      }
    },
    [expandedDirectories, loadDirectoryEntries],
  );

  const createNewFile = useCallback(() => {
    if (!confirmNavigateAwayFromUnsaved()) return;

    replaceEditorDocument("", blankDocumentValue, [], []);
    setCurrentFilePath(null);
    setDocumentFormat("markdown");
    setViewMode("write");
    setSelectedTreePath(null);
    setSelectedTreeKind(null);
    setLastSavedFingerprint(blankDocumentFingerprint);
    setLastSavedMarkdown(null);
    clearExternalFileConflict();
    setFileError(null);
  }, [
    blankDocumentValue,
    blankDocumentFingerprint,
    clearExternalFileConflict,
    confirmNavigateAwayFromUnsaved,
    replaceEditorDocument,
  ]);

  const handleToggleDirectory = useCallback(
    async (directoryPath: string) => {
      const expanded = expandedDirectories.includes(directoryPath);

      setSelectedTreePath(directoryPath);
      setSelectedTreeKind("directory");
      setExpandedDirectories((previous) =>
        expanded ? previous.filter((path) => path !== directoryPath) : [...previous, directoryPath],
      );

      if (!expanded) {
        await loadDirectoryEntries(directoryPath);
      }
    },
    [expandedDirectories, loadDirectoryEntries],
  );

  const createFolderInTree = useCallback(async () => {
    const basePath =
      selectedEntry?.kind === "directory"
        ? selectedTreePath
        : selectedTreePath?.includes("/")
          ? selectedTreePath.split("/").slice(0, -1).join("/")
          : "";
    const suggestedName = basePath ? `${basePath}/new-folder` : "new-folder";
    const response = window.prompt("New folder path", suggestedName);
    if (!response) return;

    const sanitizedFolderPath = sanitizeFolderPath(response);
    if (!sanitizedFolderPath) return;

    try {
      await createDirectory(fileStorageMode, nativeDirectoryHandle, sanitizedFolderPath);
      setExpandedDirectories((previous) => {
        const ancestorPaths = sanitizedFolderPath
          .split("/")
          .slice(0, -1)
          .map((_, index, segments) => segments.slice(0, index + 1).join("/"));

        return Array.from(new Set([...previous, ...ancestorPaths, sanitizedFolderPath]));
      });
      setSelectedTreePath(sanitizedFolderPath);
      setSelectedTreeKind("directory");
      await loadDirectoryEntries("");

      const ancestorPaths = sanitizedFolderPath
        .split("/")
        .map((_, index, segments) => segments.slice(0, index + 1).join("/"));

      for (const directoryPath of ancestorPaths.slice(0, -1)) {
        await loadDirectoryEntries(directoryPath);
      }
    } catch (error) {
      setFileError(getErrorMessage(error));
    }
  }, [
    fileStorageMode,
    loadDirectoryEntries,
    nativeDirectoryHandle,
    selectedEntry,
    selectedTreePath,
  ]);

  const renameSelectedPath = useCallback(async () => {
    if (!selectedTreePath || !selectedEntry) return;

    const parentDirectoryPath = dirname(selectedTreePath);
    const defaultTargetPath = joinPath(parentDirectoryPath, selectedEntry.name);
    const response = window.prompt(
      `Rename ${selectedEntry.kind === "directory" ? "folder" : "file"}`,
      defaultTargetPath,
    );
    if (!response) return;

    const sanitizedDestinationPath =
      selectedEntry.kind === "directory"
        ? sanitizeFolderPath(response)
        : sanitizeFilePath(response);
    if (!sanitizedDestinationPath || sanitizedDestinationPath === selectedTreePath) return;

    try {
      await movePath(
        fileStorageMode,
        nativeDirectoryHandle,
        selectedTreePath,
        sanitizedDestinationPath,
      );

      const remappedCurrentFilePath = replacePathPrefix(
        currentFilePath,
        selectedTreePath,
        sanitizedDestinationPath,
      );
      const remappedSelectedPath = replacePathPrefix(
        selectedTreePath,
        selectedTreePath,
        sanitizedDestinationPath,
      );
      const remappedExpandedDirectories = expandedDirectories.map((path) =>
        replacePathPrefix(path, selectedTreePath, sanitizedDestinationPath),
      );

      setCurrentFilePath(remappedCurrentFilePath);
      setSelectedTreePath(remappedSelectedPath);
      setSelectedTreeKind(selectedEntry.kind);
      setExpandedDirectories(
        Array.from(new Set(remappedExpandedDirectories.filter(Boolean) as string[])),
      );
      clearExternalFileConflict();
      setFileError(null);

      const refreshPaths = Array.from(
        new Set([
          dirname(selectedTreePath),
          dirname(sanitizedDestinationPath),
          ...remappedExpandedDirectories,
        ]),
      ).filter((path): path is string => Boolean(path));

      await refreshExplorerTree(refreshPaths);
    } catch (error) {
      setFileError(getErrorMessage(error));
    }
  }, [
    currentFilePath,
    clearExternalFileConflict,
    expandedDirectories,
    fileStorageMode,
    nativeDirectoryHandle,
    refreshExplorerTree,
    selectedEntry,
    selectedTreePath,
  ]);

  const deleteSelectedPath = useCallback(async () => {
    if (!selectedTreePath || !selectedEntry) return;

    const affectsCurrentFile =
      currentFilePath === selectedTreePath ||
      (!!currentFilePath && currentFilePath.startsWith(`${selectedTreePath}/`));
    const confirmed = window.confirm(
      selectedEntry.kind === "directory"
        ? `Delete folder "${selectedEntry.name}" and all of its contents?`
        : `Delete file "${selectedEntry.name}"?`,
    );
    if (!confirmed) return;

    try {
      await deletePath(fileStorageMode, nativeDirectoryHandle, selectedTreePath);

      if (affectsCurrentFile) {
        setCurrentFilePath(null);
        setLastSavedFingerprint(null);
        setLastSavedMarkdown(null);
        clearExternalFileConflict();
      }

      setSelectedTreePath(null);
      setSelectedTreeKind(null);
      setExpandedDirectories((previous) =>
        previous.filter(
          (path) => path !== selectedTreePath && !path.startsWith(`${selectedTreePath}/`),
        ),
      );
      setFileError(null);

      await refreshExplorerTree(
        expandedDirectories.filter(
          (path) => path !== selectedTreePath && !path.startsWith(`${selectedTreePath}/`),
        ),
      );
    } catch (error) {
      setFileError(getErrorMessage(error));
    }
  }, [
    currentFilePath,
    clearExternalFileConflict,
    expandedDirectories,
    fileStorageMode,
    nativeDirectoryHandle,
    refreshExplorerTree,
    selectedEntry,
    selectedTreePath,
  ]);

  const moveTreePath = useCallback(
    async (sourcePath: string, destinationDirectoryPath: string) => {
      const sourceName = sourcePath.split("/").filter(Boolean).at(-1);
      if (!sourceName) return;

      const destinationPath = joinPath(destinationDirectoryPath, sourceName);
      if (destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`)) {
        return;
      }

      try {
        await movePath(fileStorageMode, nativeDirectoryHandle, sourcePath, destinationPath);

        const remappedCurrentFilePath = replacePathPrefix(
          currentFilePath,
          sourcePath,
          destinationPath,
        );
        const remappedSelectedPath = replacePathPrefix(
          selectedTreePath,
          sourcePath,
          destinationPath,
        );
        const remappedExpandedDirectories = expandedDirectories.map((path) =>
          replacePathPrefix(path, sourcePath, destinationPath),
        );

        setCurrentFilePath(remappedCurrentFilePath);
        setSelectedTreePath(remappedSelectedPath);
        setSelectedTreeKind((previous) => (remappedSelectedPath ? previous : null));
        setExpandedDirectories(
          Array.from(new Set(remappedExpandedDirectories.filter(Boolean) as string[])),
        );
        clearExternalFileConflict();
        setFileError(null);

        const refreshPaths = Array.from(
          new Set([dirname(sourcePath), destinationDirectoryPath, ...remappedExpandedDirectories]),
        ).filter((path): path is string => Boolean(path));

        await refreshExplorerTree(refreshPaths);
      } catch (error) {
        setFileError(getErrorMessage(error));
      }
    },
    [
      currentFilePath,
      clearExternalFileConflict,
      expandedDirectories,
      fileStorageMode,
      nativeDirectoryHandle,
      refreshExplorerTree,
      selectedTreePath,
    ],
  );

  const chooseNativeFolder = useCallback(async () => {
    try {
      const directoryHandle = await pickNativeDirectory();
      await saveNativeDirectoryHandle(directoryHandle);
      setNativeDirectoryHandle(directoryHandle);
      setCurrentFilePath(null);
      setLastSavedFingerprint(null);
      setLastSavedMarkdown(null);
      setExpandedDirectories([]);
      setSelectedTreePath(null);
      setSelectedTreeKind(null);
      clearExternalFileConflict();
      setFileError(null);
      await loadDirectoryEntries("", "native-folder", directoryHandle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setFileError(getErrorMessage(error));
    }
  }, [clearExternalFileConflict, loadDirectoryEntries]);

  const exportCurrentFileToDisk = useCallback(() => {
    try {
      const fileName = currentFilePath?.split("/").filter(Boolean).at(-1) ?? suggestFileName(title);
      triggerBlobDownload(
        new Blob([currentMarkdown], { type: "text/markdown;charset=utf-8" }),
        fileName,
      );
      setFileError(null);
    } catch (error) {
      setFileError(getErrorMessage(error));
    }
  }, [currentFilePath, currentMarkdown, title]);

  const exportWorkspaceToDisk = useCallback(async () => {
    try {
      const files = await snapshotWorkspace(fileStorageMode, nativeDirectoryHandle);
      const zipEntries = Object.fromEntries(
        files.map(({ content, path }) => [path, strToU8(content)]),
      ) as Record<string, Uint8Array>;

      if (currentFilePath && hasUnsavedChanges) {
        zipEntries[currentFilePath] = strToU8(currentMarkdown);
      }

      const zipArchive = zipSync(zipEntries);
      const zipPayload = new Uint8Array(zipArchive.byteLength);
      zipPayload.set(zipArchive);
      triggerBlobDownload(
        new Blob([zipPayload.buffer], { type: "application/zip" }),
        createWorkspaceArchiveName(),
      );
      setFileError(null);
    } catch (error) {
      setFileError(getErrorMessage(error));
    }
  }, [currentFilePath, currentMarkdown, fileStorageMode, hasUnsavedChanges, nativeDirectoryHandle]);

  const handleStorageModeChange = useCallback(
    async (mode: FileStorageMode) => {
      setFileStorageMode(mode);
      setCurrentFilePath(null);
      setLastSavedFingerprint(null);
      setLastSavedMarkdown(null);
      setSelectedTreePath(null);
      setSelectedTreeKind(null);
      setExpandedDirectories([]);
      setTreeEntriesByPath({});
      setLoadingDirectoryPaths([]);
      clearExternalFileConflict();

      if (mode === "native-folder" && nativeFolderSupported && !nativeDirectoryHandle) {
        await chooseNativeFolder();
      }

      if (mode === "origin-private") {
        setFileError(null);
      }
    },
    [chooseNativeFolder, clearExternalFileConflict, nativeDirectoryHandle, nativeFolderSupported],
  );

  const expandWorkspacePath = useCallback(
    async (path: string) => {
      await loadDirectoryEntries("");

      const directoryPaths = path
        .split("/")
        .slice(0, -1)
        .map((_, index, segments) => segments.slice(0, index + 1).join("/"));

      if (directoryPaths.length > 0) {
        setExpandedDirectories((previous) => Array.from(new Set([...previous, ...directoryPaths])));
      }

      for (const directoryPath of directoryPaths) {
        await loadDirectoryEntries(directoryPath);
      }
    },
    [loadDirectoryEntries],
  );

  const createBridgeDocumentSnapshot = useCallback(
    (markdown: string, includeOutline = false) => {
      const fingerprint = buildDocumentFingerprint(title, markdown);
      const dirty = fingerprint !== (lastSavedFingerprint ?? blankDocumentFingerprint);

      return {
        dirty,
        filePath: currentFilePath,
        markdown,
        outline: includeOutline ? buildMarkdownOutline(markdown) : undefined,
        storageMode: fileStorageMode,
        title,
      };
    },
    [blankDocumentFingerprint, currentFilePath, fileStorageMode, lastSavedFingerprint, title],
  );

  const openWorkspaceFileFromBridge = useCallback(
    async (filePath: string, discardUnsavedChanges = false) => {
      if (filePath === currentFilePath) {
        return createBridgeDocumentSnapshot(currentMarkdown);
      }

      if (hasUnsavedChanges && !discardUnsavedChanges) {
        throw new Error(
          "The current document has unsaved changes. Set discardUnsavedChanges to true to continue.",
        );
      }

      const markdown = await readFile(fileStorageMode, nativeDirectoryHandle, filePath);
      loadCurrentFileFromDisk(filePath, markdown);
      const nextTitle = titleFromFileName(filePath);

      return {
        dirty: false,
        filePath,
        markdown,
        storageMode: fileStorageMode,
        title: nextTitle,
      };
    },
    [
      createBridgeDocumentSnapshot,
      currentFilePath,
      currentMarkdown,
      fileStorageMode,
      hasUnsavedChanges,
      loadCurrentFileFromDisk,
      nativeDirectoryHandle,
    ],
  );

  const createWorkspaceFileFromBridge = useCallback(
    async (path: string, content = "", openAfterCreate = false) => {
      const sanitizedPath = sanitizeFilePath(path);
      if (!sanitizedPath) {
        throw new Error("A valid file path is required.");
      }

      if (openAfterCreate && hasUnsavedChanges && currentFilePath !== sanitizedPath) {
        throw new Error(
          "The current document has unsaved changes. Save or discard them before opening a new file.",
        );
      }

      await writeFile(fileStorageMode, nativeDirectoryHandle, sanitizedPath, content);
      await expandWorkspacePath(sanitizedPath);
      setSelectedTreePath(sanitizedPath);
      setSelectedTreeKind("file");
      setFileError(null);

      if (!openAfterCreate) {
        return { path: sanitizedPath };
      }

      loadCurrentFileFromDisk(sanitizedPath, content);
      const nextTitle = titleFromFileName(sanitizedPath);

      return {
        dirty: false,
        filePath: sanitizedPath,
        markdown: content,
        storageMode: fileStorageMode,
        title: nextTitle,
      };
    },
    [
      currentFilePath,
      expandWorkspacePath,
      fileStorageMode,
      hasUnsavedChanges,
      loadCurrentFileFromDisk,
      nativeDirectoryHandle,
    ],
  );

  const createWorkspaceFolderFromBridge = useCallback(
    async (path: string) => {
      const sanitizedPath = sanitizeFolderPath(path);
      if (!sanitizedPath) {
        throw new Error("A valid folder path is required.");
      }

      await createDirectory(fileStorageMode, nativeDirectoryHandle, sanitizedPath);
      setExpandedDirectories((previous) => {
        const ancestorPaths = sanitizedPath
          .split("/")
          .map((_, index, segments) => segments.slice(0, index + 1).join("/"));

        return Array.from(new Set([...previous, ...ancestorPaths]));
      });
      setSelectedTreePath(sanitizedPath);
      setSelectedTreeKind("directory");
      setFileError(null);
      await loadDirectoryEntries("");

      const ancestorPaths = sanitizedPath
        .split("/")
        .slice(0, -1)
        .map((_, index, segments) => segments.slice(0, index + 1).join("/"));

      for (const directoryPath of ancestorPaths) {
        await loadDirectoryEntries(directoryPath);
      }

      return { path: sanitizedPath };
    },
    [fileStorageMode, loadDirectoryEntries, nativeDirectoryHandle],
  );

  const moveWorkspacePathFromBridge = useCallback(
    async (sourcePath: string, destinationPath: string) => {
      const normalizedDestinationPath = sourcePath.endsWith(".md")
        ? sanitizeFilePath(destinationPath)
        : sanitizeFolderPath(destinationPath);
      if (!normalizedDestinationPath) {
        throw new Error("A valid destination path is required.");
      }

      await movePath(fileStorageMode, nativeDirectoryHandle, sourcePath, normalizedDestinationPath);

      const remappedCurrentFilePath = replacePathPrefix(
        currentFilePath,
        sourcePath,
        normalizedDestinationPath,
      );
      const remappedSelectedPath = replacePathPrefix(
        selectedTreePath,
        sourcePath,
        normalizedDestinationPath,
      );
      const remappedExpandedDirectories = expandedDirectories.map((path) =>
        replacePathPrefix(path, sourcePath, normalizedDestinationPath),
      );

      setCurrentFilePath(remappedCurrentFilePath);
      setSelectedTreePath(remappedSelectedPath);
      setSelectedTreeKind((previous) => (remappedSelectedPath ? previous : null));
      setExpandedDirectories(
        Array.from(new Set(remappedExpandedDirectories.filter(Boolean) as string[])),
      );
      clearExternalFileConflict();
      setFileError(null);

      const refreshPaths = Array.from(
        new Set([
          dirname(sourcePath),
          dirname(normalizedDestinationPath),
          ...remappedExpandedDirectories,
        ]),
      ).filter((path): path is string => Boolean(path));

      await refreshExplorerTree(refreshPaths);

      return {
        destinationPath: normalizedDestinationPath,
        sourcePath,
      };
    },
    [
      currentFilePath,
      clearExternalFileConflict,
      expandedDirectories,
      fileStorageMode,
      nativeDirectoryHandle,
      refreshExplorerTree,
      selectedTreePath,
    ],
  );

  const deleteWorkspacePathFromBridge = useCallback(
    async (path: string, force = false) => {
      const affectsCurrentFile =
        currentFilePath === path || (!!currentFilePath && currentFilePath.startsWith(`${path}/`));

      if (affectsCurrentFile && hasUnsavedChanges && !force) {
        throw new Error(
          "Deleting the active path would discard unsaved changes. Set force to true to continue.",
        );
      }

      await deletePath(fileStorageMode, nativeDirectoryHandle, path);

      if (affectsCurrentFile) {
        setCurrentFilePath(null);
        setLastSavedFingerprint(null);
        setLastSavedMarkdown(null);
        clearExternalFileConflict();
      }

      setSelectedTreePath((previous) =>
        previous === path || previous?.startsWith(`${path}/`) ? null : previous,
      );
      setSelectedTreeKind((previous) =>
        previous && (selectedTreePath === path || selectedTreePath?.startsWith(`${path}/`))
          ? null
          : previous,
      );
      setExpandedDirectories((previous) =>
        previous.filter(
          (directoryPath) => directoryPath !== path && !directoryPath.startsWith(`${path}/`),
        ),
      );
      setFileError(null);

      await refreshExplorerTree(
        expandedDirectories.filter(
          (directoryPath) => directoryPath !== path && !directoryPath.startsWith(`${path}/`),
        ),
      );

      return { path };
    },
    [
      currentFilePath,
      clearExternalFileConflict,
      expandedDirectories,
      fileStorageMode,
      hasUnsavedChanges,
      nativeDirectoryHandle,
      refreshExplorerTree,
      selectedTreePath,
    ],
  );

  const saveDocumentFromBridge = useCallback(
    async (path?: string) => {
      if (typeof path === "string") {
        const sanitizedPath = sanitizeFilePath(path);
        if (!sanitizedPath) {
          throw new Error("A valid file path is required.");
        }

        const saved = await writeCurrentFileToPath(sanitizedPath);
        if (!saved) {
          throw new Error("Unable to save the current document.");
        }

        return {
          path: sanitizedPath,
        };
      }

      if (!currentFilePath) {
        throw new Error("The current document has no file path. Provide path to save it.");
      }

      const saved = await writeCurrentFileToPath(currentFilePath);
      if (!saved) {
        throw new Error("Unable to save the current document.");
      }

      return {
        path: currentFilePath,
      };
    },
    [currentFilePath, writeCurrentFileToPath],
  );

  useEffect(() => {
    if (!currentFilePath) {
      clearExternalFileConflict();
      return;
    }

    if (
      fileStorageMode === "native-folder" &&
      (!nativeDirectoryReady || nativeDirectoryHandle === null)
    ) {
      return;
    }

    let cancelled = false;

    const syncCurrentFileWithDisk = async () => {
      try {
        const diskMarkdown = await readFile(
          fileStorageMode,
          nativeDirectoryHandle,
          currentFilePath,
        );
        if (cancelled || currentFilePathRef.current !== currentFilePath) {
          return;
        }

        const knownSavedMarkdown = lastSavedMarkdownRef.current;

        if (knownSavedMarkdown === null) {
          if (diskMarkdown === currentMarkdownRef.current) {
            setLastSavedMarkdown(diskMarkdown);
            clearExternalFileConflict();
            return;
          }

          if (!hasUnsavedChangesRef.current) {
            loadCurrentFileFromDisk(currentFilePath, diskMarkdown);
            return;
          }

          markExternalFileConflict(currentFilePath, diskMarkdown);
          return;
        }

        if (diskMarkdown === knownSavedMarkdown) {
          clearExternalFileConflict();
          return;
        }

        if (!hasUnsavedChangesRef.current) {
          loadCurrentFileFromDisk(currentFilePath, diskMarkdown);
          return;
        }

        markExternalFileConflict(currentFilePath, diskMarkdown);
      } catch (error) {
        if (!cancelled && !isMissingPathError(error)) {
          setFileError(getErrorMessage(error));
        }
      }
    };

    void syncCurrentFileWithDisk();
    const intervalId = window.setInterval(() => {
      void syncCurrentFileWithDisk();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    clearExternalFileConflict,
    currentFilePath,
    fileStorageMode,
    loadCurrentFileFromDisk,
    markExternalFileConflict,
    nativeDirectoryHandle,
    nativeDirectoryReady,
  ]);

  const replaceCurrentDocumentFromBridge = useCallback(
    async (markdown: string, action: BridgeFlashbar["action"] = "replace_current_document") => {
      const parsedDocument = parseDocumentContent(markdown, documentFormat);

      replaceEditorDocument(
        title,
        parsedDocument.value,
        parsedDocument.tables,
        parsedDocument.codeBlocks,
      );
      setFileError(null);
      setBridgeFlashbar({
        action,
        detectedAt: Date.now(),
      });

      return createBridgeDocumentSnapshot(markdown);
    },
    [createBridgeDocumentSnapshot, documentFormat, replaceEditorDocument, title],
  );

  const applyMarkdownEditsFromBridge = useCallback(
    async (edits: MarkdownEdit[]) => {
      const nextMarkdown = applyMarkdownTextEdits(currentMarkdown, edits);
      return await replaceCurrentDocumentFromBridge(nextMarkdown, "apply_markdown_edits");
    },
    [currentMarkdown, replaceCurrentDocumentFromBridge],
  );

  const handleBridgeAction = useCallback(
    async (action: UnderwrittenBridgeAction) => {
      switch (action.type) {
        case "get_workspace_status":
          return {
            activeFilePath: currentFilePath,
            hasNativeFolderSelected: nativeDirectoryHandle !== null,
            hasUnsavedChanges,
            storageMode: fileStorageMode,
          };

        case "list_files":
          return {
            paths: await collectWorkspacePaths(
              fileStorageMode,
              nativeDirectoryHandle,
              action.path ?? "",
              action.recursive ?? false,
              action.includeDirectories ?? false,
            ),
          };

        case "read_file":
          return {
            content: await readFile(fileStorageMode, nativeDirectoryHandle, action.path),
            path: action.path,
          };

        case "open_file":
          return await openWorkspaceFileFromBridge(action.path, action.discardUnsavedChanges);

        case "create_file":
          return await createWorkspaceFileFromBridge(
            action.path,
            action.content ?? "",
            action.openAfterCreate ?? false,
          );

        case "create_folder":
          return await createWorkspaceFolderFromBridge(action.path);

        case "move_path":
          return await moveWorkspacePathFromBridge(action.sourcePath, action.destinationPath);

        case "delete_path":
          return await deleteWorkspacePathFromBridge(action.path, action.force);

        case "save_document":
          return await saveDocumentFromBridge(action.path);

        case "get_current_document":
          return createBridgeDocumentSnapshot(currentMarkdown, action.includeOutline ?? false);

        case "replace_current_document":
          return await replaceCurrentDocumentFromBridge(action.markdown);

        case "apply_markdown_edits":
          return await applyMarkdownEditsFromBridge(action.edits);
      }
    },
    [
      applyMarkdownEditsFromBridge,
      createBridgeDocumentSnapshot,
      createWorkspaceFileFromBridge,
      createWorkspaceFolderFromBridge,
      currentFilePath,
      currentMarkdown,
      deleteWorkspacePathFromBridge,
      fileStorageMode,
      hasUnsavedChanges,
      moveWorkspacePathFromBridge,
      nativeDirectoryHandle,
      openWorkspaceFileFromBridge,
      replaceCurrentDocumentFromBridge,
      saveDocumentFromBridge,
    ],
  );

  const bridgeSessionState = useCallback(
    ({
      lastFocusAt,
      lastHeartbeatAt,
      sessionId,
    }: {
      lastFocusAt: number | null;
      lastHeartbeatAt: number;
      sessionId: string;
    }): BridgeSessionState => ({
      activeFilePath: currentFilePath,
      appCapabilities: {
        supportsDirectoryAccess: nativeFolderSupported,
      },
      dirty: hasUnsavedChanges,
      lastFocusAt,
      lastHeartbeatAt,
      markdown: currentMarkdown,
      nativeFolderSelected: nativeDirectoryHandle !== null,
      pageUrl: window.location.href,
      revision: currentFingerprint,
      sessionId,
      storageMode: fileStorageMode,
      title,
      visibilityState: document.visibilityState === "visible" ? "visible" : "hidden",
      windowLabel: window.name || null,
    }),
    [
      currentFilePath,
      currentFingerprint,
      currentMarkdown,
      fileStorageMode,
      hasUnsavedChanges,
      nativeDirectoryHandle,
      nativeFolderSupported,
      title,
    ],
  );

  const { panel: bridgePanel } = useUnderwrittenBridge({
    applyAction: handleBridgeAction,
    enabled: bridgeEnabled,
    getSessionState: bridgeSessionState,
  });

  const insertEmbeddedBlockAtSelection = useCallback(
    (placeholder: string) => {
      const embeddedNode = createParagraph(placeholder);
      const emptyNode = createParagraph();

      Editor.withoutNormalizing(editor, () => {
        if (editor.selection && Range.isExpanded(editor.selection)) {
          Transforms.delete(editor);
        }

        const blockEntry = Editor.above(editor, {
          match: isParagraphNode,
        });

        if (!blockEntry) {
          const insertionIndex = editor.children.length;
          Transforms.insertNodes(editor, [embeddedNode, emptyNode], {
            at: [insertionIndex],
          });
          Transforms.select(editor, Editor.start(editor, [insertionIndex + 1]));
          return;
        }

        let [, blockPath] = blockEntry;
        const blockText = Editor.string(editor, blockPath);
        const selection = editor.selection;
        const blockStart = Editor.start(editor, blockPath);
        const blockEnd = Editor.end(editor, blockPath);
        const atStart = selection ? Point.equals(selection.anchor, blockStart) : false;
        const atEnd = selection ? Point.equals(selection.anchor, blockEnd) : true;

        if (blockText === "") {
          Transforms.removeNodes(editor, { at: blockPath });
          Transforms.insertNodes(editor, [embeddedNode, emptyNode], {
            at: blockPath,
          });
          Transforms.select(editor, Editor.start(editor, Path.next(blockPath)));
          return;
        }

        if (!atStart && !atEnd) {
          Transforms.splitNodes(editor, {
            match: isParagraphNode,
          });

          const splitBlockEntry = Editor.above(editor, {
            match: isParagraphNode,
          });

          if (!splitBlockEntry) return;

          [, blockPath] = splitBlockEntry;
          Transforms.insertNodes(editor, embeddedNode, { at: blockPath });
          Transforms.select(editor, Editor.start(editor, Path.next(blockPath)));
          return;
        }

        const insertionPath = atStart ? blockPath : Path.next(blockPath);
        Transforms.insertNodes(editor, [embeddedNode, emptyNode], {
          at: insertionPath,
        });
        Transforms.select(editor, Editor.start(editor, Path.next(insertionPath)));
      });
    },
    [editor],
  );

  const insertTable = useCallback(
    (rows: number, cols: number) => {
      const tableId = `table-${Date.now()}`;
      const headers = Array.from({ length: cols }, (_, index) => `Header ${index + 1}`);
      const emptyRows = Array.from({ length: rows - 1 }, () => Array(cols).fill(""));
      const tableData: TableData = {
        id: tableId,
        data: [headers, ...emptyRows],
        position: tables.length,
      };

      setTables((previous) => [...previous, tableData]);
      pendingTableFocusRef.current = tableId;
      insertEmbeddedBlockAtSelection(`[TABLE:${tableId}]`);
      setShowTableSelector(false);
    },
    [insertEmbeddedBlockAtSelection, tables.length],
  );

  const insertCodeBlock = useCallback(
    (language: string | null = null) => {
      const codeBlockId = `code-block-${Date.now()}`;

      setCodeBlocks((previous) => [
        ...previous,
        {
          code: "",
          id: codeBlockId,
          language: normalizeCodeLanguage(language),
          position: previous.length,
        },
      ]);
      pendingCodeBlockFocusRef.current = codeBlockId;
      insertEmbeddedBlockAtSelection(`[CODEBLOCK:${codeBlockId}]`);
    },
    [insertEmbeddedBlockAtSelection],
  );

  const updateTable = useCallback((tableId: string, data: string[][]) => {
    setTables((previous) =>
      previous.map((table) => (table.id === tableId ? { ...table, data } : table)),
    );
  }, []);

  const updateCodeBlock = useCallback((codeBlockId: string, code: string) => {
    setCodeBlocks((previous) =>
      previous.map((codeBlock) =>
        codeBlock.id === codeBlockId ? { ...codeBlock, code } : codeBlock,
      ),
    );
  }, []);

  const updateCodeBlockLanguage = useCallback((codeBlockId: string, language: string | null) => {
    setCodeBlocks((previous) =>
      previous.map((codeBlock) =>
        codeBlock.id === codeBlockId
          ? {
              ...codeBlock,
              language: normalizeCodeLanguage(language),
            }
          : codeBlock,
      ),
    );
  }, []);

  const blurEditorSelection = useCallback(() => {
    if (editor.selection) {
      Transforms.deselect(editor);
    }

    ReactEditor.blur(editor);
  }, [editor]);

  const registerTableNavigation = useCallback(
    (tableId: string, navigation: TableNavigationApi | null) => {
      if (navigation) {
        tableNavigationRef.current[tableId] = navigation;

        if (pendingTableFocusRef.current === tableId) {
          pendingTableFocusRef.current = null;
          blurEditorSelection();
          navigation.focusFirstCellStart();
        }

        return;
      }

      delete tableNavigationRef.current[tableId];
    },
    [blurEditorSelection],
  );

  const registerCodeBlockNavigation = useCallback(
    (codeBlockId: string, navigation: CodeBlockNavigationApi | null) => {
      if (navigation) {
        codeBlockNavigationRef.current[codeBlockId] = navigation;

        if (pendingCodeBlockFocusRef.current === codeBlockId) {
          pendingCodeBlockFocusRef.current = null;
          blurEditorSelection();
          navigation.focusStart();
        }

        return;
      }

      delete codeBlockNavigationRef.current[codeBlockId];
    },
    [blurEditorSelection],
  );

  const findTablePath = useCallback(
    (tableId: string) => {
      const index = editor.children.findIndex((node) => {
        if (!isParagraphNode(node)) return false;
        return (
          getTablePlaceholderId(Editor.string(editor, [editor.children.indexOf(node)])) === tableId
        );
      });

      return index >= 0 ? [index] : null;
    },
    [editor],
  );

  const findCodeBlockPath = useCallback(
    (codeBlockId: string) => {
      const index = editor.children.findIndex((node) => {
        if (!isParagraphNode(node)) return false;
        return (
          getCodeBlockPlaceholderId(Editor.string(editor, [editor.children.indexOf(node)])) ===
          codeBlockId
        );
      });

      return index >= 0 ? [index] : null;
    },
    [editor],
  );

  const moveCursorBeforeEmbeddedBlock = useCallback(
    (blockPath: Path) => {
      const previousIndex = blockPath[0] - 1;

      Editor.withoutNormalizing(editor, () => {
        if (previousIndex >= 0) {
          const previousNode = Node.get(editor, [previousIndex]);

          if (
            isParagraphNode(previousNode) &&
            !isEmbeddedBlockPlaceholder(Editor.string(editor, [previousIndex])) &&
            !isStandaloneImageParagraph(editor, [previousIndex])
          ) {
            Transforms.select(editor, Editor.end(editor, [previousIndex]));
            focusEditorAtCurrentSelection(editor);
            return;
          }
        }

        Transforms.insertNodes(editor, createParagraph(), { at: blockPath });
        Transforms.select(editor, Editor.start(editor, blockPath));
        focusEditorAtCurrentSelection(editor);
      });
    },
    [editor],
  );

  const moveCursorAfterEmbeddedBlock = useCallback(
    (blockPath: Path) => {
      const nextIndex = blockPath[0] + 1;

      Editor.withoutNormalizing(editor, () => {
        if (nextIndex < editor.children.length) {
          const nextNode = Node.get(editor, [nextIndex]);

          if (
            isParagraphNode(nextNode) &&
            !isEmbeddedBlockPlaceholder(Editor.string(editor, [nextIndex])) &&
            !isStandaloneImageParagraph(editor, [nextIndex])
          ) {
            const nextText = Editor.string(editor, [nextIndex]);
            Transforms.select(editor, Editor.start(editor, [nextIndex]));
            if (nextText.length > 0) {
              focusEditorAtCurrentSelection(editor);
            } else {
              focusEditorAtCurrentSelection(editor);
            }
            return;
          }
        }

        const insertionPath = Path.next(blockPath);
        Transforms.insertNodes(editor, createParagraph(), {
          at: insertionPath,
        });
        Transforms.select(editor, Editor.start(editor, insertionPath));
        focusEditorAtCurrentSelection(editor);
      });
    },
    [editor],
  );

  const moveCursorBeforeTable = useCallback(
    (tableId: string) => {
      const tablePath = findTablePath(tableId);
      if (!tablePath) return;

      moveCursorBeforeEmbeddedBlock(tablePath);
    },
    [findTablePath, moveCursorBeforeEmbeddedBlock],
  );

  const moveCursorAfterTable = useCallback(
    (tableId: string) => {
      const tablePath = findTablePath(tableId);
      if (!tablePath) return;

      moveCursorAfterEmbeddedBlock(tablePath);
    },
    [findTablePath, moveCursorAfterEmbeddedBlock],
  );

  const moveCursorBeforeCodeBlock = useCallback(
    (codeBlockId: string) => {
      const codeBlockPath = findCodeBlockPath(codeBlockId);
      if (!codeBlockPath) return;

      moveCursorBeforeEmbeddedBlock(codeBlockPath);
    },
    [findCodeBlockPath, moveCursorBeforeEmbeddedBlock],
  );

  const moveCursorAfterCodeBlock = useCallback(
    (codeBlockId: string) => {
      const codeBlockPath = findCodeBlockPath(codeBlockId);
      if (!codeBlockPath) return;

      moveCursorAfterEmbeddedBlock(codeBlockPath);
    },
    [findCodeBlockPath, moveCursorAfterEmbeddedBlock],
  );

  const focusTableFromAdjacentText = useCallback(
    (tableId: string, edge: "start" | "end") => {
      const navigation = tableNavigationRef.current[tableId];
      if (!navigation) return;

      blurEditorSelection();

      if (edge === "start") {
        navigation.focusFirstCellStart();
        return;
      }

      navigation.focusLastCellEnd();
    },
    [blurEditorSelection],
  );

  const focusCodeBlockFromAdjacentText = useCallback(
    (codeBlockId: string, edge: "start" | "end") => {
      const navigation = codeBlockNavigationRef.current[codeBlockId];
      if (!navigation) return;

      blurEditorSelection();

      if (edge === "start") {
        navigation.focusStart();
        return;
      }

      navigation.focusEnd();
    },
    [blurEditorSelection],
  );

  const focusEmbeddedBlockFromAdjacentText = useCallback(
    (text: string, edge: "start" | "end") => {
      const tableId = getTablePlaceholderId(text);
      if (tableId) {
        focusTableFromAdjacentText(tableId, edge);
        return true;
      }

      const codeBlockId = getCodeBlockPlaceholderId(text);
      if (codeBlockId) {
        focusCodeBlockFromAdjacentText(codeBlockId, edge);
        return true;
      }

      return false;
    },
    [focusCodeBlockFromAdjacentText, focusTableFromAdjacentText],
  );

  const getSelectedFindText = useCallback(() => {
    if (viewMode === "raw") {
      const textarea = rawTextareaRef.current;
      if (!textarea) {
        return "";
      }

      const startOffset = textarea.selectionStart ?? 0;
      const endOffset = textarea.selectionEnd ?? 0;
      if (startOffset === endOffset) {
        return "";
      }

      return textarea.value.slice(startOffset, endOffset);
    }

    if (viewMode !== "write" || !editor.selection || Range.isCollapsed(editor.selection)) {
      return "";
    }

    return Editor.string(editor, editor.selection);
  }, [editor, viewMode]);

  const focusFindInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = findInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      input.select();
    });
  }, []);

  const openFindReplace = useCallback(
    (expandReplace: boolean) => {
      const selectedText = getSelectedFindText();

      setFindReplaceOpen(true);
      setFindReplaceExpanded((previous) => previous || expandReplace);
      if (selectedText.length > 0) {
        setFindQuery(selectedText);
      }

      focusFindInput();
    },
    [focusFindInput, getSelectedFindText],
  );

  const handleFindSurfaceShortcut = useCallback(
    (event: {
      altKey: boolean;
      ctrlKey: boolean;
      key: string;
      metaKey: boolean;
      preventDefault: () => void;
      shiftKey: boolean;
    }) => {
      if (viewMode === "read") {
        return false;
      }

      if (isFindShortcut(event)) {
        event.preventDefault();
        openFindReplace(false);
        return true;
      }

      if (isReplaceShortcut(event)) {
        event.preventDefault();
        openFindReplace(true);
        return true;
      }

      return false;
    },
    [openFindReplace, viewMode],
  );

  const handleEditableKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (handleFindSurfaceShortcut(event)) {
        return;
      }

      if (viewMode !== "write") return;

      if (isSelectAllShortcut(event)) {
        event.preventDefault();

        const fullSelection = {
          anchor: Editor.start(editor, []),
          focus: Editor.end(editor, []),
        };

        Transforms.select(editor, fullSelection);
        setActiveSelection(fullSelection);
        setSelectionRenderVersion((previous) => previous + 1);
        focusEditorAtCurrentSelection(editor);
        return;
      }

      syncEditorSelectionFromDom(editor);

      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const jumpPoint = getLinkNavigationJump(
          editor,
          event.key === "ArrowLeft" ? "left" : "right",
        );

        if (jumpPoint) {
          event.preventDefault();

          const nextSelection =
            event.shiftKey && editor.selection
              ? {
                  anchor: editor.selection.anchor,
                  focus: jumpPoint,
                }
              : {
                  anchor: jumpPoint,
                  focus: jumpPoint,
                };

          Transforms.select(editor, nextSelection);
          setActiveSelection(nextSelection);
          setSelectionRenderVersion((previous) => previous + 1);

          focusEditorAtCurrentSelection(editor);
          return;
        }
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        editor.selection &&
        Range.isExpanded(editor.selection)
      ) {
        const expandedLinkRange = getExpandedLinkSelectionRange(editor);

        if (expandedLinkRange) {
          event.preventDefault();
          void replaceTextRange(expandedLinkRange, "");
          return;
        }
      }

      if (event.key === "Tab") {
        if (!handleEditorTab(editor, event.shiftKey)) return;

        event.preventDefault();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        if (!continueMarkdownList(editor)) return;

        event.preventDefault();
        return;
      }

      if (!editor.selection || !Range.isCollapsed(editor.selection)) return;

      const blockEntry = Editor.above(editor, {
        match: isParagraphNode,
      });

      if (!blockEntry) return;

      const [, blockPath] = blockEntry;
      const blockStart = Editor.start(editor, blockPath);
      const blockEnd = Editor.end(editor, blockPath);

      if (event.key === "Backspace") {
        const textBeforeSelection = Editor.string(editor, {
          anchor: blockStart,
          focus: editor.selection.anchor,
        });

        if (textBeforeSelection.length > 0) return;
        if (blockPath[0] === 0) return;

        const previousPath = [blockPath[0] - 1];
        const previousText = Editor.string(editor, previousPath);

        if (!isEmbeddedBlockPlaceholder(previousText)) return;

        event.preventDefault();
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      if (event.key === "ArrowRight") {
        const textAfterSelection = Editor.string(editor, {
          anchor: editor.selection.anchor,
          focus: blockEnd,
        });

        if (textAfterSelection.length > 0) return;
        if (blockPath[0] >= editor.children.length - 1) return;

        const nextPath = [blockPath[0] + 1];
        const nextText = Editor.string(editor, nextPath);
        if (isStandaloneImageParagraph(editor, nextPath)) {
          event.preventDefault();
          moveCursorAfterEmbeddedBlock(nextPath);
          return;
        }

        if (!focusEmbeddedBlockFromAdjacentText(nextText, "start")) return;

        event.preventDefault();
        return;
      }

      const textBeforeSelection = Editor.string(editor, {
        anchor: blockStart,
        focus: editor.selection.anchor,
      });

      if (textBeforeSelection.length > 0) return;
      if (blockPath[0] === 0) return;

      const previousPath = [blockPath[0] - 1];
      const previousText = Editor.string(editor, previousPath);
      if (isStandaloneImageParagraph(editor, previousPath)) {
        event.preventDefault();
        moveCursorBeforeEmbeddedBlock(previousPath);
        return;
      }

      if (!focusEmbeddedBlockFromAdjacentText(previousText, "end")) return;

      event.preventDefault();
    },
    [
      editor,
      focusEmbeddedBlockFromAdjacentText,
      handleFindSurfaceShortcut,
      moveCursorAfterEmbeddedBlock,
      moveCursorBeforeEmbeddedBlock,
      replaceTextRange,
      viewMode,
    ],
  );

  const handleRawKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      handleFindSurfaceShortcut(event);
    },
    [handleFindSurfaceShortcut],
  );

  const deleteEmbeddedBlockPlaceholder = useCallback(
    (placeholder: string) => {
      const content = value.map((node) => getNodeText(node)).join("\n");
      const nextContent = content
        .replace(placeholder, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/^\n+|\n+$/g, "");
      const nextValue =
        nextContent.length === 0
          ? blankDocumentValue
          : normalizeDocumentValue(nextContent.split("\n").map((line) => createParagraph(line)));
      const childPaths = Array.from(Node.children(editor, []))
        .map(([, path]) => path)
        .reverse();

      Editor.withoutNormalizing(editor, () => {
        for (const path of childPaths) {
          Transforms.removeNodes(editor, { at: path });
        }

        Transforms.insertNodes(editor, nextValue, { at: [0] });
        Transforms.select(editor, Editor.start(editor, [0]));
      });

      setValue(nextValue);
    },
    [editor, value],
  );

  const deleteTable = useCallback(
    (tableId: string) => {
      setTables((previous) => previous.filter((table) => table.id !== tableId));
      deleteEmbeddedBlockPlaceholder(`[TABLE:${tableId}]`);
    },
    [deleteEmbeddedBlockPlaceholder],
  );

  const deleteCodeBlock = useCallback(
    (codeBlockId: string) => {
      setCodeBlocks((previous) => previous.filter((codeBlock) => codeBlock.id !== codeBlockId));
      deleteEmbeddedBlockPlaceholder(`[CODEBLOCK:${codeBlockId}]`);
    },
    [deleteEmbeddedBlockPlaceholder],
  );

  const decorate = useCallback(
    ([node, path]: NodeEntry) => {
      if (!Text.isText(node)) {
        return [] satisfies Range[];
      }

      const text = node.text;
      const ranges = buildInlineMarkdownRanges(text, path);

      if (findReplaceOpen && viewMode === "write" && findQuery.length > 0) {
        for (const findMatch of findTextMatchRanges(text, findQuery)) {
          const isCurrentMatch =
            activeWriteFindMatch !== null &&
            Path.equals(activeWriteFindMatch.path, path) &&
            activeWriteFindMatch.startOffset === findMatch.startOffset &&
            activeWriteFindMatch.endOffset === findMatch.endOffset;

          ranges.push({
            anchor: { path, offset: findMatch.startOffset },
            currentFindMatch: isCurrentMatch,
            findMatch: true,
            focus: { path, offset: findMatch.endOffset },
          } as Range & {
            currentFindMatch: boolean;
            findMatch: boolean;
          });
        }
      }

      return ranges;
    },
    [activeWriteFindMatch, findQuery, findReplaceOpen, viewMode],
  );

  const handleRawMarkdownChange = useCallback(
    (nextMarkdown: string) => {
      const parsedDocument = parseDocumentContent(nextMarkdown, documentFormat);
      codeBlocksRef.current = parsedDocument.codeBlocks;
      tablesRef.current = parsedDocument.tables;
      setValue(normalizeDocumentValue(parsedDocument.value));
      setCodeBlocks(parsedDocument.codeBlocks);
      setTables(parsedDocument.tables);
      setTableRenderVersion((previous) => previous + 1);
      setShowTableSelector(false);
    },
    [documentFormat],
  );

  const handleViewModeChange = useCallback(
    (nextMode: ViewMode) => {
      if (documentFormat === "plain-text" && nextMode !== "raw") {
        setViewMode("raw");
        return;
      }

      if (viewMode === "write" && nextMode !== "write") {
        requestAnimationFrame(() => {
          flushSync(() => {
            setValue(normalizeDocumentValue(editor.children as Descendant[]));
            setViewMode(nextMode);
          });
        });
        return;
      }

      setViewMode(nextMode);
    },
    [documentFormat, editor, viewMode],
  );

  const revealWriteFindMatch = useCallback(
    (match: WriteFindMatch | null, focus = false) => {
      if (!match || !Node.has(editor, match.path)) {
        return false;
      }

      if (!focus) {
        requestAnimationFrame(() => {
          try {
            centerViewportOnRect(getEditorMatchRect(editor, match));
          } catch {
            // Ignore DOM range sync failures while the editor is reconciling.
          }
        });

        return true;
      }

      const nextSelection = {
        anchor: {
          path: match.path,
          offset: match.startOffset,
        },
        focus: {
          path: match.path,
          offset: match.endOffset,
        },
      };

      Transforms.select(editor, nextSelection);
      setActiveSelection(nextSelection);
      setSelectionRenderVersion((previous) => previous + 1);

      requestAnimationFrame(() => {
        centerEditorSelectionInViewport(editor, { focus });
      });

      return true;
    },
    [editor],
  );

  const revealRawFindMatch = useCallback((match: RawFindMatch | null, focus = false) => {
    const textarea = rawTextareaRef.current;
    if (!textarea || !match) {
      return false;
    }

    textarea.setSelectionRange(match.startOffset, match.endOffset);

    if (focus) {
      textarea.focus();
    }

    requestAnimationFrame(() => {
      centerTextareaSelectionInViewport(textarea);
    });

    return true;
  }, []);

  const closeFindReplace = useCallback(() => {
    setFindReplaceOpen(false);

    if (viewMode === "raw") {
      if (revealRawFindMatch(activeRawFindMatch, true)) {
        return;
      }

      rawTextareaRef.current?.focus();
      return;
    }

    if (viewMode === "write") {
      if (revealWriteFindMatch(activeWriteFindMatch, true)) {
        return;
      }

      requestAnimationFrame(() => {
        try {
          ReactEditor.focus(editor);
        } catch {
          // Ignore focus failures while the editor is reconciling.
        }
      });
    }
  }, [
    activeRawFindMatch,
    activeWriteFindMatch,
    editor,
    revealRawFindMatch,
    revealWriteFindMatch,
    viewMode,
  ]);

  const navigateFindMatches = useCallback(
    (direction: -1 | 1) => {
      if (activeFindMatchCount === 0) {
        return;
      }

      setActiveFindMatchIndex((previous) => {
        const nextIndex = previous + direction;

        if (nextIndex < 0) {
          return activeFindMatchCount - 1;
        }

        return nextIndex % activeFindMatchCount;
      });
    },
    [activeFindMatchCount],
  );

  const handleReplaceCurrentMatch = useCallback(() => {
    if (viewMode === "raw") {
      if (!activeRawFindMatch) {
        return;
      }

      const nextMarkdown = [
        currentMarkdown.slice(0, activeRawFindMatch.startOffset),
        replaceQuery,
        currentMarkdown.slice(activeRawFindMatch.endOffset),
      ].join("");
      handleRawMarkdownChange(nextMarkdown);
      return;
    }

    if (!activeWriteFindMatch) {
      return;
    }

    replaceTextRange(activeWriteFindMatch, replaceQuery, {
      focus: false,
    });
  }, [
    activeRawFindMatch,
    activeWriteFindMatch,
    currentMarkdown,
    handleRawMarkdownChange,
    replaceQuery,
    replaceTextRange,
    viewMode,
  ]);

  const handleReplaceAllMatches = useCallback(() => {
    if (viewMode === "raw") {
      if (rawFindMatches.length === 0) {
        return;
      }

      let nextMarkdown = currentMarkdown;
      for (const match of [...rawFindMatches].reverse()) {
        nextMarkdown = [
          nextMarkdown.slice(0, match.startOffset),
          replaceQuery,
          nextMarkdown.slice(match.endOffset),
        ].join("");
      }

      handleRawMarkdownChange(nextMarkdown);
      return;
    }

    replaceAllWriteMatches(writeFindMatches, replaceQuery);
  }, [
    currentMarkdown,
    handleRawMarkdownChange,
    rawFindMatches,
    replaceAllWriteMatches,
    replaceQuery,
    viewMode,
    writeFindMatches,
  ]);

  const handleFindInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (handleFindSurfaceShortcut(event)) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        navigateFindMatches(event.shiftKey ? -1 : 1);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeFindReplace();
      }
    },
    [closeFindReplace, handleFindSurfaceShortcut, navigateFindMatches],
  );

  const handleReplaceInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (handleFindSurfaceShortcut(event)) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        handleReplaceCurrentMatch();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeFindReplace();
      }
    },
    [closeFindReplace, handleFindSurfaceShortcut, handleReplaceCurrentMatch],
  );

  const handleOpenReplace = useCallback(() => {
    setFindReplaceExpanded(true);

    requestAnimationFrame(() => {
      replaceInputRef.current?.focus();
      replaceInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    if (!findReplaceOpen || viewMode !== "write") {
      return;
    }

    revealWriteFindMatch(activeWriteFindMatch, false);
  }, [activeWriteFindMatch, findReplaceOpen, revealWriteFindMatch, viewMode]);

  useEffect(() => {
    if (!findReplaceOpen || viewMode !== "raw") {
      return;
    }

    revealRawFindMatch(activeRawFindMatch, false);
  }, [activeRawFindMatch, findReplaceOpen, revealRawFindMatch, viewMode]);

  const saveEditedLink = useCallback(() => {
    if (!linkEditorState) return;

    const normalizedUrl = normalizeExternalUrl(linkEditorState.url);
    if (!normalizedUrl) return;

    const label = linkEditorState.label.trim() || normalizedUrl;
    const didReplace = replaceTextRange(linkEditorState, `[${label}](${normalizedUrl})`);

    if (didReplace) {
      setLinkEditorState(null);
    }
  }, [linkEditorState, replaceTextRange]);

  const saveEditedImage = useCallback(() => {
    if (!imageEditorState) return;

    const normalizedUrl = normalizeExternalUrl(imageEditorState.url);
    if (!normalizedUrl) return;

    const didReplace = replaceTextRange(
      imageEditorState,
      `![${imageEditorState.altText.trim()}](${normalizedUrl})`,
    );

    if (didReplace) {
      setImageEditorState(null);
    }
  }, [imageEditorState, replaceTextRange]);

  const renderElement = useCallback(
    (props: RenderElementProps) => {
      const text = props.element.children?.[0]?.text ?? "";
      const lineNumber = ReactEditor.findPath(editor, props.element)[0] + 1;
      const centeredBlockLineNumberClass = "top-1/2 -translate-y-1/2 items-center";
      const headingMatch = text.match(/^(#{1,6})\s+/);
      const headingSizes = ["text-4xl", "text-3xl", "text-2xl", "text-xl", "text-lg", "text-base"];
      const headingClassName = headingMatch
        ? `mb-2 mt-4 font-bold ${headingSizes[(headingMatch[1]?.length ?? 1) - 1]}`
        : "";
      const tableMatch = text.trim().match(/^\[TABLE:(table-[a-z0-9-]+)\]$/i);
      const codeBlockMatch = text.trim().match(/^\[CODEBLOCK:(code-block-[a-z0-9-]+)\]$/i);
      const imageMatch = getStandaloneImageMarkdownMatch(text);

      if (tableMatch && viewMode === "write") {
        const tableId = tableMatch[1];
        const table = renderTables.find((currentTable) => currentTable.id === tableId);

        if (table) {
          return (
            <div {...props.attributes} className="relative" contentEditable={false}>
              {showLineNumbers ? (
                <LineNumberGutter
                  className={centeredBlockLineNumberClass}
                  lineNumber={lineNumber}
                />
              ) : null}
              <TableEditor
                initialData={table.data}
                onChange={(data) => updateTable(tableId, data)}
                onDelete={() => deleteTable(tableId)}
                onExitAfterEnd={() => moveCursorAfterTable(tableId)}
                onExitLeftFromStart={() => moveCursorBeforeTable(tableId)}
                onFocusTable={blurEditorSelection}
                onRegisterNavigation={(navigation) => registerTableNavigation(tableId, navigation)}
                readOnly={false}
              />
              <span style={{ display: "none" }}>{props.children}</span>
            </div>
          );
        }
      }

      if (codeBlockMatch && viewMode === "write") {
        const codeBlockId = codeBlockMatch[1];
        const codeBlock = codeBlocks.find(
          (currentCodeBlock) => currentCodeBlock.id === codeBlockId,
        );

        if (codeBlock) {
          return (
            <div {...props.attributes} className="relative" contentEditable={false}>
              {showLineNumbers ? (
                <LineNumberGutter
                  className={centeredBlockLineNumberClass}
                  lineNumber={lineNumber}
                />
              ) : null}
              <CodeBlockEditor
                code={codeBlock.code}
                language={codeBlock.language}
                onChange={(code) => updateCodeBlock(codeBlockId, code)}
                onDelete={() => deleteCodeBlock(codeBlockId)}
                onExitAfterEnd={() => moveCursorAfterCodeBlock(codeBlockId)}
                onExitLeftFromStart={() => moveCursorBeforeCodeBlock(codeBlockId)}
                onFocusCodeBlock={blurEditorSelection}
                onLanguageChange={(language) => updateCodeBlockLanguage(codeBlockId, language)}
                onRegisterNavigation={(navigation) =>
                  registerCodeBlockNavigation(codeBlockId, navigation)
                }
                readOnly={false}
              />
              <span style={{ display: "none" }}>{props.children}</span>
            </div>
          );
        }
      }

      if (imageMatch && viewMode === "write") {
        const imagePath = ReactEditor.findPath(editor, props.element);
        const imageTextPath = [...imagePath, 0] as Path;

        return (
          <WriteModeImageBlock
            altText={imageMatch[1] ?? ""}
            attributes={props.attributes}
            lineNumber={showLineNumbers ? lineNumber : undefined}
            onEdit={() => {
              setImageEditorState({
                altText: imageMatch[1] ?? "",
                endOffset: text.length,
                path: imageTextPath,
                startOffset: 0,
                url: imageMatch[2] ?? "",
              });
            }}
            url={imageMatch[2] ?? ""}
          >
            {props.children}
          </WriteModeImageBlock>
        );
      }

      return (
        <p
          {...props.attributes}
          className={`relative [overflow-wrap:anywhere] ${headingClassName}`.trim()}
        >
          {showLineNumbers ? (
            <LineNumberGutter
              className={headingMatch ? "top-1/2 -translate-y-1/2 items-center" : undefined}
              lineNumber={lineNumber}
            />
          ) : null}
          {props.children}
        </p>
      );
    },
    [
      blurEditorSelection,
      codeBlocks,
      deleteCodeBlock,
      deleteTable,
      editor,
      moveCursorAfterCodeBlock,
      moveCursorAfterTable,
      moveCursorBeforeCodeBlock,
      moveCursorBeforeTable,
      registerCodeBlockNavigation,
      registerTableNavigation,
      renderTables,
      showLineNumbers,
      updateCodeBlock,
      updateCodeBlockLanguage,
      updateTable,
      viewMode,
    ],
  );

  const renderLeaf = useCallback(
    (props: RenderLeafProps) => {
      const leaf = props.leaf as RenderLeafProps["leaf"] & {
        hiddenMarkdown?: boolean;
        linkLabel?: string;
        linkPreview?: boolean;
        linkUrl?: string;
        previewEndOffset?: number;
        previewPath?: Path;
        previewStartOffset?: number;
      };
      const previewPath = leaf.previewPath;

      if (leaf.hiddenMarkdown) {
        return (
          <span
            {...props.attributes}
            aria-hidden
            className="pointer-events-none select-none opacity-0"
            style={{ fontSize: 0, lineHeight: 0 }}
          >
            {props.children}
          </span>
        );
      }

      if (
        leaf.linkPreview &&
        typeof leaf.linkLabel === "string" &&
        typeof leaf.linkUrl === "string" &&
        Array.isArray(previewPath) &&
        typeof leaf.previewStartOffset === "number" &&
        typeof leaf.previewEndOffset === "number"
      ) {
        const currentSelection = activeSelection;

        if (currentSelection && Range.isExpanded(currentSelection)) {
          return defaultRenderLeaf(props);
        }

        return (
          <WriteModeLinkLeaf
            attributes={props.attributes}
            label={leaf.linkLabel}
            onEdit={() => {
              setLinkEditorState({
                endOffset: leaf.previewEndOffset as number,
                label: leaf.linkLabel as string,
                path: [...previewPath] as Path,
                startOffset: leaf.previewStartOffset as number,
                url: leaf.linkUrl as string,
              });
            }}
            previewEndOffset={leaf.previewEndOffset as number}
            previewPathKey={(previewPath as Path).join(".")}
            previewStartOffset={leaf.previewStartOffset as number}
            url={leaf.linkUrl}
          >
            {props.children}
          </WriteModeLinkLeaf>
        );
      }

      return defaultRenderLeaf(props);
    },
    [activeSelection, selectionRenderVersion],
  );

  useEffect(() => {
    saveDraft({
      codeBlocks,
      version: 2,
      title,
      value,
      tables,
    });
  }, [codeBlocks, tables, title, value]);

  useEffect(() => {
    saveWorkspaceSettings({
      autosaveEnabled,
      currentFileName: currentFilePath,
      lastSavedFingerprint,
      bridgeEnabled,
      pageWidthMode,
      showLineNumbers,
      sidebarCollapsed,
      sidebarSide,
      storageMode: fileStorageMode,
    });
  }, [
    autosaveEnabled,
    currentFilePath,
    fileStorageMode,
    lastSavedFingerprint,
    bridgeEnabled,
    pageWidthMode,
    showLineNumbers,
    sidebarCollapsed,
    sidebarSide,
  ]);

  useApplyAppearanceSettings(appearanceSettings);

  const saveBlockedByExternalConflict =
    externalFileConflict !== null && !externalFileConflict.acknowledged;
  const sidebarDesktopOffsetClass = getSidebarDesktopOffsetClass(sidebarSide, sidebarCollapsed);
  const isInitializingRootDirectory = !("" in treeEntriesByPath);

  return (
    <div className="min-h-screen bg-background">
      <div data-page-width={pageWidthMode} data-testid="app-shell">
        <div className={`flex min-h-screen flex-col ${sidebarDesktopOffsetClass}`}>
          <FileSidebar
            collapsed={sidebarCollapsed}
            currentFilePath={currentFilePath}
            entriesByPath={treeEntriesByPath}
            errorMessage={fileError}
            expandedDirectories={expandedDirectories}
            folderName={nativeDirectoryHandle?.name ?? null}
            hasUnsavedChanges={hasUnsavedChanges}
            isInitializingRoot={isInitializingRootDirectory}
            loadingPaths={loadingDirectoryPaths}
            nativeFolderSupported={nativeFolderSupported}
            onChangeFolder={chooseNativeFolder}
            onCollapsedChange={setSidebarCollapsed}
            onCreateFolder={() => {
              void createFolderInTree();
            }}
            onDeleteSelected={() => {
              void deleteSelectedPath();
            }}
            onExportCurrentFile={exportCurrentFileToDisk}
            onExportWorkspace={() => {
              void exportWorkspaceToDisk();
            }}
            onMovePath={(sourcePath, destinationDirectoryPath) => {
              void moveTreePath(sourcePath, destinationDirectoryPath);
            }}
            onNewFile={createNewFile}
            onOpenFile={(filePath) => {
              void loadDocumentFromFile(filePath);
            }}
            onRenameSelected={() => {
              void renameSelectedPath();
            }}
            onSave={() => {
              void persistCurrentFile();
            }}
            onSaveAs={() => {
              void persistCurrentFile(null);
            }}
            onToggleDirectory={(directoryPath) => {
              void handleToggleDirectory(directoryPath);
            }}
            selectedPath={selectedTreePath}
            saveDisabled={saveBlockedByExternalConflict}
            side={sidebarSide}
            storageMode={fileStorageMode}
          />

          <div className="min-w-0 flex-1 px-6 pt-8 pb-28 lg:px-8 lg:pt-8 lg:pb-8">
            <div className={getPageWidthClass(pageWidthMode)} data-testid="page-width-container">
              <div className="mb-4 flex items-center justify-between gap-4">
                <BrandNavigation />
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    aria-label="Open settings"
                    data-testid="open-settings"
                    onClick={() => setShowSettingsDialog(true)}
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                  <ModeToggle />
                </div>
              </div>

              <div className="sticky top-0 z-30 mb-4">
                <div className="relative -mx-2 overflow-visible bg-gradient-to-b from-background via-background/95 to-background/75 px-2 pt-2 pb-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                  <EditorToolbar
                    documentFormat={documentFormat}
                    editor={editor}
                    onInsertCodeBlock={() => insertCodeBlock()}
                    onInsertTable={insertTable}
                    setShowTableSelector={setShowTableSelector}
                    showTableSelector={showTableSelector}
                    viewMode={viewMode}
                    onViewModeChange={handleViewModeChange}
                  />

                  {findReplaceOpen && viewMode !== "read" ? (
                    <div className="pointer-events-none absolute top-full right-2 z-20 flex justify-end">
                      <div
                        className="pointer-events-auto flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 rounded-xl border border-border bg-background/95 p-1 shadow-lg backdrop-blur sm:w-96"
                        data-testid="editor-find-replace"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            ref={findInputRef}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground"
                            data-testid="editor-find-input"
                            onChange={(event) => setFindQuery(event.target.value)}
                            onKeyDown={handleFindInputKeyDown}
                            placeholder="Find"
                            type="text"
                            value={findQuery}
                          />
                          <Button
                            aria-label="Close find and replace"
                            data-testid="editor-find-close"
                            onClick={closeFindReplace}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className="text-xs font-medium text-muted-foreground"
                            data-testid="editor-find-count"
                          >
                            {findMatchSummary}
                          </span>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              data-testid="editor-find-previous"
                              disabled={activeFindMatchCount === 0}
                              onClick={() => navigateFindMatches(-1)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Prev
                            </Button>
                            <Button
                              data-testid="editor-find-next"
                              disabled={activeFindMatchCount === 0}
                              onClick={() => navigateFindMatches(1)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Next
                            </Button>
                            <Button
                              data-testid="editor-toggle-replace"
                              onClick={() => {
                                if (findReplaceExpanded) {
                                  setFindReplaceExpanded(false);
                                  focusFindInput();
                                  return;
                                }

                                handleOpenReplace();
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              {findReplaceExpanded ? "Hide replace" : "Replace"}
                            </Button>
                          </div>
                        </div>

                        {findReplaceExpanded ? (
                          <div className="flex flex-col gap-2 border-t border-border/70 pt-2">
                            <input
                              ref={replaceInputRef}
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground"
                              data-testid="editor-replace-input"
                              onChange={(event) => setReplaceQuery(event.target.value)}
                              onKeyDown={handleReplaceInputKeyDown}
                              placeholder="Replace"
                              type="text"
                              value={replaceQuery}
                            />
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                data-testid="editor-replace"
                                disabled={activeFindMatchCount === 0}
                                onClick={handleReplaceCurrentMatch}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                Replace
                              </Button>
                              <Button
                                data-testid="editor-replace-all"
                                disabled={activeFindMatchCount === 0}
                                onClick={handleReplaceAllMatches}
                                size="sm"
                                type="button"
                              >
                                Replace All
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="relative">
                <EditorContent
                  codeBlocks={codeBlocks}
                  currentMarkdown={currentMarkdown}
                  decorate={decorate}
                  editor={editor}
                  onEditorChange={handleEditorChange}
                  onEditorFocus={handleEditorFocus}
                  onRawMarkdownChange={handleRawMarkdownChange}
                  onRawKeyDown={handleRawKeyDown}
                  onTitleChange={setTitle}
                  onEditableKeyDown={handleEditableKeyDown}
                  rawTextareaRef={rawTextareaRef}
                  renderElement={renderElement}
                  renderLeaf={renderLeaf}
                  showLineNumbers={showLineNumbers}
                  tables={tables}
                  title={title}
                  value={value}
                  viewMode={viewMode}
                />
              </div>

              {externalFileConflict ? (
                <BottomFlashbar
                  className="border-amber-500/30 bg-background/92 text-foreground"
                  testId="disk-conflict-banner"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        This file changed on disk while it was open.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {externalFileConflict.acknowledged
                          ? "Overwrite is allowed for this disk version until the file changes again."
                          : "Save and autosave are paused until you open the disk version or explicitly allow overwrite."}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        data-testid="disk-conflict-open-disk"
                        onClick={() => {
                          loadCurrentFileFromDisk(
                            externalFileConflict.filePath,
                            externalFileConflict.diskMarkdown,
                          );
                        }}
                        type="button"
                        variant="outline"
                      >
                        Open disk version
                      </Button>
                      <Button
                        data-testid="disk-conflict-acknowledge"
                        onClick={() => {
                          setExternalFileConflict((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  acknowledged: true,
                                }
                              : previous,
                          );
                        }}
                        type="button"
                        variant={externalFileConflict.acknowledged ? "secondary" : "default"}
                      >
                        {externalFileConflict.acknowledged
                          ? "Overwrite allowed"
                          : "Allow overwrite"}
                      </Button>
                    </div>
                  </div>
                </BottomFlashbar>
              ) : bridgeFlashbar ? (
                <BottomFlashbar
                  className="border-emerald-500/25 bg-background/88 text-foreground"
                  testId="bridge-update-flashbar"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        {bridgeFlashbar.action === "apply_markdown_edits"
                          ? "Bridge edits applied."
                          : "Document updated from the bridge."}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {bridgeFlashbar.action === "apply_markdown_edits"
                          ? "Your connected agent made targeted edits. Review them here when you’re ready."
                          : "Your connected agent replaced the current document. Review the updated content when you’re ready."}
                      </p>
                    </div>
                    <Button
                      aria-label="Dismiss bridge update message"
                      onClick={() => setBridgeFlashbar(null)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <X />
                    </Button>
                  </div>
                </BottomFlashbar>
              ) : null}
            </div>
          </div>
        </div>

        <InlineEditorDialog
          description="Edit the link preview shown in write mode without switching to raw markdown."
          onClose={() => setLinkEditorState(null)}
          open={linkEditorState !== null}
          testId="link-editor-dialog"
          title="Edit Link"
        >
          {linkEditorState ? (
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-popover-foreground">Link text</span>
                <input
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-0 transition-colors focus:border-foreground"
                  data-testid="link-editor-label-input"
                  onChange={(event) =>
                    setLinkEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            label: event.target.value,
                          }
                        : previous,
                    )
                  }
                  type="text"
                  value={linkEditorState.label}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-popover-foreground">URL</span>
                <input
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-0 transition-colors focus:border-foreground"
                  data-testid="link-editor-url-input"
                  onChange={(event) =>
                    setLinkEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            url: event.target.value,
                          }
                        : previous,
                    )
                  }
                  type="url"
                  value={linkEditorState.url}
                />
              </label>

              <div className="flex justify-end gap-2">
                <Button onClick={() => setLinkEditorState(null)} type="button" variant="ghost">
                  Cancel
                </Button>
                <Button
                  data-testid="link-editor-save"
                  disabled={!normalizeExternalUrl(linkEditorState.url)}
                  onClick={saveEditedLink}
                  type="button"
                >
                  Save link
                </Button>
              </div>
            </div>
          ) : null}
        </InlineEditorDialog>

        <InlineEditorDialog
          description="Adjust the image URL or alt text while keeping the write mode preview visible."
          onClose={() => setImageEditorState(null)}
          open={imageEditorState !== null}
          testId="image-editor-dialog"
          title="Edit Image"
        >
          {imageEditorState ? (
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-popover-foreground">Image URL</span>
                <input
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-0 transition-colors focus:border-foreground"
                  data-testid="image-editor-url-input"
                  onChange={(event) =>
                    setImageEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            url: event.target.value,
                          }
                        : previous,
                    )
                  }
                  type="url"
                  value={imageEditorState.url}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-popover-foreground">Alt text</span>
                <input
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-0 transition-colors focus:border-foreground"
                  data-testid="image-editor-alt-input"
                  onChange={(event) =>
                    setImageEditorState((previous) =>
                      previous
                        ? {
                            ...previous,
                            altText: event.target.value,
                          }
                        : previous,
                    )
                  }
                  type="text"
                  value={imageEditorState.altText}
                />
              </label>

              <div className="flex justify-end gap-2">
                <Button onClick={() => setImageEditorState(null)} type="button" variant="ghost">
                  Cancel
                </Button>
                <Button
                  data-testid="image-editor-save"
                  disabled={!normalizeExternalUrl(imageEditorState.url)}
                  onClick={saveEditedImage}
                  type="button"
                >
                  Save image
                </Button>
              </div>
            </div>
          ) : null}
        </InlineEditorDialog>

        <SettingsDialog
          autosaveEnabled={autosaveEnabled}
          bridgePanel={bridgePanel}
          fontPresets={fontPresets}
          hasSavedFile={currentFilePath !== null}
          layoutSettings={{ showLineNumbers }}
          bridgeEnabled={bridgeEnabled}
          nativeFolderName={nativeDirectoryHandle?.name ?? null}
          nativeFolderSupported={nativeFolderSupported}
          open={showSettingsDialog}
          pageWidthMode={pageWidthMode}
          sidebarSide={sidebarSide}
          settings={appearanceSettings}
          storageMode={fileStorageMode}
          onAutosaveEnabledChange={setAutosaveEnabled}
          onLayoutSettingsChange={(settings) => {
            setShowLineNumbers(settings.showLineNumbers);
          }}
          onBridgeEnabledChange={setBridgeEnabled}
          onOpenChange={setShowSettingsDialog}
          onPageWidthModeChange={setPageWidthMode}
          onRequestNativeFolder={() => {
            void chooseNativeFolder();
          }}
          onSidebarSideChange={setSidebarSide}
          onSettingsChange={setAppearanceSettings}
          onStorageModeChange={(mode) => {
            void handleStorageModeChange(mode);
          }}
        />
      </div>
    </div>
  );
}
