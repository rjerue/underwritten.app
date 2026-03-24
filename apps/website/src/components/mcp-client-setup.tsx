import type { ReactNode } from "react";

import { mcpClientOrder, mcpInstructions, type McpClient } from "./mcp-instructions";
import { McpConfigCard } from "./mcp-config-card";

type McpClientSetupProps = {
  actions?: ReactNode;
  codeTestId?: string;
  configVariant?: "card" | "flat";
  descriptionTestId?: string;
  selectId: string;
  selectTestId?: string;
  selectedClient: McpClient;
  title?: string;
  onClientChange: (client: McpClient) => void;
};

export function McpClientSetup({
  actions,
  codeTestId,
  configVariant = "card",
  descriptionTestId,
  onClientChange,
  selectId,
  selectTestId,
  selectedClient,
  title = "MCP Config",
}: McpClientSetupProps) {
  const selectedInstructions = mcpInstructions[selectedClient];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label
          className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground"
          htmlFor={selectId}
        >
          Integration Type
        </label>
        <select
          aria-label="MCP client"
          className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-foreground/30 sm:max-w-xs"
          data-testid={selectTestId}
          id={selectId}
          onChange={(event) => onClientChange(event.target.value as McpClient)}
          value={selectedClient}
        >
          {mcpClientOrder.map((client) => (
            <option key={client} value={client}>
              {mcpInstructions[client].label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm leading-6 text-muted-foreground" data-testid={descriptionTestId}>
        {selectedInstructions.description}
      </p>

      <McpConfigCard
        actions={actions}
        code={selectedInstructions.code}
        codeTestId={codeTestId}
        title={title}
        variant={configVariant}
      />
    </div>
  );
}
