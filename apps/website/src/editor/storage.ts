import type { AppearanceSettings } from "../components/settings-dialog";
import {
  appearanceStorageKey,
  blankDocumentValue,
  defaultAutosaveEnabled,
  defaultMcpEnabled,
  defaultPageWidthMode,
  defaultShowLineNumbers,
  defaultSidebarCollapsed,
  draftStorageKey,
  initialCodeBlocksValue,
  initialTablesValue,
  initialValue,
  starterTitle,
  workspaceStorageKey,
} from "./constants";
import type { LegacyStoredDraft, StoredDraft, WorkspaceSettings } from "./types";

function isLegacyStoredDraft(value: unknown): value is LegacyStoredDraft {
  if (!value || typeof value !== "object") return false;

  const draft = value as Partial<LegacyStoredDraft>;

  return (
    draft.version === 1 &&
    typeof draft.title === "string" &&
    Array.isArray(draft.value) &&
    draft.value.length > 0
  );
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== "object") return false;

  const draft = value as Partial<StoredDraft>;

  return (
    draft.version === 2 &&
    typeof draft.title === "string" &&
    Array.isArray(draft.value) &&
    draft.value.length > 0 &&
    Array.isArray(draft.tables) &&
    (typeof draft.codeBlocks === "undefined" || Array.isArray(draft.codeBlocks))
  );
}

function migrateDraft(draft: LegacyStoredDraft): StoredDraft {
  return {
    codeBlocks: [],
    version: 2,
    title: draft.title,
    value: draft.value,
    tables: [],
  };
}

export function loadDraft(): StoredDraft | null {
  try {
    const storedDraft = window.localStorage.getItem(draftStorageKey);
    if (!storedDraft) return null;

    const parsedDraft = JSON.parse(storedDraft) as unknown;

    if (isStoredDraft(parsedDraft)) {
      return {
        ...parsedDraft,
        codeBlocks: Array.isArray(parsedDraft.codeBlocks) ? parsedDraft.codeBlocks : [],
      };
    }

    if (isLegacyStoredDraft(parsedDraft)) {
      return migrateDraft(parsedDraft);
    }

    return null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: StoredDraft) {
  try {
    const matchesStarterDraft =
      draft.title === starterTitle &&
      JSON.stringify(draft.value) === JSON.stringify(initialValue) &&
      JSON.stringify(draft.tables) === JSON.stringify(initialTablesValue) &&
      JSON.stringify(draft.codeBlocks) === JSON.stringify(initialCodeBlocksValue);
    const matchesBlankDraft =
      draft.title.trim().length === 0 &&
      JSON.stringify(draft.value) === JSON.stringify(blankDocumentValue) &&
      draft.tables.length === 0 &&
      draft.codeBlocks.length === 0;

    if (matchesStarterDraft || matchesBlankDraft) {
      window.localStorage.removeItem(draftStorageKey);
      return;
    }

    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  } catch {
    // Ignore storage failures so the editor remains usable in private mode or restricted environments.
  }
}

function isAppearanceSettings(value: unknown): value is AppearanceSettings {
  if (!value || typeof value !== "object") return false;

  const settings = value as Partial<AppearanceSettings>;

  return (
    typeof settings.baseFontSize === "number" &&
    typeof settings.fontPresetId === "string" &&
    Number.isFinite(settings.baseFontSize)
  );
}

export function loadAppearance(): AppearanceSettings | null {
  try {
    const storedAppearance = window.localStorage.getItem(appearanceStorageKey);
    if (!storedAppearance) return null;

    const parsedAppearance = JSON.parse(storedAppearance) as unknown;
    return isAppearanceSettings(parsedAppearance) ? parsedAppearance : null;
  } catch {
    return null;
  }
}

export function saveAppearance(settings: AppearanceSettings) {
  try {
    window.localStorage.setItem(appearanceStorageKey, JSON.stringify(settings));
  } catch {
    // Ignore storage failures so appearance controls remain optional.
  }
}

function isWorkspaceSettings(value: unknown): value is WorkspaceSettings {
  if (!value || typeof value !== "object") return false;

  const settings = value as Partial<WorkspaceSettings>;

  return (
    (typeof settings.autosaveEnabled === "boolean" ||
      typeof settings.autosaveEnabled === "undefined") &&
    (settings.currentFileName === null || typeof settings.currentFileName === "string") &&
    (settings.lastSavedFingerprint === null || typeof settings.lastSavedFingerprint === "string") &&
    (typeof settings.bridgeEnabled === "boolean" ||
      typeof settings.bridgeEnabled === "undefined" ||
      typeof (settings as any).mcpEnabled === "boolean") &&
    (settings.pageWidthMode === "fill" ||
      settings.pageWidthMode === "responsive" ||
      typeof settings.pageWidthMode === "undefined") &&
    (typeof settings.showLineNumbers === "boolean" ||
      typeof settings.showLineNumbers === "undefined") &&
    (typeof settings.sidebarCollapsed === "boolean" ||
      typeof settings.sidebarCollapsed === "undefined") &&
    (settings.sidebarSide === "left" || settings.sidebarSide === "right") &&
    (settings.storageMode === "origin-private" || settings.storageMode === "native-folder")
  );
}

export function loadWorkspaceSettings(): WorkspaceSettings | null {
  try {
    const storedWorkspace = window.localStorage.getItem(workspaceStorageKey);
    if (!storedWorkspace) return null;

    const parsedWorkspace = JSON.parse(storedWorkspace) as unknown;
    if (!isWorkspaceSettings(parsedWorkspace)) {
      return null;
    }

    return {
      ...parsedWorkspace,
      autosaveEnabled:
        typeof parsedWorkspace.autosaveEnabled === "boolean"
          ? parsedWorkspace.autosaveEnabled
          : defaultAutosaveEnabled,
      bridgeEnabled:
        typeof parsedWorkspace.bridgeEnabled === "boolean"
          ? parsedWorkspace.bridgeEnabled
          : typeof (parsedWorkspace as any).mcpEnabled === "boolean"
            ? (parsedWorkspace as any).mcpEnabled
            : defaultMcpEnabled,
      pageWidthMode:
        parsedWorkspace.pageWidthMode === "fill" || parsedWorkspace.pageWidthMode === "responsive"
          ? parsedWorkspace.pageWidthMode
          : defaultPageWidthMode,
      showLineNumbers:
        typeof parsedWorkspace.showLineNumbers === "boolean"
          ? parsedWorkspace.showLineNumbers
          : defaultShowLineNumbers,
      sidebarCollapsed:
        typeof parsedWorkspace.sidebarCollapsed === "boolean"
          ? parsedWorkspace.sidebarCollapsed
          : defaultSidebarCollapsed,
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceSettings(settings: WorkspaceSettings) {
  try {
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(settings));
  } catch {
    // Ignore storage failures so workspace preferences remain optional.
  }
}
