import { useState } from "react";

type McpClient = "claude-code" | "codex" | "kiro" | "opencode";

const mcpInstructions: Record<
  McpClient,
  {
    code: string;
    description: string;
  }
> = {
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
  },
  codex: {
    code: "codex mcp add underwritten -- npx -y underwritten-mcp",
    description:
      "Run this once in your terminal to register Underwritten as a local MCP server in Codex.",
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
  },
};

export function AboutPage() {
  const [selectedMcpClient, setSelectedMcpClient] = useState<McpClient>("codex");
  const selectedInstructions = mcpInstructions[selectedMcpClient];

  return (
    <article
      className="rounded-[2rem] border border-border/80 bg-gradient-to-br from-background via-background to-muted/40 px-6 py-8 shadow-sm sm:px-8"
      data-testid="about-page"
    >
      <div className="max-w-2xl">
        <div className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          About
        </div>
        <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Local-first markdown editing
        </h2>
        <div className="mt-6 space-y-4 text-base leading-7 text-muted-foreground">
          <p>
            In our "agentic" world, I find myself writing a lot of markdown. I could not find a
            local/web based markdown editor that I enjoyed, so I decided to make both in one.
          </p>
          <p>
            Underwritten is a Progressive Web App, meaning you can save it to your computer and use
            it like a regular application. Your drafts live in browser storage or in a folder you
            explicitly choose. Underwritten does not have its own backend with independent access to
            your notes.
          </p>
          <p>
            MCP support follows the same local-first model. The MCP server runs as a local companion
            process on your machine, the app talks to it over localhost, and the only thing that
            leaves your machine is whatever model inference your MCP client sends to the model
            provider you chose.
          </p>
          <p>
            The editor and the MCP bridge are open source. You can inspect the full source at{" "}
            <a
              className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground/80"
              href="https://github.com/rjerue/underwritten.app"
              rel="noreferrer"
              target="_blank"
            >
              github.com/rjerue/underwritten.app
            </a>
            .
          </p>
          <p>
            <a
              className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground/80"
              href="https://github.com/rjerue/underwritten.app/issues"
              rel="noreferrer"
              target="_blank"
            >
              Problems? File an issue on github.
            </a>
          </p>
        </div>

        <div className="mt-10 space-y-4 rounded-2xl border border-border/70 bg-background/70 p-5">
          <h3 className="text-lg font-semibold text-foreground">Using MCP</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Choose your MCP client and use the matching setup. The local bridge bootstraps itself
            and pairs with Underwritten automatically after the client starts it.
          </p>
          <div className="space-y-2">
            <label
              className="block text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
              htmlFor="mcp-client-select"
            >
              MCP Client
            </label>
            <select
              className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground/30"
              data-testid="mcp-client-select"
              id="mcp-client-select"
              onChange={(event) => setSelectedMcpClient(event.target.value as McpClient)}
              value={selectedMcpClient}
            >
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="kiro">Kiro</option>
              <option value="opencode">OpenCode</option>
            </select>
          </div>
          <p
            className="text-sm leading-6 text-muted-foreground"
            data-testid="mcp-client-description"
          >
            {selectedInstructions.description}
          </p>
          <pre className="overflow-x-auto rounded-xl border border-border/70 bg-muted/50 p-4 text-xs leading-6 text-foreground">
            <code data-testid="mcp-client-config">{selectedInstructions.code}</code>
          </pre>
          <p className="text-sm leading-6 text-muted-foreground">
            After adding the setup above, open Underwritten and check{" "}
            <span className="font-medium text-foreground">Settings → MCP Bridge</span> if you want
            to confirm that the local bridge is connected.
          </p>
        </div>
      </div>
    </article>
  );
}
