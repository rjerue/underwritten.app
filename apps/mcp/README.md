# underwritten-mcp

`underwritten-mcp` is the published MCP server package for [Underwritten](https://underwritten.app). It runs as a local process, speaks MCP over `stdio`, exposes a localhost HTTP bridge for the browser app, and routes tool calls into the active Underwritten editor session.

The package exists because Underwritten itself is a browser app. External MCP clients need a local companion that can:

- start from a normal MCP command
- bind a localhost API the browser can reach
- pair with a live Underwritten tab
- operate on the real editor and workspace state already open in the app

## Install

You can run the published package directly:

```bash
npx -y underwritten-mcp
```

The intended end-user MCP configuration is:

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

After the process starts:

1. `underwritten-mcp` binds a free localhost port on `127.0.0.1`.
2. The Underwritten web app discovers the bridge with `GET /discover`.
3. The browser pairs with `POST /pair`.
4. The active tab syncs session state and executes queued actions.

## What It Does

- Runs an MCP server over `stdio`
- Exposes a localhost bridge for the browser app
- Routes file and document operations to the most relevant live Underwritten tab
- Shares browser-safe contract types through `underwritten-mcp/contract`
- Keeps the browser app as the source of truth for workspace and editor state

This is the published bridge package. The website app is not the MCP server.

## Tool Surface

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

Document tools:

- `get_current_document`
- `replace_current_document`
- `apply_markdown_edits`

`apply_markdown_edits` works on raw markdown text with literal anchored matching. Targets use a literal `text` value and optional 1-based `occurrence`. Edits apply sequentially against the updated buffer, and ambiguous or missing matches fail explicitly.

## Bridge Behavior

The bridge only listens on `127.0.0.1` and uses a reserved port range of `45261-45271` by default. The browser app pairs first, receives a bearer token, and then uses that token for sync and status requests.

Endpoints:

- `GET /discover`
- `POST /pair`
- `POST /session/sync`
- `POST /session/disconnect`
- `GET /status`

The browser polls every `1000ms`, and sessions expire after `15000ms` without a fresh heartbeat.

## Session Routing

Tool calls target one live browser session at a time. Routing is deterministic:

1. Keep only live, non-disconnected sessions.
2. Prefer the most recent `lastFocusAt`.
3. Break ties with the most recent `lastHeartbeatAt`.
4. Break any remaining tie lexically by `sessionId`.

If no live session is available, the bridge returns an explicit error instead of guessing.

## Package Exports

Default package exports:

- `startUnderwrittenBridge`
- `resolveBridgePort`
- `UnderwrittenBridgeService`
- `UnderwrittenBridgeError`

Contract exports are available from `underwritten-mcp/contract`, including:

- `underwrittenBridgePortRange`
- `underwrittenBridgeApiVersion`
- markdown edit types and helpers
- session, status, and action types shared with the browser app

Example:

```ts
import { startUnderwrittenBridge } from "underwritten-mcp";
import { underwrittenBridgePortRange } from "underwritten-mcp/contract";

const bridge = await startUnderwrittenBridge({
  connectStdio: true,
  portRange: underwrittenBridgePortRange,
});
```

## Local Development In This Monorepo

Install dependencies:

```bash
vp install
```

Run the website:

```bash
vp run website#dev
```

Run the bridge from source in another terminal:

```bash
vp dlx tsx apps/mcp/src/cli.ts
```

Build the package:

```bash
vp run mcp#build
```

If you want to run the built entrypoint directly:

```bash
node apps/mcp/dist/cli.js
```

## Validation

Run repo checks:

```bash
vp check
vp test
```

Run the package build:

```bash
vp run mcp#build
```

## Monorepo Context

- `apps/mcp`: publishable MCP bridge package
- `apps/mcp/src/contract.ts`: shared protocol types and markdown edit helpers
- `apps/website`: Underwritten web app that discovers, pairs with, and drives the bridge

## License

MIT
