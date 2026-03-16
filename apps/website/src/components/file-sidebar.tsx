import { type ReactNode, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  PencilLine,
  Save,
  Trash2,
} from "lucide-react";

import type { BrowserTreeEntry, FileStorageMode } from "../lib/file-system";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type SidebarSide = "left" | "right";

type FileSidebarProps = {
  collapsed: boolean;
  currentFilePath: string | null;
  entriesByPath: Record<string, BrowserTreeEntry[]>;
  errorMessage: string | null;
  expandedDirectories: string[];
  folderName: string | null;
  hasUnsavedChanges: boolean;
  loadingPaths: string[];
  nativeFolderSupported: boolean;
  onChangeFolder: () => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onCreateFolder: () => void;
  onDeleteSelected: () => void;
  onExportCurrentFile: () => void;
  onExportWorkspace: () => void;
  onMovePath: (sourcePath: string, destinationDirectoryPath: string) => void;
  onNewFile: () => void;
  onOpenFile: (filePath: string) => void;
  onRenameSelected: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onToggleDirectory: (directoryPath: string) => void;
  selectedPath: string | null;
  saveDisabled?: boolean;
  side: SidebarSide;
  storageMode: FileStorageMode;
};

function formatTimestamp(updatedAt: number | null) {
  if (updatedAt === null) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(updatedAt);
}

function pathDepth(path: string) {
  return path.split("/").filter(Boolean).length;
}

function useIsMobileViewport() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 1023px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateMatches = (matches: boolean) => {
      setIsMobileViewport(matches);
    };

    updateMatches(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      const handleChange = (event: MediaQueryListEvent) => {
        updateMatches(event.matches);
      };

      mediaQuery.addEventListener("change", handleChange);
      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }

    const legacyListener = (event: MediaQueryListEvent) => {
      updateMatches(event.matches);
    };

    mediaQuery.addListener(legacyListener);
    return () => {
      mediaQuery.removeListener(legacyListener);
    };
  }, []);

  return isMobileViewport;
}

function SaveButtonIcon({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }) {
  return (
    <span className="relative inline-flex shrink-0">
      <Save className="h-4 w-4" />
      {hasUnsavedChanges ? (
        <span
          aria-label="Unsaved"
          className="group/unsaved absolute -right-1 -top-1 flex h-2.5 w-2.5 items-center justify-center"
          data-testid="unsaved-indicator"
          title="Unsaved"
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full border border-background bg-orange-500 shadow-sm"
          />
          <span className="pointer-events-none absolute -top-8 right-0 rounded-md bg-foreground px-2 py-1 text-[10px] font-medium whitespace-nowrap text-background opacity-0 shadow-sm transition-opacity group-hover/unsaved:opacity-100">
            Unsaved
          </span>
        </span>
      ) : null}
    </span>
  );
}

export function FileSidebar({
  collapsed,
  currentFilePath,
  entriesByPath,
  errorMessage,
  expandedDirectories,
  folderName,
  hasUnsavedChanges,
  loadingPaths,
  nativeFolderSupported,
  onChangeFolder,
  onCollapsedChange,
  onCreateFolder,
  onDeleteSelected,
  onExportCurrentFile,
  onExportWorkspace,
  onMovePath,
  onNewFile,
  onOpenFile,
  onRenameSelected,
  onSave,
  onSaveAs,
  onToggleDirectory,
  selectedPath,
  saveDisabled = false,
  side,
  storageMode,
}: FileSidebarProps) {
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const isMobileViewport = useIsMobileViewport();
  const isOriginStorage = storageMode === "origin-private";
  const storageLabel = storageMode === "native-folder" ? "Native Folder" : "Origin Storage";
  const CollapseIcon = side === "right" ? ChevronRight : ChevronLeft;
  const ExpandIcon = side === "right" ? ChevronLeft : ChevronRight;
  const sidebarPositionClass =
    side === "right" ? "lg:fixed lg:right-0 lg:left-auto" : "lg:fixed lg:left-0 lg:right-auto";
  const sidebarDividerClass = side === "right" ? "lg:border-l" : "lg:border-r";
  const rootEntries = entriesByPath[""] ?? [];
  const hasSelection = selectedPath !== null;
  const MobileToggleIcon = collapsed ? ChevronUp : ChevronDown;
  const toggleButtonLabel = isMobileViewport
    ? collapsed
      ? "Open file drawer"
      : "Close file drawer"
    : collapsed
      ? "Expand file sidebar"
      : "Collapse file sidebar";

  const isValidDropTarget = (sourcePath: string, destinationDirectoryPath: string) => {
    const sourceName = sourcePath.split("/").filter(Boolean).at(-1);
    if (!sourceName) return false;

    const destinationPath = [destinationDirectoryPath, sourceName].filter(Boolean).join("/");
    return destinationPath !== sourcePath && !destinationPath.startsWith(`${sourcePath}/`);
  };

  const renderTree = (directoryPath = ""): ReactNode => {
    const entries = entriesByPath[directoryPath] ?? [];

    if (entries.length === 0) {
      return null;
    }

    return entries.map((entry) => {
      const isDirectory = entry.kind === "directory";
      const isExpanded = expandedDirectories.includes(entry.path);
      const isSelected = selectedPath === entry.path || currentFilePath === entry.path;
      const isLoading = loadingPaths.includes(entry.path);
      const isDropTarget = dropTargetPath === entry.path;
      const indent = pathDepth(entry.path) * 0.75;

      return (
        <div key={entry.path}>
          <div
            className={`flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
              isDropTarget
                ? "bg-primary/10 ring-1 ring-primary/40"
                : isSelected
                  ? "bg-muted"
                  : "hover:bg-muted/60"
            }`}
            data-drop-target={isDropTarget}
            data-testid={`tree-row-${entry.path}`}
            onDragOver={(event) => {
              if (!isDirectory) return;
              if (!draggedPath || !isValidDropTarget(draggedPath, entry.path)) return;
              event.preventDefault();
              event.stopPropagation();
              if (dropTargetPath !== entry.path) {
                setDropTargetPath(entry.path);
              }
            }}
            onDragLeave={(event) => {
              if (!isDirectory) return;
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              if (dropTargetPath === entry.path) {
                setDropTargetPath(null);
              }
            }}
            onDrop={(event) => {
              if (!isDirectory) return;
              const sourcePath = event.dataTransfer.getData("text/plain");
              if (!sourcePath || !isValidDropTarget(sourcePath, entry.path)) return;
              event.preventDefault();
              event.stopPropagation();
              setDropTargetPath(null);
              onMovePath(sourcePath, entry.path);
            }}
            style={{ paddingLeft: `${0.5 + indent}rem` }}
          >
            {isDirectory ? (
              <button
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${entry.name}`}
                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-background"
                data-testid={`tree-toggle-${entry.path}`}
                onClick={() => onToggleDirectory(entry.path)}
                type="button"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            ) : (
              <span className="block h-6 w-6" />
            )}

            <button
              className="min-w-0 flex-1 rounded-md px-1 py-1 text-left"
              data-testid={`tree-entry-${entry.path}`}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", entry.path);
                event.dataTransfer.effectAllowed = "move";
                setDraggedPath(entry.path);
              }}
              onDragEnd={() => {
                setDraggedPath(null);
                setDropTargetPath(null);
              }}
              onClick={() => {
                if (isDirectory) {
                  onToggleDirectory(entry.path);
                  return;
                }

                onOpenFile(entry.path);
              }}
              type="button"
            >
              <div className="flex items-center gap-2">
                {isDirectory ? (
                  isExpanded ? (
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm font-medium text-foreground">{entry.name}</span>
              </div>
              {!isDirectory && entry.updatedAt !== null ? (
                <div className="mt-1 pl-6 text-xs text-muted-foreground">
                  {formatTimestamp(entry.updatedAt)}
                </div>
              ) : null}
              {isDirectory && isLoading ? (
                <div className="mt-1 pl-6 text-xs text-muted-foreground">Loading…</div>
              ) : null}
            </button>
          </div>

          {isDirectory && isExpanded ? renderTree(entry.path) : null}
        </div>
      );
    });
  };

  const renderCompactActionButtons = (direction: "column" | "row") => {
    const isRowLayout = direction === "row";

    return (
      <div
        className={
          isRowLayout
            ? "flex min-w-0 flex-1 items-center justify-end gap-2 overflow-x-auto"
            : "mt-4 flex flex-col items-center gap-2"
        }
      >
        <Button
          aria-label="New file"
          className={isRowLayout ? "shrink-0 rounded-2xl" : undefined}
          data-testid="sidebar-new-file"
          onClick={onNewFile}
          size={isRowLayout ? "icon" : "icon-sm"}
          type="button"
          variant="outline"
        >
          <FilePlus2 className="h-4 w-4" />
        </Button>
        <Button
          aria-label="Save file"
          className={isRowLayout ? "shrink-0 rounded-2xl" : undefined}
          data-testid="sidebar-save"
          disabled={saveDisabled}
          onContextMenu={(event) => {
            event.preventDefault();
            onSaveAs();
          }}
          onClick={onSave}
          size={isRowLayout ? "icon" : "icon-sm"}
          type="button"
          variant="outline"
        >
          <SaveButtonIcon hasUnsavedChanges={hasUnsavedChanges} />
        </Button>
      </div>
    );
  };

  const renderExpandedContent = () => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button data-testid="sidebar-new-file" onClick={onNewFile} type="button" variant="outline">
          <FilePlus2 className="h-4 w-4" />
          New
        </Button>
        <Button
          data-testid="sidebar-new-folder"
          onClick={onCreateFolder}
          type="button"
          variant="outline"
        >
          <FolderPlus className="h-4 w-4" />
          Folder
        </Button>
        <Button
          data-testid="sidebar-save"
          disabled={saveDisabled}
          onContextMenu={(event) => {
            event.preventDefault();
            onSaveAs();
          }}
          onClick={onSave}
          type="button"
          variant="outline"
        >
          <SaveButtonIcon hasUnsavedChanges={hasUnsavedChanges} />
          Save
        </Button>
        <Button
          data-testid="sidebar-rename"
          disabled={!hasSelection}
          onClick={onRenameSelected}
          type="button"
          variant="outline"
        >
          <PencilLine className="h-4 w-4" />
          Rename
        </Button>
        <Button
          data-testid="sidebar-delete"
          disabled={!hasSelection}
          onClick={onDeleteSelected}
          type="button"
          variant="outline"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
        {isOriginStorage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="sidebar-export" type="button" variant="outline">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                data-testid="sidebar-export-current-file"
                onClick={onExportCurrentFile}
              >
                Export current file
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="sidebar-export-workspace" onClick={onExportWorkspace}>
                Export workspace as ZIP
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            data-testid="sidebar-change-folder"
            disabled={!nativeFolderSupported}
            onClick={onChangeFolder}
            type="button"
            variant="outline"
          >
            <FolderOpen className="h-4 w-4" />
            Change Folder
          </Button>
        )}
      </div>

      <div className="mb-4 border-b border-border/50 pb-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-foreground">Current file</span>
        </div>
        <div className="mt-2 break-all text-muted-foreground" data-testid="current-file-name">
          {currentFilePath ?? "Not saved yet"}
        </div>
        {storageMode === "native-folder" ? (
          <div className="mt-2 text-xs text-muted-foreground" data-testid="native-folder-name">
            {folderName ? `Folder: ${folderName}` : "No native folder selected"}
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <div
          className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="file-error"
        >
          {errorMessage}
        </div>
      ) : null}

      {!nativeFolderSupported && storageMode === "native-folder" ? (
        <div className="border-b border-border/50 pb-4 text-sm text-muted-foreground">
          Native folder access is unavailable in this browser.
        </div>
      ) : isLoadingRoot(loadingPaths) && rootEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading files…</p>
      ) : rootEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files or folders yet.</p>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto rounded-xl px-1"
          data-testid="tree-root-dropzone"
          onDragOver={(event) => {
            if (!draggedPath || !isValidDropTarget(draggedPath, "")) return;
            event.preventDefault();
            event.stopPropagation();
            if (dropTargetPath !== "") {
              setDropTargetPath("");
            }
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            if (dropTargetPath === "") {
              setDropTargetPath(null);
            }
          }}
          onDrop={(event) => {
            const sourcePath = event.dataTransfer.getData("text/plain");
            if (!sourcePath || !isValidDropTarget(sourcePath, "")) return;
            event.preventDefault();
            event.stopPropagation();
            setDropTargetPath(null);
            onMovePath(sourcePath, "");
          }}
        >
          <div
            className={`mb-2 flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm transition-colors ${
              dropTargetPath === ""
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/60 bg-background/40 text-muted-foreground"
            }`}
            data-drop-target={dropTargetPath === ""}
            data-testid="tree-root-row"
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="font-medium">Root</span>
            <span className="text-xs opacity-80">Drop here to move to the top level</span>
          </div>
          {renderTree("")}
        </div>
      )}
    </div>
  );

  if (isMobileViewport) {
    return (
      <>
        {!collapsed ? (
          <button
            aria-hidden="true"
            className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px] lg:hidden"
            onClick={() => onCollapsedChange(true)}
            type="button"
          />
        ) : null}

        <aside
          className={`fixed inset-x-3 bottom-3 z-40 overflow-hidden rounded-[1.75rem] border border-border/70 bg-background/95 shadow-2xl backdrop-blur transition-[max-height,padding] ${
            collapsed ? "px-3 py-3" : "flex max-h-[72vh] flex-col px-4 py-4"
          }`}
          data-collapsed={collapsed}
          data-mobile-layout="drawer"
          data-side={side}
          data-testid="file-sidebar"
        >
          {collapsed ? (
            <div className="flex items-center gap-2">
              <Button
                aria-label={toggleButtonLabel}
                className="shrink-0 rounded-2xl"
                data-testid="sidebar-toggle"
                onClick={() => onCollapsedChange(false)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <MobileToggleIcon className="h-4 w-4" />
              </Button>

              {renderCompactActionButtons("row")}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-5 flex items-start justify-between gap-3 border-b border-border/50 pb-4">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Workspace
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-foreground">Files</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{storageLabel}</p>
                </div>

                <Button
                  aria-label={toggleButtonLabel}
                  data-testid="sidebar-toggle"
                  onClick={() => onCollapsedChange(true)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <MobileToggleIcon className="h-4 w-4" />
                </Button>
              </div>

              {renderExpandedContent()}
            </div>
          )}
        </aside>
      </>
    );
  }

  return (
    <aside
      className={`w-full shrink-0 bg-muted/30 transition-[width,padding] lg:top-0 lg:bottom-0 lg:z-20 lg:flex lg:h-screen lg:flex-col lg:overflow-hidden ${sidebarPositionClass} ${sidebarDividerClass} ${
        collapsed ? "px-2 py-3 lg:w-16" : "px-4 py-5 lg:w-80"
      }`}
      data-collapsed={collapsed}
      data-mobile-layout="sidebar"
      data-side={side}
      data-testid="file-sidebar"
    >
      <div
        className={`flex items-start justify-between gap-3 ${
          collapsed ? "" : "mb-5 border-b border-border/50 pb-4"
        }`}
      >
        <Button
          aria-label={toggleButtonLabel}
          data-testid="sidebar-toggle"
          onClick={() => onCollapsedChange(!collapsed)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {collapsed ? <ExpandIcon className="h-4 w-4" /> : <CollapseIcon className="h-4 w-4" />}
        </Button>

        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Workspace
            </div>
            <h2 className="mt-2 text-lg font-semibold text-foreground">Files</h2>
            <p className="mt-1 text-sm text-muted-foreground">{storageLabel}</p>
          </div>
        ) : null}
      </div>

      {collapsed ? renderCompactActionButtons("column") : renderExpandedContent()}
    </aside>
  );
}

function isLoadingRoot(loadingPaths: string[]) {
  return loadingPaths.includes("");
}
