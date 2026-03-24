import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { type BridgeSessionState } from "underwritten-bridge-contract";

import { startUnderwrittenBridge, type StartedUnderwrittenBridge } from "./index.js";

const allowedOrigin = "http://127.0.0.1:4173";

async function getAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve an ephemeral localhost port for the MCP test."));
        return;
      }

      probe.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function createSessionState(
  sessionId: string,
  overrides?: Partial<BridgeSessionState>,
): BridgeSessionState {
  return {
    activeFilePath: "notes/test.md",
    appCapabilities: {
      supportsDirectoryAccess: true,
    },
    dirty: false,
    lastFocusAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    markdown: "# Title\n",
    nativeFolderSelected: false,
    pageUrl: `${allowedOrigin}/`,
    revision: "rev-1",
    sessionId,
    storageMode: "origin-private",
    title: "Title",
    visibilityState: "visible",
    windowLabel: null,
    ...overrides,
  };
}

async function pairBridge(port: number, sessionId: string) {
  const response = await fetch(`http://127.0.0.1:${port}/pair`, {
    body: JSON.stringify({
      pageUrl: `${allowedOrigin}/`,
      sessionId,
    }),
    headers: {
      "Content-Type": "application/json",
      Origin: allowedOrigin,
    },
    method: "POST",
  });

  const payload = (await response.json()) as { browserToken: string };

  return payload.browserToken;
}

async function syncBridge(
  port: number,
  token: string,
  session: BridgeSessionState,
  completedActions?: Array<{
    actionId: string;
    ok: boolean;
    result?: unknown;
    error?: { code: string; message: string };
  }>,
) {
  const response = await fetch(`http://127.0.0.1:${port}/session/sync`, {
    body: JSON.stringify({
      completedActions,
      session,
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: allowedOrigin,
    },
    method: "POST",
  });

  return response;
}

async function disconnectBridge(port: number, token: string, sessionId: string) {
  return await fetch(`http://127.0.0.1:${port}/session/disconnect`, {
    body: JSON.stringify({
      sessionId,
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: allowedOrigin,
    },
    method: "POST",
  });
}

describe("underwritten bridge service", () => {
  let startedBridge: StartedUnderwrittenBridge;

  beforeEach(async () => {
    const port = await getAvailablePort();
    startedBridge = await startUnderwrittenBridge({
      port,
    });
  });

  afterEach(async () => {
    await startedBridge.close();
  });

  test("starts the localhost bridge and exposes discovery metadata", async () => {
    const response = await fetch(`http://127.0.0.1:${startedBridge.port}/discover`, {
      headers: {
        Origin: allowedOrigin,
      },
    });

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      appName: "underwritten",
      bridgeId: startedBridge.service.bridgeId,
      port: startedBridge.port,
    });
  });

  test("rejects sync requests that are missing a valid pairing token", async () => {
    const response = await syncBridge(
      startedBridge.port,
      "bad-token",
      createSessionState("unauthorized-session"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PAIRING_REQUIRED",
      },
    });
  });

  test("registers a session, routes tools to the most recently focused live session, and reports status", async () => {
    const leftToken = await pairBridge(startedBridge.port, "left-session");
    const rightToken = await pairBridge(startedBridge.port, "right-session");
    const now = Date.now();

    await syncBridge(
      startedBridge.port,
      leftToken,
      createSessionState("left-session", {
        lastFocusAt: now - 10,
        lastHeartbeatAt: now - 10,
        title: "Left",
      }),
    );
    await syncBridge(
      startedBridge.port,
      rightToken,
      createSessionState("right-session", {
        lastFocusAt: now,
        lastHeartbeatAt: now,
        title: "Right",
      }),
    );

    const toolPromise = startedBridge.service.callTool("get_current_document", {});

    const leftPoll = await syncBridge(
      startedBridge.port,
      leftToken,
      createSessionState("left-session", {
        lastFocusAt: now - 10,
        lastHeartbeatAt: Date.now(),
        title: "Left",
      }),
    );
    const leftPayload = (await leftPoll.json()) as { pendingActions: Array<{ id: string }> };
    expect(leftPayload.pendingActions).toHaveLength(0);

    const rightPoll = await syncBridge(
      startedBridge.port,
      rightToken,
      createSessionState("right-session", {
        lastFocusAt: now,
        lastHeartbeatAt: Date.now(),
        markdown: "# Right\n",
        title: "Right",
      }),
    );
    const rightPayload = (await rightPoll.json()) as {
      pendingActions: Array<{ id: string; type: string }>;
    };

    expect(rightPayload.pendingActions).toHaveLength(1);
    expect(rightPayload.pendingActions[0]).toMatchObject({
      type: "get_current_document",
    });

    await syncBridge(
      startedBridge.port,
      rightToken,
      createSessionState("right-session", {
        lastFocusAt: now,
        lastHeartbeatAt: Date.now(),
        markdown: "# Right\n",
        title: "Right",
      }),
      [
        {
          actionId: rightPayload.pendingActions[0]!.id,
          ok: true,
          result: {
            markdown: "# Right\n",
            title: "Right",
          },
        },
      ],
    );

    await expect(toolPromise).resolves.toEqual({
      markdown: "# Right\n",
      title: "Right",
    });

    const statusResponse = await fetch(`http://127.0.0.1:${startedBridge.port}/status`, {
      headers: {
        Authorization: `Bearer ${rightToken}`,
        Origin: allowedOrigin,
      },
    });

    expect(statusResponse.ok).toBe(true);
    await expect(statusResponse.json()).resolves.toMatchObject({
      activeSessionId: "right-session",
      resolvedBy: "lastFocusAt,lastHeartbeatAt,sessionId",
    });
  });

  test("fails safely when no live session can be resolved", async () => {
    const token = await pairBridge(startedBridge.port, "stale-session");

    await syncBridge(
      startedBridge.port,
      token,
      createSessionState("stale-session", {
        lastFocusAt: Date.now() - 60_000,
        lastHeartbeatAt: Date.now() - 60_000,
      }),
    );

    await expect(startedBridge.service.callTool("get_workspace_status", {})).rejects.toThrow(
      /No live underwritten\.app session/i,
    );
  });

  test("removes disconnected sessions from bridge status", async () => {
    const sessionId = "disconnecting-session";
    const token = await pairBridge(startedBridge.port, sessionId);

    await syncBridge(startedBridge.port, token, createSessionState(sessionId));
    const disconnectResponse = await disconnectBridge(startedBridge.port, token, sessionId);
    expect(disconnectResponse.ok).toBe(true);

    const replacementToken = await pairBridge(startedBridge.port, "status-session");
    const statusResponse = await fetch(`http://127.0.0.1:${startedBridge.port}/status`, {
      headers: {
        Authorization: `Bearer ${replacementToken}`,
        Origin: allowedOrigin,
      },
    });

    expect(statusResponse.ok).toBe(true);
    await expect(statusResponse.json()).resolves.toMatchObject({
      activeSessionId: null,
      sessions: [],
    });
  });

  test("dispatches each required tool action shape", async () => {
    const token = await pairBridge(startedBridge.port, "tool-session");

    const session = createSessionState("tool-session");
    await syncBridge(startedBridge.port, token, session);

    const cases = [
      { args: {}, name: "get_workspace_status", type: "get_workspace_status" },
      {
        args: { includeDirectories: true, path: "notes", recursive: true },
        name: "list_files",
        type: "list_files",
      },
      { args: { path: "notes/test.md" }, name: "read_file", type: "read_file" },
      {
        args: { discardUnsavedChanges: true, path: "notes/test.md" },
        name: "open_file",
        type: "open_file",
      },
      {
        args: { content: "# New", openAfterCreate: true, path: "notes/new-file" },
        name: "create_file",
        type: "create_file",
      },
      { args: { path: "notes/folder" }, name: "create_folder", type: "create_folder" },
      {
        args: { destinationPath: "notes/renamed.md", sourcePath: "notes/test.md" },
        name: "move_path",
        type: "move_path",
      },
      { args: { force: true, path: "notes/test.md" }, name: "delete_path", type: "delete_path" },
      { args: { path: "notes/test.md" }, name: "save_document", type: "save_document" },
      {
        args: { includeOutline: true },
        name: "get_current_document",
        type: "get_current_document",
      },
      {
        args: { markdown: "# Replaced" },
        name: "replace_current_document",
        type: "replace_current_document",
      },
      {
        args: {
          edits: [
            {
              newText: "Updated",
              target: { text: "Title" },
              type: "replace",
            },
          ],
        },
        name: "apply_markdown_edits",
        type: "apply_markdown_edits",
      },
    ] as const;

    for (const testCase of cases) {
      const toolPromise = startedBridge.service.callTool(
        testCase.name,
        testCase.args as Record<string, unknown>,
      );

      const pollResponse = await syncBridge(startedBridge.port, token, {
        ...session,
        lastHeartbeatAt: Date.now(),
      });
      const pollPayload = (await pollResponse.json()) as {
        pendingActions: Array<{ id: string; type: string }>;
      };

      expect(pollPayload.pendingActions[0]).toMatchObject({
        type: testCase.type,
      });

      await syncBridge(
        startedBridge.port,
        token,
        {
          ...session,
          lastHeartbeatAt: Date.now(),
        },
        [
          {
            actionId: pollPayload.pendingActions[0]!.id,
            ok: true,
            result: { ok: true, type: testCase.type },
          },
        ],
      );

      await expect(toolPromise).resolves.toEqual({ ok: true, type: testCase.type });
    }
  });
});
