# Underwritten CLI

`underwritten` is the command-line interface for [Underwritten](https://underwritten.app). It allows coding agents (like Codex, OpenCode, Claude Code, or Kiro) and terminal users to interact with a live Underwritten editor session through a local bridge.

## Installation

```bash
npm install -g underwritten
```

## How It Works

Underwritten is a browser-first markdown editor. The CLI acts as a bridge:

1. When you run an `underwritten` command, it checks for a local bridge process.
2. If none exists, it auto-starts a hidden background bridge.
3. Underwritten (with "Agent Integration" enabled in Settings) discovers and pairs with this bridge.
4. Commands are queued and executed by the active Underwritten session.
5. The CLI prints the result (JSON by default) and exits.

## Command Surface

### Workspace Status

```bash
underwritten workspace status
```

Returns active file path, storage mode, and unsaved changes state.

### File Operations

```bash
underwritten files list [--path <dir>] [--recursive] [--dirs]
underwritten files read <path>
underwritten files open <path>
underwritten files mkdir <path>
underwritten files create <path> [content]
underwritten files move <src> <dest>
underwritten files delete <path>
```

### Document Operations

```bash
underwritten document get [--outline]
underwritten document replace <markdown>
underwritten document save [path]
underwritten document edit <edits_json>
```

## Agent Integration

Agents should use the CLI with the `--json` flag (enabled by default) for stable machine-readable output.

### Codex / Claude Code / OpenCode / Kiro

Configure your agent to shell out to `underwritten`.

**Example: Get current document**

```bash
underwritten document get
```

**Example: Read workspace files**

```bash
underwritten files list --recursive
```

## Error Codes

The CLI exits with `0` on success and non-zero on failure. Errors are printed to `stderr` in human-readable format or `stdout` as JSON if requested.

## Requirements

- Underwritten web app must be open in a browser.
- "Agent Integration" must be enabled in **Settings → Agent Bridge**.

## License

MIT
