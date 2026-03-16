import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import type { UnderwrittenBridgeService } from "./service.js";

function getMcpPackageVersion() {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };

    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function toToolResult(result: unknown) {
  const structuredContent =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { value: result };

  return {
    content: [
      {
        text: JSON.stringify(result, null, 2),
        type: "text" as const,
      },
    ],
    structuredContent,
  };
}

function createErrorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected bridge error.";

  return {
    content: [
      {
        text: message,
        type: "text" as const,
      },
    ],
    isError: true,
  };
}

export async function connectMcpServer(service: UnderwrittenBridgeService) {
  const server = new McpServer({
    name: "underwritten-mcp",
    version: getMcpPackageVersion(),
  });

  server.registerTool(
    "get_workspace_status",
    {
      description:
        "Return storage mode, active file, native-folder state, and whether the current document is dirty.",
    },
    async () => {
      try {
        return toToolResult(await service.callTool("get_workspace_status", {}));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_files",
    {
      description: "List workspace-relative files and optionally directories.",
      inputSchema: {
        includeDirectories: z.boolean().optional(),
        path: z.string().optional(),
        recursive: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("list_files", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "read_file",
    {
      description: "Read the saved workspace file at path.",
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("read_file", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "open_file",
    {
      description: "Open a workspace file in the active Underwritten editor session.",
      inputSchema: {
        discardUnsavedChanges: z.boolean().optional(),
        path: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("open_file", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "create_file",
    {
      description: "Create a workspace file and optionally open it in the active session.",
      inputSchema: {
        content: z.string().optional(),
        openAfterCreate: z.boolean().optional(),
        path: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("create_file", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "create_folder",
    {
      description: "Create a folder in the active Underwritten workspace.",
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("create_folder", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "move_path",
    {
      description: "Move or rename a workspace file or folder.",
      inputSchema: {
        destinationPath: z.string().min(1),
        sourcePath: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("move_path", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_path",
    {
      description: "Delete a workspace file or folder.",
      inputSchema: {
        force: z.boolean().optional(),
        path: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("delete_path", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "save_document",
    {
      description: "Save the active in-memory document to its current path or to a new path.",
      inputSchema: {
        path: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("save_document", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_current_document",
    {
      description:
        "Return the active in-memory markdown document from the most recently focused Underwritten session.",
      inputSchema: {
        includeOutline: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("get_current_document", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "replace_current_document",
    {
      description: "Replace the full active in-memory markdown document.",
      inputSchema: {
        markdown: z.string(),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("replace_current_document", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  server.registerTool(
    "apply_markdown_edits",
    {
      description: "Apply literal anchored markdown edits against the active in-memory document.",
      inputSchema: {
        edits: z.array(
          z.object({
            newText: z.string().optional(),
            target: z.object({
              occurrence: z.number().int().positive().optional(),
              text: z.string().min(1),
            }),
            type: z.enum(["delete", "insert_after", "insert_before", "replace"]),
          }),
        ),
      },
    },
    async (args) => {
      try {
        return toToolResult(await service.callTool("apply_markdown_edits", args));
      } catch (error) {
        return createErrorResult(error);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return server;
}
