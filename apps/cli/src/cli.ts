#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { underwrittenBridgePortRange } from "underwritten-bridge-contract";
import { runSharedBridgeDaemon } from "underwritten-bridge";
import { ensureBridge } from "./bridge-process.js";

const EXPLICIT_PORT = process.env.UNDERWRITTEN_BRIDGE_PORT
  ? parseInt(process.env.UNDERWRITTEN_BRIDGE_PORT, 10)
  : undefined;

async function runBridgeDaemon() {
  await runSharedBridgeDaemon({
    port: EXPLICIT_PORT,
    portRange: EXPLICIT_PORT ? undefined : underwrittenBridgePortRange,
  });
}

async function executeCommand(name: string, args: Record<string, unknown> = {}) {
  const entrypoint = fileURLToPath(import.meta.url);
  const { port } = await ensureBridge(EXPLICIT_PORT, entrypoint);

  const start = Date.now();
  const timeout = 30_000;
  let hasShownWaitMessage = false;

  while (true) {
    const response = await fetch(`http://127.0.0.1:${port}/cli/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });

    if (response.ok) {
      if (hasShownWaitMessage && process.stderr.isTTY) {
        process.stderr.write("\n");
      }
      return await response.json();
    }

    const error = (await response.json()) as any;
    const errorCode = error.error?.code;

    if (errorCode === "NO_LIVE_SESSION" && Date.now() - start < timeout) {
      if (!hasShownWaitMessage && Date.now() - start > 1000) {
        process.stderr.write("Waiting for Underwritten to connect...");
        hasShownWaitMessage = true;
      } else if (hasShownWaitMessage && process.stderr.isTTY) {
        process.stderr.write(".");
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    if (hasShownWaitMessage) {
      process.stderr.write("\n");
    }
    throw new Error(error.error?.message || `Bridge command failed: ${name}`);
  }
}

function parseEditsJson(raw: string | undefined) {
  if (typeof raw !== "string") {
    throw new Error("document edit requires an edits_json argument.");
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("document edit expects a JSON array of markdown edits.");
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid edits_json: ${error.message}`);
    }

    throw new Error("Invalid edits_json.");
  }
}

export async function main(argv: string[] = process.argv.slice(2)) {
  const command = argv[0];

  if (command === "__bridge") {
    await runBridgeDaemon();
    return;
  }

  try {
    if (command === "docs" || command === "man") {
      console.log(`
UNDERWRITTEN(1)             Underwritten Agent Manual            UNDERWRITTEN(1)

NAME
    underwritten - command-line interface for the Underwritten markdown editor

SYNOPSIS
    underwritten <command> [arguments] [options]

DESCRIPTION
    underwritten provides a shell-accessible interface to a live Underwritten
    editor session. It communicates with the app via an ephemeral local
    bridge process.

    If no bridge is running, underwritten auto-starts one in the background.
    The CLI will wait up to 30 seconds for Underwritten to discover and pair
    with the bridge before executing the requested command.

    Underwritten must have "Agent Integration" enabled in Settings.

COMMANDS
    status
        Check if the local bridge is running and see its port.

    workspace status
        Show the active file path, storage mode, and unsaved changes state.

    document get [--outline]
        Retrieve the full markdown text of the currently active document.
        Use --outline to include a structured heading list.

    document replace <markdown>
        Replace the entire content of the active document with new text.

    document edit <edits_json>
        Apply precise, anchored edits to the document. The edits_json should
        be an array of MarkdownEdit objects.

    document save [path]
        Save the current document. If a path is provided, it performs a 
        "Save As" operation.

    files list [--path <dir>] [--recursive] [--dirs]
        List files in the current Underwritten workspace.

    files read <path>
        Read the content of a specific file from the workspace.

    files open <path>
        Open a specific workspace file in the editor.

    files mkdir <path>
        Create a new folder in the workspace.

    files create <path> [content]
        Create a new file in the workspace.

    files move <source> <destination>
        Rename or move a file/folder.

    files delete <path>
        Remove a file or folder.

AGENT INTEGRATION
    Underwritten is designed for use by coding agents (Codex, Claude Code, etc).
    All commands return JSON by default to stdout. Diagnostics and errors are
    printed to stderr.

    Agents should check 'workspace status' first to understand the context.

ENVIRONMENT
    Underwritten uses a reserved port range (45261-45271) on localhost.
    UNDERWRITTEN_BRIDGE_PORT can be used to override the port.

EXIT STATUS
    0   Success
    1   Command failed or bridge error
    409 No live browser session found

SEE ALSO
    https://underwritten.app/about
      `);
      return;
    }

    if (!command || command === "help" || command === "--help") {
      console.log(`
Underwritten CLI - Local Agent Integration

Usage:
  underwritten <command> [options]

Commands:
  docs                          Show detailed manual (man page)
  status                        Show bridge and session status
  workspace status              Show active file and storage mode
  files list                    List workspace files
  files read <path>             Read file content
  files open <path>             Open file in editor
  files mkdir <path>            Create a folder
  files create <path> [content] Create a new file
  files move <src> <dest>       Move/rename a file
  files delete <path>           Delete a file
  document get                  Get current document text
  document replace <markdown>   Replace current document text
  document save [path]          Save current document
  document edit <edits_json>    Apply markdown edits

Options:
  --json                        Output results as JSON (default for agents)
  --wait                        Wait for browser session (default: true)

Run 'underwritten docs' for the full manual.
      `);
      return;
    }

    // Simplified command router for first pass
    let result: any;

    if (command === "status") {
      const entrypoint = fileURLToPath(import.meta.url);
      const bridge = await ensureBridge(EXPLICIT_PORT, entrypoint);
      result = { bridge: "running", port: bridge.port };
    } else if (command === "workspace" && argv[1] === "status") {
      result = await executeCommand("get_workspace_status");
    } else if (command === "files" && argv[1] === "list") {
      result = await executeCommand("list_files", {
        path: argv[2],
        recursive: argv.includes("--recursive"),
        includeDirectories: argv.includes("--dirs"),
      });
    } else if (command === "files" && argv[1] === "read") {
      result = await executeCommand("read_file", { path: argv[2] });
    } else if (command === "files" && argv[1] === "open") {
      result = await executeCommand("open_file", { path: argv[2] });
    } else if (command === "files" && argv[1] === "mkdir") {
      result = await executeCommand("create_folder", {
        path: argv[2],
      });
    } else if (command === "files" && argv[1] === "create") {
      result = await executeCommand("create_file", {
        content: argv[3],
        path: argv[2],
      });
    } else if (command === "files" && argv[1] === "move") {
      result = await executeCommand("move_path", {
        destinationPath: argv[3],
        sourcePath: argv[2],
      });
    } else if (command === "files" && argv[1] === "delete") {
      result = await executeCommand("delete_path", {
        force: argv.includes("--force"),
        path: argv[2],
      });
    } else if (command === "document" && argv[1] === "get") {
      result = await executeCommand("get_current_document", {
        includeOutline: argv.includes("--outline"),
      });
    } else if (command === "document" && argv[1] === "replace") {
      result = await executeCommand("replace_current_document", { markdown: argv[2] });
    } else if (command === "document" && argv[1] === "save") {
      result = await executeCommand("save_document", { path: argv[2] });
    } else if (command === "document" && argv[1] === "edit") {
      result = await executeCommand("apply_markdown_edits", {
        edits: parseEditsJson(argv[2]),
      });
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

const isMain =
  process.argv[1]?.endsWith("cli.ts") ||
  process.argv[1]?.endsWith("cli.js") ||
  process.argv[1]?.endsWith("underwritten");
if (isMain) {
  void main();
}
