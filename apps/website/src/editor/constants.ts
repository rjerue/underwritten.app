import type { Descendant } from "slate";

import type { SidebarSide } from "../components/file-sidebar";
import type { AppearanceSettings, FontPreset, PageWidthMode } from "../components/settings-dialog";
import type { FileStorageMode } from "../lib/file-system";

export const draftStorageKey = "underwritten.markdown-editor.draft";
export const appearanceStorageKey = "underwritten.markdown-editor.appearance";
export const workspaceStorageKey = "underwritten.markdown-editor.workspace";
export const defaultTitle = "Untitled Document";
export const defaultSidebarCollapsed = false;
export const defaultSidebarSide: SidebarSide = "left";
export const defaultPageWidthMode: PageWidthMode = "responsive";
export const defaultStorageMode: FileStorageMode = "origin-private";
export const defaultAutosaveEnabled = false;
export const defaultMcpEnabled = true;
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
        text: "Start writing your **markdown** content here with _italic_ and `code` formatting!",
      },
    ],
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
