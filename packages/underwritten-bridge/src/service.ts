import { randomBytes, randomUUID } from "node:crypto";

import {
  type ApplyMarkdownEditsAction,
  type BridgeSessionState,
  type CreateFileAction,
  type CreateFolderAction,
  type CurrentDocument,
  type DeletePathAction,
  type GetCurrentDocumentAction,
  type GetWorkspaceStatusAction,
  type ListFilesAction,
  type MovePathAction,
  type OpenFileAction,
  type ReadFileAction,
  type ReplaceCurrentDocumentAction,
  type SaveDocumentAction,
  type UnderwrittenBridgeAction,
  type UnderwrittenBridgeActionResult,
  type UnderwrittenBridgePairRequest,
  type UnderwrittenBridgePairResponse,
  type UnderwrittenBridgeSessionSyncRequest,
  type UnderwrittenBridgeSessionSyncResponse,
  type UnderwrittenBridgeStatusResponse,
  type WorkspaceStatus,
  underwrittenBridgeActionTimeoutMs,
  underwrittenBridgeApiVersion,
  underwrittenBridgePollIntervalMs,
  underwrittenBridgeSessionTtlMs,
} from "underwritten-bridge-contract";

type PairingRecord = {
  createdAt: number;
  origin: string;
  sessionId: string;
};

type PendingAction = {
  action: UnderwrittenBridgeAction;
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timeoutId: NodeJS.Timeout;
};

type SessionRecord = {
  connectedAt: number;
  disconnectedAt: number | null;
  origin: string;
  pendingActions: PendingAction[];
  session: BridgeSessionState;
  token: string;
};

export type ToolName =
  | "apply_markdown_edits"
  | "create_file"
  | "create_folder"
  | "delete_path"
  | "get_current_document"
  | "get_workspace_status"
  | "list_files"
  | "move_path"
  | "open_file"
  | "read_file"
  | "replace_current_document"
  | "save_document";

export class UnderwrittenBridgeError extends Error {
  readonly code:
    | "ACTION_TIMEOUT"
    | "AMBIGUOUS_SESSION"
    | "INVALID_ORIGIN"
    | "NO_LIVE_SESSION"
    | "PAIRING_REQUIRED"
    | "SESSION_NOT_FOUND";
  readonly statusCode: number;

  constructor(
    message: string,
    code:
      | "ACTION_TIMEOUT"
      | "AMBIGUOUS_SESSION"
      | "INVALID_ORIGIN"
      | "NO_LIVE_SESSION"
      | "PAIRING_REQUIRED"
      | "SESSION_NOT_FOUND",
    statusCode = 400,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isAllowedUnderwrittenOrigin(origin: string) {
  try {
    const url = new URL(origin);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      return true;
    }

    return url.hostname === "underwritten.app" || url.hostname.endsWith(".underwritten.app");
  } catch {
    return false;
  }
}

function getSortValue(value: number | null) {
  return typeof value === "number" ? value : Number.NEGATIVE_INFINITY;
}

function compareSessions(left: SessionRecord, right: SessionRecord) {
  const focusDelta =
    getSortValue(right.session.lastFocusAt) - getSortValue(left.session.lastFocusAt);
  if (focusDelta !== 0) {
    return focusDelta;
  }

  const heartbeatDelta = right.session.lastHeartbeatAt - left.session.lastHeartbeatAt;
  if (heartbeatDelta !== 0) {
    return heartbeatDelta;
  }

  return left.session.sessionId.localeCompare(right.session.sessionId);
}

function getStringArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

export class UnderwrittenBridgeService {
  readonly bridgeId = randomUUID();

  private lastActivityAt = Date.now();
  private readonly pairings = new Map<string, PairingRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private port = 0;

  setPort(port: number) {
    this.port = port;
  }

  private pruneExpiredState() {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      const isDisconnected = session.disconnectedAt !== null;
      const isStale = now - session.session.lastHeartbeatAt > underwrittenBridgeSessionTtlMs;

      if (!isDisconnected && !isStale) {
        continue;
      }

      for (const pending of session.pendingActions) {
        clearTimeout(pending.timeoutId);
        pending.reject(
          new UnderwrittenBridgeError(
            "The browser session disappeared before the action completed.",
            "SESSION_NOT_FOUND",
            404,
          ),
        );
      }

      this.sessions.delete(sessionId);
    }

    for (const [token, pairing] of this.pairings.entries()) {
      const session = this.sessions.get(pairing.sessionId);
      const pairingExpired = now - pairing.createdAt > underwrittenBridgeSessionTtlMs;
      if (session || !pairingExpired) {
        continue;
      }

      this.pairings.delete(token);
    }
  }

  markActivity() {
    this.lastActivityAt = Date.now();
    this.pruneExpiredState();
  }

  getLastActivityAt() {
    return this.lastActivityAt;
  }

  close() {
    for (const session of this.sessions.values()) {
      for (const pending of session.pendingActions) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error("Bridge closed before the action completed."));
      }
    }

    this.sessions.clear();
    this.pairings.clear();
  }

  createPairing(
    origin: string,
    request: UnderwrittenBridgePairRequest,
  ): UnderwrittenBridgePairResponse {
    this.markActivity();

    if (!isAllowedUnderwrittenOrigin(origin)) {
      throw new UnderwrittenBridgeError(
        `Origin ${origin} is not allowed to connect to the Underwritten bridge.`,
        "INVALID_ORIGIN",
        403,
      );
    }

    const browserToken = randomBytes(24).toString("hex");
    this.pairings.set(browserToken, {
      createdAt: Date.now(),
      origin,
      sessionId: request.sessionId,
    });

    return {
      apiVersion: underwrittenBridgeApiVersion,
      browserToken,
      bridgeId: this.bridgeId,
      pollIntervalMs: underwrittenBridgePollIntervalMs,
      sessionTtlMs: underwrittenBridgeSessionTtlMs,
    };
  }

  syncSession(
    origin: string,
    token: string,
    request: UnderwrittenBridgeSessionSyncRequest,
  ): UnderwrittenBridgeSessionSyncResponse {
    this.markActivity();

    const pairing = this.pairings.get(token);
    if (!pairing || pairing.origin !== origin || pairing.sessionId !== request.session.sessionId) {
      throw new UnderwrittenBridgeError(
        "This browser session is not paired with the Underwritten bridge.",
        "PAIRING_REQUIRED",
        401,
      );
    }

    if (!isAllowedUnderwrittenOrigin(origin)) {
      throw new UnderwrittenBridgeError(
        `Origin ${origin} is not allowed to connect to the Underwritten bridge.`,
        "INVALID_ORIGIN",
        403,
      );
    }

    const existing = this.sessions.get(request.session.sessionId);
    const record: SessionRecord = existing ?? {
      connectedAt: Date.now(),
      disconnectedAt: null,
      origin,
      pendingActions: [],
      session: request.session,
      token,
    };

    record.origin = origin;
    record.disconnectedAt = null;
    record.token = token;
    record.session = request.session;
    this.sessions.set(record.session.sessionId, record);

    for (const result of request.completedActions ?? []) {
      const pendingIndex = record.pendingActions.findIndex(
        (pending) => pending.action.id === result.actionId,
      );

      if (pendingIndex < 0) {
        continue;
      }

      const [pending] = record.pendingActions.splice(pendingIndex, 1);
      if (!pending) {
        continue;
      }

      clearTimeout(pending.timeoutId);

      if (result.ok === true) {
        pending.resolve(result.result);
      } else {
        pending.reject(new Error(result.error.message));
      }
    }

    const queuedActions = record.pendingActions.map((pending) => pending.action);

    return {
      pendingActions: queuedActions,
      serverTime: Date.now(),
    };
  }

  disconnectSession(origin: string, token: string, sessionId: string) {
    this.markActivity();

    const pairing = this.pairings.get(token);
    const session = this.sessions.get(sessionId);

    if (!pairing || pairing.origin !== origin || pairing.sessionId !== sessionId || !session) {
      throw new UnderwrittenBridgeError(
        "The bridge session could not be found.",
        "SESSION_NOT_FOUND",
        404,
      );
    }

    session.disconnectedAt = Date.now();
    this.pairings.delete(token);
  }

  getStatus(origin: string, token: string): UnderwrittenBridgeStatusResponse {
    this.markActivity();

    const pairing = this.pairings.get(token);
    if (!pairing || pairing.origin !== origin) {
      throw new UnderwrittenBridgeError(
        "This browser session is not paired with the Underwritten bridge.",
        "PAIRING_REQUIRED",
        401,
      );
    }

    const activeSession = this.tryResolveActiveSession();

    return {
      activeSessionId: activeSession?.session.sessionId ?? null,
      bridgeId: this.bridgeId,
      pairings: this.pairings.size,
      port: this.port,
      resolvedBy: activeSession ? "lastFocusAt,lastHeartbeatAt,sessionId" : "none",
      sessions: [...this.sessions.values()].sort(compareSessions).map((session) => ({
        ...session.session,
        connectedAt: session.connectedAt,
        disconnectedAt: session.disconnectedAt,
        origin: session.origin,
      })),
    };
  }

  async callTool(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    this.markActivity();

    switch (name) {
      case "get_workspace_status":
        return await this.enqueueAction<GetWorkspaceStatusAction>({
          id: randomUUID(),
          type: "get_workspace_status",
        });

      case "list_files":
        return await this.enqueueAction<ListFilesAction>({
          id: randomUUID(),
          includeDirectories:
            typeof args.includeDirectories === "boolean" ? args.includeDirectories : undefined,
          path: typeof args.path === "string" ? args.path : undefined,
          recursive: typeof args.recursive === "boolean" ? args.recursive : undefined,
          type: "list_files",
        });

      case "read_file":
        return await this.enqueueAction<ReadFileAction>({
          id: randomUUID(),
          path: getStringArg(args, "path"),
          type: "read_file",
        });

      case "open_file":
        return await this.enqueueAction<OpenFileAction>({
          discardUnsavedChanges:
            typeof args.discardUnsavedChanges === "boolean"
              ? args.discardUnsavedChanges
              : undefined,
          id: randomUUID(),
          path: getStringArg(args, "path"),
          type: "open_file",
        });

      case "create_file":
        return await this.enqueueAction<CreateFileAction>({
          content: typeof args.content === "string" ? args.content : undefined,
          id: randomUUID(),
          openAfterCreate:
            typeof args.openAfterCreate === "boolean" ? args.openAfterCreate : undefined,
          path: getStringArg(args, "path"),
          type: "create_file",
        });

      case "create_folder":
        return await this.enqueueAction<CreateFolderAction>({
          id: randomUUID(),
          path: getStringArg(args, "path"),
          type: "create_folder",
        });

      case "move_path":
        return await this.enqueueAction<MovePathAction>({
          destinationPath: getStringArg(args, "destinationPath"),
          id: randomUUID(),
          sourcePath: getStringArg(args, "sourcePath"),
          type: "move_path",
        });

      case "delete_path":
        return await this.enqueueAction<DeletePathAction>({
          force: typeof args.force === "boolean" ? args.force : undefined,
          id: randomUUID(),
          path: getStringArg(args, "path"),
          type: "delete_path",
        });

      case "save_document":
        return await this.enqueueAction<SaveDocumentAction>({
          id: randomUUID(),
          path: typeof args.path === "string" ? args.path : undefined,
          type: "save_document",
        });

      case "get_current_document":
        return await this.enqueueAction<GetCurrentDocumentAction>({
          id: randomUUID(),
          includeOutline:
            typeof args.includeOutline === "boolean" ? args.includeOutline : undefined,
          type: "get_current_document",
        });

      case "replace_current_document":
        return await this.enqueueAction<ReplaceCurrentDocumentAction>({
          id: randomUUID(),
          markdown: getStringArg(args, "markdown"),
          type: "replace_current_document",
        });

      case "apply_markdown_edits":
        return await this.enqueueAction<ApplyMarkdownEditsAction>({
          edits: Array.isArray(args.edits) ? (args.edits as ApplyMarkdownEditsAction["edits"]) : [],
          id: randomUUID(),
          type: "apply_markdown_edits",
        });
    }
  }

  private getLiveSessions() {
    this.pruneExpiredState();
    const now = Date.now();

    return [...this.sessions.values()]
      .filter((session) => {
        if (session.disconnectedAt !== null) {
          return false;
        }

        return now - session.session.lastHeartbeatAt <= underwrittenBridgeSessionTtlMs;
      })
      .sort(compareSessions);
  }

  hasLiveSession() {
    return this.getLiveSessions().length > 0;
  }

  private tryResolveActiveSession() {
    return this.getLiveSessions()[0] ?? null;
  }

  private resolveActiveSession() {
    const liveSessions = this.getLiveSessions();
    if (liveSessions.length === 0) {
      throw new UnderwrittenBridgeError(
        "No live underwritten.app session is connected to the bridge.",
        "NO_LIVE_SESSION",
        409,
      );
    }

    return liveSessions[0]!;
  }

  private enqueueAction<TAction extends UnderwrittenBridgeAction>(
    action: TAction,
  ): Promise<unknown> {
    const session = this.resolveActiveSession();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const sessionRecord = this.sessions.get(session.session.sessionId);
        if (!sessionRecord) {
          reject(
            new UnderwrittenBridgeError(
              "The browser session disappeared before the action completed.",
              "SESSION_NOT_FOUND",
              404,
            ),
          );
          return;
        }

        sessionRecord.pendingActions = sessionRecord.pendingActions.filter(
          (pending) => pending.action.id !== action.id,
        );

        reject(
          new UnderwrittenBridgeError(
            `Timed out waiting for underwritten.app to apply ${action.type}.`,
            "ACTION_TIMEOUT",
            504,
          ),
        );
      }, underwrittenBridgeActionTimeoutMs);

      session.pendingActions.push({
        action,
        reject,
        resolve,
        timeoutId,
      });
    });
  }
}

export function toWorkspaceStatus(input: BridgeSessionState): WorkspaceStatus {
  return {
    activeFilePath: input.activeFilePath,
    hasNativeFolderSelected: input.nativeFolderSelected,
    hasUnsavedChanges: input.dirty,
    storageMode: input.storageMode,
  };
}

export function toCurrentDocument(
  input: BridgeSessionState,
  outline?: CurrentDocument["outline"],
): CurrentDocument {
  return {
    dirty: input.dirty,
    filePath: input.activeFilePath,
    markdown: input.markdown,
    outline,
    storageMode: input.storageMode,
    title: input.title,
  };
}

export function toActionResult(actionId: string, error: unknown): UnderwrittenBridgeActionResult {
  const message = error instanceof Error ? error.message : "Unknown bridge error.";

  return {
    actionId,
    error: {
      code: "ACTION_FAILED",
      message,
    },
    ok: false,
  };
}
