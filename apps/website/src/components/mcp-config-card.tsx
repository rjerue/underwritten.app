import type { ReactNode } from "react";

type McpConfigCardProps = {
  actions?: ReactNode;
  code: string;
  codeTestId?: string;
  description?: string;
  title: string;
  variant?: "card" | "flat";
};

export function McpConfigCard({
  actions,
  code,
  codeTestId,
  description,
  title,
  variant = "card",
}: McpConfigCardProps) {
  return (
    <div
      className={
        variant === "flat"
          ? "space-y-4 border-t border-border/70 pt-4"
          : "rounded-xl border border-border bg-background p-4"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{title}</div>
          {description ? (
            <div className="mt-1 text-sm text-muted-foreground">{description}</div>
          ) : null}
        </div>

        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>

      <pre
        className={
          variant === "flat"
            ? "overflow-x-auto rounded-2xl bg-muted/35 px-4 py-4 text-xs leading-6 text-foreground"
            : "mt-4 overflow-x-auto rounded-xl border border-border bg-muted/30 px-3 py-3 text-xs leading-6 text-foreground"
        }
      >
        <code data-testid={codeTestId}>{code}</code>
      </pre>
    </div>
  );
}
