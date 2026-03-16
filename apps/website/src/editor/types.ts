import type { BaseEditor, Descendant } from "slate";
import type { HistoryEditor } from "slate-history";
import type { ReactEditor } from "slate-react";

import type { SidebarSide } from "../components/file-sidebar";
import type { AppearanceSettings, FontPreset, PageWidthMode } from "../components/settings-dialog";
import type { FileStorageMode } from "../lib/file-system";

export type ViewMode = "write" | "read" | "raw";

export type TableData = {
  id: string;
  data: string[][];
  position: number;
};

export type CodeBlockData = {
  code: string;
  id: string;
  language: string | null;
  position: number;
};

export type CustomElement = {
  type: "paragraph";
  children: CustomText[];
};

export type CustomText = {
  text: string;
};

export type LegacyStoredDraft = {
  version: 1;
  title: string;
  value: Descendant[];
};

export type StoredDraft = {
  codeBlocks: CodeBlockData[];
  version: 2;
  title: string;
  value: Descendant[];
  tables: TableData[];
};

export type WorkspaceSettings = {
  autosaveEnabled: boolean;
  currentFileName: string | null;
  lastSavedFingerprint: string | null;
  mcpEnabled: boolean;
  pageWidthMode: PageWidthMode;
  showLineNumbers: boolean;
  sidebarCollapsed: boolean;
  sidebarSide: SidebarSide;
  storageMode: FileStorageMode;
};

export type EditorFontPreset = FontPreset;
export type EditorAppearanceSettings = AppearanceSettings;

declare module "slate" {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
