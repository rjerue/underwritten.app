import { useState } from "react";

import { McpClientSetup } from "./mcp-client-setup";
import type { McpClient } from "./mcp-instructions";

export function AboutPage() {
  const [selectedMcpClient, setSelectedMcpClient] = useState<McpClient>("codex");
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
          <McpClientSetup
            codeTestId="mcp-client-config"
            descriptionTestId="mcp-client-description"
            onClientChange={setSelectedMcpClient}
            selectId="mcp-client-select"
            selectTestId="mcp-client-select"
            selectedClient={selectedMcpClient}
          />
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
