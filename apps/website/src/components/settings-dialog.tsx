import { CircleHelp, ChevronDown, Settings2, X } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";

import type { FileStorageMode } from "../lib/file-system";
import { cn } from "../lib/utils";
import type { BridgePanelState } from "../mcp/bridge-client";
import type { SidebarSide } from "./file-sidebar";
import { Button } from "./ui/button";

export type FontPreset = {
  id: string;
  label: string;
  mono: string;
  preview: string;
  sans: string;
};

export type AppearanceSettings = {
  baseFontSize: number;
  fontPresetId: string;
};

export type LayoutSettings = {
  showLineNumbers: boolean;
};

export type PageWidthMode = "fill" | "responsive";

type SettingsDialogProps = {
  autosaveEnabled: boolean;
  bridgePanel: BridgePanelState;
  fontPresets: FontPreset[];
  hasSavedFile: boolean;
  layoutSettings: LayoutSettings;
  bridgeEnabled: boolean;
  nativeFolderName: string | null;
  nativeFolderSupported: boolean;
  onAutosaveEnabledChange: (enabled: boolean) => void;
  onLayoutSettingsChange: (settings: LayoutSettings) => void;
  onBridgeEnabledChange: (enabled: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onRequestNativeFolder: () => void;
  onPageWidthModeChange: (mode: PageWidthMode) => void;
  onSidebarSideChange: (side: SidebarSide) => void;
  onSettingsChange: (settings: AppearanceSettings) => void;
  onStorageModeChange: (mode: FileStorageMode) => void;
  open: boolean;
  pageWidthMode: PageWidthMode;
  sidebarSide: SidebarSide;
  settings: AppearanceSettings;
  storageMode: FileStorageMode;
};

type SettingsSectionKey = "appearance" | "bridge" | "layout" | "storage";

type CollapsibleSectionProps = {
  children: ReactNode;
  description?: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
  title: string;
};

function CollapsibleSection({
  children,
  description,
  open,
  onToggle,
  testId,
  title,
}: CollapsibleSectionProps) {
  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-background/45 shadow-sm">
      <button
        aria-controls={`${testId}-content`}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        data-testid={testId}
        onClick={onToggle}
        type="button"
      >
        <div>
          <h3 className="text-sm font-medium text-popover-foreground">{title}</h3>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div className="border-t border-border/70 px-5 py-5" data-testid={`${testId}-content`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function getPrimaryFontName(fontFamily: string) {
  return fontFamily
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
}

type BridgeStatCardProps = {
  label: string;
  tooltip: string;
  value: string | number;
};

function BridgeStatCard({ label, tooltip, value }: BridgeStatCardProps) {
  return (
    <div className="group relative rounded-2xl bg-muted/35 px-3 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span>{label}</span>
        <span
          aria-label={`${label} help`}
          className="inline-flex rounded-full text-muted-foreground/80 outline-none transition-colors group-hover:text-foreground group-focus-within:text-foreground"
          tabIndex={0}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </span>
      </div>
      <div
        className={cn(
          "pointer-events-none absolute left-3 top-2 z-10 max-w-64 -translate-y-full rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] normal-case tracking-normal text-popover-foreground opacity-0 shadow-lg transition-opacity",
          "group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        role="tooltip"
      >
        {tooltip}
      </div>
      <div className="mt-1 break-all text-sm text-foreground">{value}</div>
    </div>
  );
}

function getChoiceButtonClass(selected: boolean) {
  return cn(
    "rounded-2xl border px-4 py-3 text-left transition-colors",
    selected
      ? "border-foreground/40 bg-muted/55 text-foreground"
      : "border-border/70 bg-transparent text-foreground hover:border-foreground/20 hover:bg-muted/30",
  );
}

export function SettingsDialog({
  autosaveEnabled,
  bridgePanel,
  bridgeEnabled,
  fontPresets,
  hasSavedFile,
  layoutSettings,
  nativeFolderName,
  nativeFolderSupported,
  onAutosaveEnabledChange,
  onLayoutSettingsChange,
  onBridgeEnabledChange,
  onOpenChange,
  onRequestNativeFolder,
  onPageWidthModeChange,
  onSidebarSideChange,
  onSettingsChange,
  onStorageModeChange,
  open,
  pageWidthMode,
  sidebarSide,
  settings,
  storageMode,
}: SettingsDialogProps) {
  const [openSections, setOpenSections] = useState<Record<SettingsSectionKey, boolean>>({
    appearance: true,
    bridge: false,
    layout: false,
    storage: false,
  });

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;

    setOpenSections({
      appearance: true,
      bridge: false,
      layout: false,
      storage: false,
    });
  }, [open]);

  const selectedPreset =
    fontPresets.find((preset) => preset.id === settings.fontPresetId) ?? fontPresets[0];

  if (!open || !selectedPreset) {
    return null;
  }

  const previewStyle = {
    fontFamily: selectedPreset.sans,
    fontSize: `${settings.baseFontSize}px`,
  } satisfies CSSProperties;
  const sansFontName = getPrimaryFontName(selectedPreset.sans);
  const monoFontName = getPrimaryFontName(selectedPreset.mono);

  return (
    <>
      <button
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        type="button"
      />

      <div
        aria-labelledby="settings-dialog-title"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        data-testid="settings-dialog"
        role="dialog"
      >
        <div className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-popover p-6 shadow-2xl">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Settings2 className="h-4 w-4" />
                Appearance
              </div>
              <h2
                className="text-2xl font-semibold text-popover-foreground"
                id="settings-dialog-title"
              >
                Settings
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Adjust the editor’s default font personality and base reading size.
              </p>
            </div>

            <Button
              aria-label="Close settings"
              onClick={() => onOpenChange(false)}
              size="icon"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-6">
            <CollapsibleSection
              description="Font size and type choices for the editor and rendered content."
              onToggle={() =>
                setOpenSections((previous) => ({
                  ...previous,
                  appearance: !previous.appearance,
                }))
              }
              open={openSections.appearance}
              testId="settings-section-appearance"
              title="Appearance"
            >
              <div className="space-y-6">
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label
                      className="text-sm font-medium text-popover-foreground"
                      htmlFor="base-font-size"
                    >
                      Base Font Size
                    </label>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {settings.baseFontSize}px
                    </span>
                  </div>

                  <input
                    className="w-full accent-foreground"
                    id="base-font-size"
                    max={22}
                    min={8}
                    onChange={(event) => {
                      onSettingsChange({
                        ...settings,
                        baseFontSize: Number(event.target.value),
                      });
                    }}
                    step={1}
                    type="range"
                    value={settings.baseFontSize}
                  />
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-medium text-popover-foreground">Font Family</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {fontPresets.map((preset) => {
                      const selected = preset.id === settings.fontPresetId;

                      return (
                        <button
                          key={preset.id}
                          className={getChoiceButtonClass(selected)}
                          onClick={() => {
                            onSettingsChange({
                              ...settings,
                              fontPresetId: preset.id,
                            });
                          }}
                          type="button"
                        >
                          <div className="text-sm font-semibold">{preset.label}</div>
                          <div
                            className="mt-2 text-xs text-muted-foreground"
                            style={{ fontFamily: preset.sans }}
                          >
                            {preset.preview}
                          </div>
                          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                            <div>Text: {getPrimaryFontName(preset.sans)}</div>
                            <div>Code: {getPrimaryFontName(preset.mono)}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="border-t border-border/70 pt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Preview
                  </div>
                  <div className="mb-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>
                      <span className="font-medium text-foreground">Text font:</span> {sansFontName}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Code font:</span> {monoFontName}
                    </div>
                  </div>
                  <div className="space-y-2 text-foreground" style={previewStyle}>
                    <p>The quick brown fox jumps over the lazy dog.</p>
                    <p className="text-muted-foreground">
                      Live preview reflects your current font and base size choices.
                    </p>
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              description="Local agent bridge discovery, connection state, and configuration for CLI or MCP clients."
              onToggle={() =>
                setOpenSections((previous) => ({
                  ...previous,
                  bridge: !previous.bridge,
                }))
              }
              open={openSections.bridge}
              testId="settings-section-bridge"
              title="Agent Bridge"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 border-b border-border/70 pb-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      Enable Agent Integration
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Off by default. When enabled, Underwritten looks for its local bridge on this
                      device. Your browser may show a permission prompt before allowing that
                      connection.
                    </div>
                  </div>

                  <button
                    aria-checked={bridgeEnabled}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                      bridgeEnabled ? "border-foreground bg-foreground" : "border-border bg-muted"
                    }`}
                    data-testid="mcp-enabled-toggle"
                    onClick={() => onBridgeEnabledChange(!bridgeEnabled)}
                    role="switch"
                    type="button"
                  >
                    <span className="sr-only">Toggle agent integration</span>
                    <span
                      className={`inline-block h-5 w-5 rounded-full bg-background transition-transform ${
                        bridgeEnabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">Status</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {bridgePanel.statusLabel}
                      </div>
                    </div>

                    <div
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        bridgePanel.state === "connected"
                          ? "bg-emerald-100 text-emerald-800"
                          : bridgePanel.state === "disabled"
                            ? "bg-slate-200 text-slate-700"
                            : bridgePanel.state === "reachable"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {bridgePanel.state}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <BridgeStatCard
                      label="Session ID"
                      tooltip="The browser session identifier Underwritten uses when pairing this tab with a local bridge."
                      value={bridgePanel.currentSessionId}
                    />
                    <BridgeStatCard
                      label="Bridge Port"
                      tooltip="The localhost port for the shared Underwritten bridge this tab is currently using."
                      value={bridgePanel.primaryPort ?? "Not connected"}
                    />
                  </div>

                  {bridgePanel.errorMessage ? (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                      {bridgePanel.errorMessage}
                    </div>
                  ) : null}
                </div>

                <p className="text-sm leading-6 text-muted-foreground">
                  Setup details live on the{" "}
                  <Link className="underline underline-offset-4 hover:text-foreground" to="/about">
                    About page
                  </Link>
                  .
                </p>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              description="Choose where the sidebar lives and how much horizontal space the page uses."
              onToggle={() =>
                setOpenSections((previous) => ({
                  ...previous,
                  layout: !previous.layout,
                }))
              }
              open={openSections.layout}
              testId="settings-section-layout"
              title="Layout"
            >
              <div className="space-y-6">
                <div>
                  <h3 className="mb-3 text-sm font-medium text-popover-foreground">Sidebar Side</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["left", "right"] as SidebarSide[]).map((side) => {
                      const selected = side === sidebarSide;

                      return (
                        <button
                          key={side}
                          className={getChoiceButtonClass(selected)}
                          onClick={() => onSidebarSideChange(side)}
                          type="button"
                        >
                          <div className="text-sm font-semibold capitalize">{side}</div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Keep the file browser on the {side} side of the editor.
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-medium text-popover-foreground">Page Width</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        {
                          description:
                            "Keep the centered layout with deliberate negative space around the page.",
                          id: "responsive",
                          label: "Responsive",
                        },
                        {
                          description:
                            "Let the editor and read view expand to use as much horizontal space as possible.",
                          id: "fill",
                          label: "Fill Space",
                        },
                      ] as const
                    ).map((option) => {
                      const selected = option.id === pageWidthMode;

                      return (
                        <button
                          key={option.id}
                          className={getChoiceButtonClass(selected)}
                          onClick={() => onPageWidthModeChange(option.id)}
                          type="button"
                        >
                          <div className="text-sm font-semibold">{option.label}</div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {option.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-border/70 pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-foreground">Line Numbers</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Show subtle gutter line numbers in write and read mode without shifting the
                        centered content column.
                      </div>
                    </div>

                    <button
                      aria-checked={layoutSettings.showLineNumbers}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                        layoutSettings.showLineNumbers
                          ? "border-foreground bg-foreground"
                          : "border-border bg-muted"
                      }`}
                      data-testid="line-numbers-toggle"
                      onClick={() =>
                        onLayoutSettingsChange({
                          showLineNumbers: !layoutSettings.showLineNumbers,
                        })
                      }
                      role="switch"
                      type="button"
                    >
                      <span className="sr-only">Toggle line numbers</span>
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-background transition-transform ${
                          layoutSettings.showLineNumbers ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              description="Choose where files are stored and which native folder to use."
              onToggle={() =>
                setOpenSections((previous) => ({
                  ...previous,
                  storage: !previous.storage,
                }))
              }
              open={openSections.storage}
              testId="settings-section-storage"
              title="File Storage"
            >
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      {
                        description: "Use the browser’s origin-private file system.",
                        id: "origin-private",
                        label: "Origin Storage",
                      },
                      {
                        description: nativeFolderSupported
                          ? "Use a folder you choose from the native file system."
                          : "Native folder access is unavailable in this browser.",
                        id: "native-folder",
                        label: "Native Folder",
                      },
                    ] as const
                  ).map((option) => {
                    const selected = option.id === storageMode;

                    return (
                      <button
                        key={option.id}
                        className={getChoiceButtonClass(selected)}
                        onClick={() => {
                          if (option.id === "native-folder" && !nativeFolderSupported) {
                            return;
                          }

                          onStorageModeChange(option.id);
                        }}
                        type="button"
                      >
                        <div className="text-sm font-semibold">{option.label}</div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {option.description}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {!nativeFolderSupported ? (
                  <div className="rounded-2xl bg-muted/35 px-4 py-4 text-sm text-muted-foreground">
                    Native folder access depends on the File System Access API, which is not
                    available in every browser.{" "}
                    <a
                      className="font-medium text-foreground underline underline-offset-4"
                      href="https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker"
                      rel="noreferrer"
                      target="_blank"
                    >
                      See browser support on MDN
                    </a>
                    .
                  </div>
                ) : null}

                <div className="border-t border-border/70 pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-foreground">Autosave</div>
                      <div
                        className="mt-1 text-sm text-muted-foreground"
                        data-testid="autosave-description"
                      >
                        {hasSavedFile
                          ? "Automatically save edits to the current file after a short pause."
                          : "Autosave only runs after the current file has been saved once."}
                      </div>
                    </div>

                    <button
                      aria-checked={autosaveEnabled}
                      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                        autosaveEnabled
                          ? "border-foreground bg-foreground"
                          : "border-border bg-muted"
                      }`}
                      data-testid="autosave-toggle"
                      onClick={() => onAutosaveEnabledChange(!autosaveEnabled)}
                      role="switch"
                      type="button"
                    >
                      <span className="sr-only">Toggle autosave</span>
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-background transition-transform ${
                          autosaveEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {storageMode === "native-folder" ? (
                  <div className="rounded-2xl bg-muted/35 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">Chosen folder</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {nativeFolderName ?? "No folder selected yet"}
                        </div>
                      </div>

                      <Button
                        disabled={!nativeFolderSupported}
                        onClick={onRequestNativeFolder}
                        type="button"
                        variant="outline"
                      >
                        Choose Folder
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </CollapsibleSection>
          </div>
        </div>
      </div>
    </>
  );
}
