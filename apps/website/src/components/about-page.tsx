import { useState } from "react";
import { CircleHelp } from "lucide-react";

import { McpClientSetup } from "./mcp-client-setup";
import type { McpClient } from "./mcp-instructions";

type MarkdownCheatSheetItem = {
  label: string;
  syntax: string;
  tooltip?: string;
};

const markdownCheatSheet: MarkdownCheatSheetItem[] = [
  { label: "Headings", syntax: "## Heading" },
  { label: "Bold", syntax: "**bold**" },
  { label: "Italic", syntax: "*italic*" },
  { label: "Strikethrough", syntax: "~~strike~~" },
  { label: "Underline", syntax: "<u>underline</u>" },
  { label: "Inline code", syntax: "`const value = 1`" },
  { label: "Links", syntax: "[Docs](https://example.com)" },
  { label: "Images", syntax: "![Diagram](https://example.com/image.png)" },
  { label: "Blockquotes", syntax: "> Callout" },
  { label: "Bulleted lists", syntax: "- Item" },
  { label: "Numbered lists", syntax: "1. First" },
  {
    label: "Fenced code blocks",
    syntax: "```ts",
    tooltip: "Write mode opens fenced code blocks in a dedicated editor and preview UI.",
  },
  {
    label: "Tables",
    syntax: "| Name | Role |",
    tooltip: "Write mode renders markdown tables with an editable table UI.",
  },
] as const;

export function AboutPage() {
  const [selectedMcpClient, setSelectedMcpClient] = useState<McpClient>("codex");
  return (
    <article className="mx-auto max-w-2xl space-y-5" data-testid="about-page">
      <section className="rounded-[2rem] border border-border/80 bg-gradient-to-br from-background via-background to-muted/40 px-6 py-8 shadow-sm dark:bg-background dark:bg-none sm:px-8">
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
            Agent support follows the same local-first model. A local bridge process runs on your
            machine to connect Underwritten with your tools. You can interact with this bridge using
            either the **Underwritten CLI** or an **MCP client**. The app talks to the bridge over
            localhost, and the only thing that leaves your machine is whatever model inference your
            agent sends to the provider you chose.
          </p>
          <p>
            The editor and the bridge are open source. You can inspect the full source at{" "}
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
      </section>

      <section
        className="rounded-[1.75rem] border border-border/80 bg-muted/30 px-6 py-6 shadow-sm sm:px-8"
        data-testid="markdown-guide"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">Supported Markdown</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Underwritten focuses on the common markdown syntax it can edit cleanly in write, read,
              and raw mode. This is the documented cheat sheet for supported formatting.
            </p>
          </div>

          <div className="divide-y divide-border/60">
            {markdownCheatSheet.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="group relative min-w-0 text-sm font-medium text-foreground sm:w-44 sm:flex-none">
                  <span>{item.label}</span>
                  {item.tooltip ? (
                    <>
                      <span
                        aria-label={`${item.label} help`}
                        className="ml-2 inline-flex rounded-full text-muted-foreground/80 outline-none transition-colors group-hover:text-foreground group-focus-within:text-foreground"
                        tabIndex={0}
                      >
                        <CircleHelp className="h-3.5 w-3.5" />
                      </span>
                      <div
                        className="pointer-events-none absolute left-0 top-2 z-10 max-w-64 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] font-normal tracking-normal text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                        role="tooltip"
                      >
                        {item.tooltip}
                      </div>
                    </>
                  ) : null}
                </div>
                <code className="block min-w-0 overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs text-foreground sm:flex-1">
                  {item.syntax}
                </code>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-border/80 bg-background/80 px-6 py-6 shadow-sm sm:px-8">
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Using Agents & MCP</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            The Agent Bridge is a single local service that supports both terminal-based CLI
            commands and MCP-based tools. When you use the CLI or an MCP client, the bridge
            bootstraps itself and pairs with Underwritten automatically.
          </p>
          <McpClientSetup
            codeTestId="mcp-client-config"
            configVariant="flat"
            descriptionTestId="mcp-client-description"
            onClientChange={setSelectedMcpClient}
            selectId="mcp-client-select"
            selectTestId="mcp-client-select"
            selectedClient={selectedMcpClient}
          />
          <p className="text-sm leading-6 text-muted-foreground">
            After adding the setup above, open Underwritten and check{" "}
            <span className="font-medium text-foreground">Settings → Agent Bridge</span> if you want
            to confirm that the local bridge is connected.
          </p>
        </div>
      </section>
    </article>
  );
}
