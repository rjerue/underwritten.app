export type McpClient = "cli" | "claude-code" | "codex" | "kiro" | "opencode";

export type McpInstruction = {
  code: string;
  description: string;
  label: string;
};

export const mcpInstructions: Record<McpClient, McpInstruction> = {
  cli: {
    code: "npm install -g underwritten\nunderwritten document get",
    description:
      "Install the Underwritten CLI to interact with your editor session from any terminal or agent shell. The CLI auto-starts a background bridge when used.",
    label: "CLI (Universal)",
  },
  "claude-code": {
    code: `{
  "mcpServers": {
    "underwritten": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "underwritten-mcp"]
    }
  }
}`,
    description:
      "Add this to a project-level .mcp.json file in Claude Code. Anthropic also supports adding the same config through the Claude Code MCP commands.",
    label: "Claude Code",
  },
  codex: {
    code: "codex mcp add underwritten -- npx -y underwritten-mcp",
    description:
      "Run this once in your terminal to register Underwritten as a local MCP server in Codex.",
    label: "Codex",
  },
  kiro: {
    code: `{
  "mcpServers": {
    "underwritten": {
      "command": "npx",
      "args": ["-y", "underwritten-mcp"],
      "disabled": false
    }
  }
}`,
    description:
      "Add this to .kiro/settings/mcp.json for the current workspace or ~/.kiro/settings/mcp.json for all workspaces.",
    label: "Kiro",
  },
  opencode: {
    code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "underwritten": {
      "type": "local",
      "command": ["npx", "-y", "underwritten-mcp"],
      "enabled": true
    }
  }
}`,
    description:
      "Add this to ~/.config/opencode/opencode.json or a project-level opencode.json file.",
    label: "OpenCode",
  },
};

export const mcpClientOrder: McpClient[] = ["cli", "claude-code", "codex", "kiro", "opencode"];
