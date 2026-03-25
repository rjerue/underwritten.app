import type { Descendant } from "slate";

import type { SidebarSide } from "../components/file-sidebar";
import type { AppearanceSettings, FontPreset, PageWidthMode } from "../components/settings-dialog";
import type { FileStorageMode } from "../lib/file-system";
import type { CodeBlockData, TableData } from "./types";

export const draftStorageKey = "underwritten.markdown-editor.draft";
export const appearanceStorageKey = "underwritten.markdown-editor.appearance";
export const workspaceStorageKey = "underwritten.markdown-editor.workspace";
export const defaultTitle = "Untitled Document";
export const starterTitle = "Welcome!";
export const defaultSidebarCollapsed = false;
export const defaultSidebarSide: SidebarSide = "left";
export const defaultPageWidthMode: PageWidthMode = "responsive";
export const defaultStorageMode: FileStorageMode = "origin-private";
export const defaultAutosaveEnabled = false;
export const defaultMcpEnabled = false;
export const defaultShowLineNumbers = false;
export const autosaveDelayMs = 800;
export const defaultAppearance: AppearanceSettings = {
  baseFontSize: 16,
  fontPresetId: "modern",
};
export const blankDocumentValue: Descendant[] = [
  {
    type: "paragraph",
    children: [{ text: "" }],
  },
];
export const initialValue: Descendant[] = [
  {
    type: "paragraph",
    children: [
      {
        text: "# Welcome to Underwritten",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "This starter document shows real Underwritten features, not placeholder copy.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "Use **bold**, _italic_, `inline code`, and [links](https://github.com/rjerue/underwritten.app) while you draft.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "## What Underwritten includes",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "- Local-first drafts in browser storage or a folder you choose",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "- Editable markdown tables that stay structured in write mode",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "- Fenced code blocks with language-aware editing and diagram previews",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "- A local Agent Bridge for the Underwritten CLI and MCP clients",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "## Write, read, and raw",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "The table below explains what each mode is for.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "[TABLE:table-starter-modes]",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "## Diagram preview example",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "This Mermaid block opens in write mode as an editable code block with a preview tab.",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "[CODEBLOCK:code-block-starter-mermaid]",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "",
      },
    ],
  },
  {
    type: "paragraph",
    children: [
      {
        text: "> Switch modes to see the same document as an editor, a reader, and plain markdown.",
      },
    ],
  },
];
export const initialTablesValue: TableData[] = [
  {
    data: [
      ["Mode", "Best for", "What you get"],
      [
        "write",
        "Drafting and editing",
        "Markdown shortcuts plus editable tables, links, images, and code blocks",
      ],
      [
        "read",
        "Reviewing the rendered document",
        "Formatted headings, lists, tables, images, and diagram previews without editor chrome",
      ],
      [
        "raw",
        "Working directly in markdown",
        "The underlying markdown text exactly as it will save to disk",
      ],
    ],
    id: "table-starter-modes",
    position: 0,
  },
];
export const initialCodeBlocksValue: CodeBlockData[] = [
  {
    code: `flowchart LR
    Write[Write mode] --> Read[Read mode]
    Read --> Raw[Raw mode]
    Raw --> Write`,
    id: "code-block-starter-mermaid",
    language: "mermaid",
    position: 0,
  },
];
export const fontPresets: FontPreset[] = [
  {
    id: "modern",
    label: "Modern",
    sans: '"Avenir Next", "Segoe UI", sans-serif',
    mono: '"SF Mono", "JetBrains Mono", monospace',
    preview: "Clean and balanced",
  },
  {
    id: "editorial",
    label: "Editorial",
    sans: '"Iowan Old Style", Georgia, serif',
    mono: '"IBM Plex Mono", "SF Mono", monospace',
    preview: "Classic and literary",
  },
  {
    id: "technical",
    label: "Technical",
    sans: '"Helvetica Neue", Arial, sans-serif',
    mono: '"JetBrains Mono", "SF Mono", monospace',
    preview: "Sharp and utilitarian",
  },
];
