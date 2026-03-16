# Underwritten MCP Bridge

`underwritten-mcp` is the local MCP companion for `underwritten.app`.

It is the MCP server. The browser app is not.

## Why this package exists

`underwritten.app` is a PWA and the editor state lives in the browser. External MCP clients need a local process that can:

- speak MCP over `stdio`
- bind a localhost API
- coordinate with the live browser editor session

This package provides that bridge while the PWA remains the source of truth for document and workspace state.

## Monorepo layout

- `apps/mcp`: publishable MCP server package and localhost bridge
- `apps/mcp/src/contract.ts`: shared browser-safe protocol types and markdown edit helpers
- `apps/website`: PWA integration, bridge discovery, session registration, polling, and settings UI

## User setup

The intended end-user MCP config is:

```json
{
  "mcpServers": {
    "underwritten": {
      "command": "npx",
      "args": ["-y", "underwritten-mcp"]
    }
  }
}
```

After that:

1. The MCP client starts `underwritten-mcp`.
2. The bridge binds a localhost API on `127.0.0.1`.
3. The PWA discovers the bridge automatically and pairs without a manual token-copy step.
4. The active editor tab registers itself and starts polling for pending actions.

## Running locally

Install dependencies first:

```bash
vp install
```

Run the website in one terminal:

```bash
vp run website#dev
```

Run the MCP bridge from source in another terminal:

```bash
vp dlx tsx apps/mcp/src/cli.ts
```

If you want to run the built output instead:

```bash
vp exec tsc -p apps/mcp/tsconfig.build.json
node apps/mcp/dist/cli.js
```

If you want to test the user-facing bootstrap shape locally, the equivalent MCP client entry is still:

```json
{
  "mcpServers": {
    "underwritten": {
      "command": "npx",
      "args": ["-y", "underwritten-mcp"]
    }
  }
}
```

## Validation

Repo-level validation:

```bash
vp check
vp test
vp run test:e2e
```

MCP package build only:

```bash
vp exec tsc -p apps/mcp/tsconfig.build.json
```

## Discovery and pairing

By default the PWA scans a reserved localhost port range and probes `GET /discover`.

- Reserved range: `45261-45271`
- Bind address: `127.0.0.1`
- Pairing: automatic `POST /pair` from an approved Underwritten origin
- Session sync: `POST /session/sync`
- Status: `GET /status`

For test isolation and local debugging, the browser also honors a `localStorage` override at `underwritten.mcp.bridgePorts` with an explicit JSON array of ports to probe.

## Browser session model

Each tab registers as a distinct session with:

- `sessionId`
- `activeFilePath`
- `title`
- `markdown`
- `dirty`
- `storageMode`
- `nativeFolderSelected`
- `revision`
- `lastHeartbeatAt`
- `lastFocusAt`
- `visibilityState`
- `pageUrl`
- `windowLabel`

The browser polls the bridge, receives queued actions, applies them through the existing `EditorPage` editor/workspace code paths, and posts the result back in the next sync.

## Tool surface

Workspace tools:

- `get_workspace_status`
- `list_files`
- `read_file`
- `open_file`
- `create_file`
- `create_folder`
- `move_path`
- `delete_path`
- `save_document`

Markdown tools:

- `get_current_document`
- `replace_current_document`
- `apply_markdown_edits`

### Markdown edit semantics

`apply_markdown_edits` operates on raw markdown text, not editor-internal node ids.

- Target matching is literal text matching.
- `occurrence` is 1-based when provided.
- If `occurrence` is omitted, the target text must match exactly once.
- Ambiguous or missing targets fail with a clear error.
- Edits apply sequentially to the updated markdown buffer.

## Deterministic routing

Current-document and workspace tools route to one live session:

1. Keep only live sessions. A live session has a fresh heartbeat within `15s` and has not disconnected.
2. Sort by most recent `lastFocusAt`.
3. Break ties with most recent `lastHeartbeatAt`.
4. Break remaining ties lexically by `sessionId`.
5. If no live session remains, return an explicit error instead of guessing.

This keeps tool routing deterministic across multiple open tabs while leaving room for future explicit `sessionId` targeting.

## Security model

- The HTTP bridge binds only to `127.0.0.1`.
- Requests are limited to Underwritten origins plus local dev origins (`localhost` and `127.0.0.1`).
- The browser must pair first and then present a bridge-issued bearer token.
- The bridge does not expose shell execution.
- Workspace operations are restricted to Underwritten’s real browser workspace model.
- Native folder access still depends on the browser-granted File System Access handle already chosen in the app.

### Threat model limits

- Pairing is automatic for approved origins, so trust is anchored in the origin allowlist and localhost-only binding.
- A malicious script running on an approved Underwritten origin would inherit the same bridge access as the app.
- Multiple simultaneous MCP bridge processes are supported, but the browser only probes the configured port list/range and pairs with bridges it can discover.

## Settings UI

The existing settings dialog now includes an `MCP Bridge` section with:

- reachability / connection status
- current session id
- detected localhost port
- known session count
- copyable MCP config snippet
- reconnect action

## Current limitations

- The public tool surface does not yet support explicit `sessionId` targeting.
- `delete_path.force` only bypasses unsaved-current-document protection; it is not a separate recursive-delete flag because the browser file APIs already define directory deletion behavior.
- The settings panel reports bridge/session status from the local browser’s perspective; it is not a multi-client admin console.

## Future improvements

- explicit `sessionId` tool targeting
- richer bridge diagnostics and per-session inspection
- optional Streamable HTTP exposure in addition to `stdio`
- stronger persisted pairing state if the product needs cross-restart trust continuity
