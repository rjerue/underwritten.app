export const underwrittenBridgePortRange = {
  end: 45271,
  start: 45261,
} as const;

export const underwrittenBridgeApiVersion = "2026-03-16";
export const underwrittenBridgeSessionTtlMs = 15_000;
export const underwrittenBridgePollIntervalMs = 1_000;
export const underwrittenBridgeActionTimeoutMs = 20_000;

export type UnderwrittenStorageMode = "origin-private" | "native-folder";

export type MarkdownEditTarget = {
  occurrence?: number;
  text: string;
};

export type MarkdownEdit = {
  newText?: string;
  target: MarkdownEditTarget;
  type: "delete" | "insert_after" | "insert_before" | "replace";
};

export type WorkspaceStatus = {
  activeFilePath: string | null;
  hasNativeFolderSelected: boolean;
  hasUnsavedChanges: boolean;
  storageMode: UnderwrittenStorageMode;
};

export type MarkdownOutlineItem = {
  depth: number;
  line: number;
  text: string;
};

export type CurrentDocument = {
  dirty: boolean;
  filePath: string | null;
  markdown: string;
  outline?: MarkdownOutlineItem[];
  storageMode: UnderwrittenStorageMode;
  title: string;
};

export type BridgeSessionCapabilities = {
  supportsDirectoryAccess: boolean;
};

export type BridgeSessionState = {
  activeFilePath: string | null;
  appCapabilities: BridgeSessionCapabilities;
  dirty: boolean;
  lastFocusAt: number | null;
  lastHeartbeatAt: number;
  markdown: string;
  nativeFolderSelected: boolean;
  pageUrl: string | null;
  revision: string | null;
  sessionId: string;
  storageMode: UnderwrittenStorageMode;
  title: string;
  visibilityState: "hidden" | "visible";
  windowLabel: string | null;
};

export type GetWorkspaceStatusAction = {
  id: string;
  type: "get_workspace_status";
};

export type ListFilesAction = {
  id: string;
  includeDirectories?: boolean;
  path?: string;
  recursive?: boolean;
  type: "list_files";
};

export type ReadFileAction = {
  id: string;
  path: string;
  type: "read_file";
};

export type OpenFileAction = {
  discardUnsavedChanges?: boolean;
  id: string;
  path: string;
  type: "open_file";
};

export type CreateFileAction = {
  content?: string;
  id: string;
  openAfterCreate?: boolean;
  path: string;
  type: "create_file";
};

export type CreateFolderAction = {
  id: string;
  path: string;
  type: "create_folder";
};

export type MovePathAction = {
  destinationPath: string;
  id: string;
  sourcePath: string;
  type: "move_path";
};

export type DeletePathAction = {
  force?: boolean;
  id: string;
  path: string;
  type: "delete_path";
};

export type SaveDocumentAction = {
  id: string;
  path?: string;
  type: "save_document";
};

export type GetCurrentDocumentAction = {
  id: string;
  includeOutline?: boolean;
  type: "get_current_document";
};

export type ReplaceCurrentDocumentAction = {
  id: string;
  markdown: string;
  type: "replace_current_document";
};

export type ApplyMarkdownEditsAction = {
  edits: MarkdownEdit[];
  id: string;
  type: "apply_markdown_edits";
};

export type UnderwrittenBridgeAction =
  | ApplyMarkdownEditsAction
  | CreateFileAction
  | CreateFolderAction
  | DeletePathAction
  | GetCurrentDocumentAction
  | GetWorkspaceStatusAction
  | ListFilesAction
  | MovePathAction
  | OpenFileAction
  | ReadFileAction
  | ReplaceCurrentDocumentAction
  | SaveDocumentAction;

export type UnderwrittenBridgeActionResult =
  | {
      actionId: string;
      error: {
        code: string;
        message: string;
      };
      ok: false;
    }
  | {
      actionId: string;
      ok: true;
      result: unknown;
    };

export type UnderwrittenBridgeDiscoveryResponse = {
  apiVersion: string;
  appName: "underwritten";
  bridgeId: string;
  port: number;
};

export type UnderwrittenBridgePairRequest = {
  pageUrl?: string | null;
  sessionId: string;
};

export type UnderwrittenBridgePairResponse = {
  apiVersion: string;
  browserToken: string;
  bridgeId: string;
  pollIntervalMs: number;
  sessionTtlMs: number;
};

export type UnderwrittenBridgeSessionSyncRequest = {
  completedActions?: UnderwrittenBridgeActionResult[];
  session: BridgeSessionState;
};

export type UnderwrittenBridgeSessionSyncResponse = {
  pendingActions: UnderwrittenBridgeAction[];
  serverTime: number;
};

export type UnderwrittenBridgeDisconnectRequest = {
  sessionId: string;
};

export type UnderwrittenBridgeStatusResponse = {
  activeSessionId: string | null;
  bridgeId: string;
  pairings: number;
  port: number;
  resolvedBy: "lastFocusAt,lastHeartbeatAt,sessionId" | "none";
  sessions: Array<
    BridgeSessionState & {
      connectedAt: number;
      disconnectedAt: number | null;
      origin: string;
    }
  >;
};

export function createSessionId() {
  return `uw-session-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function findAllOccurrences(haystack: string, needle: string) {
  if (needle.length === 0) {
    throw new Error("Markdown edit targets must not be empty.");
  }

  const positions: number[] = [];
  let fromIndex = 0;

  while (fromIndex <= haystack.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index < 0) break;
    positions.push(index);
    fromIndex = index + needle.length;
  }

  return positions;
}

function resolveOccurrence(markdown: string, target: MarkdownEditTarget) {
  const positions = findAllOccurrences(markdown, target.text);

  if (positions.length === 0) {
    throw new Error(`Target text not found: ${JSON.stringify(target.text)}`);
  }

  if (typeof target.occurrence === "number") {
    if (!Number.isInteger(target.occurrence) || target.occurrence < 1) {
      throw new Error("Target occurrence must be a positive integer.");
    }

    const position = positions[target.occurrence - 1];
    if (typeof position !== "number") {
      throw new Error(
        `Target occurrence ${target.occurrence} was not found for ${JSON.stringify(target.text)}.`,
      );
    }

    return position;
  }

  if (positions.length > 1) {
    throw new Error(
      `Target text is ambiguous without an occurrence: ${JSON.stringify(target.text)}.`,
    );
  }

  return positions[0] ?? 0;
}

export function applyMarkdownTextEdits(markdown: string, edits: MarkdownEdit[]) {
  let nextMarkdown = markdown;

  for (const edit of edits) {
    const start = resolveOccurrence(nextMarkdown, edit.target);
    const end = start + edit.target.text.length;

    switch (edit.type) {
      case "replace": {
        if (typeof edit.newText !== "string") {
          throw new Error("Replace edits require newText.");
        }

        nextMarkdown = `${nextMarkdown.slice(0, start)}${edit.newText}${nextMarkdown.slice(end)}`;
        break;
      }

      case "insert_before": {
        if (typeof edit.newText !== "string") {
          throw new Error("insert_before edits require newText.");
        }

        nextMarkdown = `${nextMarkdown.slice(0, start)}${edit.newText}${nextMarkdown.slice(start)}`;
        break;
      }

      case "insert_after": {
        if (typeof edit.newText !== "string") {
          throw new Error("insert_after edits require newText.");
        }

        nextMarkdown = `${nextMarkdown.slice(0, end)}${edit.newText}${nextMarkdown.slice(end)}`;
        break;
      }

      case "delete": {
        nextMarkdown = `${nextMarkdown.slice(0, start)}${nextMarkdown.slice(end)}`;
        break;
      }
    }
  }

  return nextMarkdown;
}

export function buildMarkdownOutline(markdown: string): MarkdownOutlineItem[] {
  return markdown.split("\n").flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (!match) {
      return [];
    }

    return [
      {
        depth: match[1].length,
        line: index + 1,
        text: match[2],
      },
    ];
  });
}
