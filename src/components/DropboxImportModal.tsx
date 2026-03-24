"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Loader2,
  FolderOpen,
  File,
  ChevronRight,
  ChevronLeft,
  Check,
  CloudDownload,
  Link,
  Unlink,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DropboxEntry {
  ".tag": "file" | "folder";
  name: string;
  path_display: string;
  size?: number;
  supported?: boolean;
}

interface DropboxStatus {
  connected: boolean;
  display_name?: string;
  email?: string;
}

interface Props {
  dealId: string;
  onClose: () => void;
  onImportComplete: () => void;
}

export default function DropboxImportModal({ dealId, onClose, onImportComplete }: Props) {
  const [status, setStatus] = useState<DropboxStatus | null>(null);
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [browsing, setBrowsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/dropbox/status");
      const json = await res.json();
      setStatus(json.data);
      if (json.data?.connected) {
        browseFolder("/");
      }
    } catch {
      setStatus({ connected: false });
    }
  };

  const browseFolder = useCallback(async (folderPath: string) => {
    setBrowsing(true);
    setBrowseError(null);
    setSelected(new Set());
    try {
      const res = await fetch(
        `/api/dropbox/browse?path=${encodeURIComponent(folderPath)}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Browse failed");
      setEntries(json.data);
      setCurrentPath(folderPath);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : "Failed to browse folder");
    } finally {
      setBrowsing(false);
    }
  }, []);

  const navigateInto = (entry: DropboxEntry) => {
    if (entry[".tag"] !== "folder") return;
    setPathStack((s) => [...s, currentPath]);
    browseFolder(entry.path_display);
  };

  const navigateBack = () => {
    const prev = pathStack[pathStack.length - 1];
    if (prev === undefined) return;
    setPathStack((s) => s.slice(0, -1));
    browseFolder(prev);
  };

  const toggleSelect = (entry: DropboxEntry) => {
    if (entry[".tag"] === "folder" || !entry.supported) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path_display)) next.delete(entry.path_display);
      else next.add(entry.path_display);
      return next;
    });
  };

  const selectAllFiles = () => {
    const files = entries.filter((e) => e[".tag"] === "file" && e.supported);
    setSelected(new Set(files.map((f) => f.path_display)));
  };

  const doImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      const res = await fetch("/api/dropbox/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, paths: Array.from(selected) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");

      const { imported, skipped, failed } = json.data;
      if (imported > 0) {
        toast.success(
          `Imported ${imported} file${imported !== 1 ? "s" : ""}${skipped > 0 ? `, skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""}` : ""}`
        );
      }
      if (failed?.length > 0) {
        toast.error(`Failed to import: ${failed.join(", ")}`);
      }

      onImportComplete();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const disconnect = async () => {
    await fetch("/api/dropbox/disconnect", { method: "POST" });
    setStatus({ connected: false });
    setEntries([]);
    toast.success("Dropbox disconnected");
  };

  const connectUrl = `/api/dropbox/auth?deal_id=${dealId}`;

  const breadcrumbs = ["/", ...pathStack.slice(1), currentPath !== "/" ? currentPath : null]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  const currentFolderName =
    currentPath === "/" ? "Dropbox" : currentPath.split("/").filter(Boolean).pop();

  const supportedFiles = entries.filter((e) => e[".tag"] === "file" && e.supported);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
              <CloudDownload className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="font-semibold text-sm">Import from Dropbox</p>
              {status?.connected && status.email && (
                <p className="text-xs text-muted-foreground">{status.email}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status?.connected && (
              <button
                onClick={disconnect}
                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors"
              >
                <Unlink className="h-3.5 w-3.5" />
                Disconnect
              </button>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors ml-1"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {status === null ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !status.connected ? (
            // Not connected
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="h-16 w-16 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-center mb-4">
                <CloudDownload className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="font-semibold mb-2">Connect your Dropbox</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm">
                Link your Dropbox account to import deal documents directly from any folder.
                One-time setup — stays connected for all future imports.
              </p>
              <a href={connectUrl}>
                <Button className="gap-2">
                  <Link className="h-4 w-4" />
                  Connect Dropbox
                </Button>
              </a>
            </div>
          ) : (
            // File browser
            <div>
              {/* Path bar */}
              <div className="flex items-center gap-1 px-4 py-2.5 border-b bg-muted/30 text-xs text-muted-foreground">
                <button
                  onClick={navigateBack}
                  disabled={pathStack.length === 0 || browsing}
                  className="hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="truncate font-medium text-foreground">
                  {currentFolderName}
                </span>
                {currentPath !== "/" && (
                  <span className="ml-auto truncate max-w-[260px] opacity-60">
                    {currentPath}
                  </span>
                )}
              </div>

              {browseError ? (
                <div className="flex items-center gap-2 text-destructive text-sm px-5 py-8">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {browseError}
                </div>
              ) : browsing ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : entries.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-12">
                  This folder is empty
                </div>
              ) : (
                <div className="divide-y">
                  {entries.map((entry) => (
                    <EntryRow
                      key={entry.path_display}
                      entry={entry}
                      selected={selected.has(entry.path_display)}
                      onToggle={() => toggleSelect(entry)}
                      onNavigate={() => navigateInto(entry)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {status?.connected && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t bg-muted/20 shrink-0">
            <div className="flex items-center gap-3">
              {supportedFiles.length > 0 && (
                <button
                  onClick={selectAllFiles}
                  className="text-xs text-primary hover:underline"
                >
                  Select all files ({supportedFiles.length})
                </button>
              )}
              {selected.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selected.size} selected
                </span>
              )}
            </div>
            <Button
              onClick={doImport}
              disabled={selected.size === 0 || importing}
              size="sm"
              className="gap-2"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4" />
              )}
              Import {selected.size > 0 ? `${selected.size} file${selected.size !== 1 ? "s" : ""}` : ""}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  selected,
  onToggle,
  onNavigate,
}: {
  entry: DropboxEntry;
  selected: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const isFolder = entry[".tag"] === "folder";
  const unsupported = !isFolder && !entry.supported;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 transition-colors",
        isFolder && "cursor-pointer hover:bg-accent",
        !isFolder && !unsupported && "cursor-pointer hover:bg-accent",
        unsupported && "opacity-40"
      )}
      onClick={isFolder ? onNavigate : !unsupported ? onToggle : undefined}
    >
      {/* Checkbox / icon */}
      {isFolder ? (
        <FolderOpen className="h-4 w-4 text-blue-500 shrink-0" />
      ) : (
        <div
          className={cn(
            "h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors",
            selected
              ? "bg-primary border-primary"
              : "border-border"
          )}
        >
          {selected && <Check className="h-3 w-3 text-primary-foreground" />}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{entry.name}</p>
        {unsupported && (
          <p className="text-xs text-muted-foreground">Unsupported file type</p>
        )}
      </div>

      {isFolder ? (
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      ) : (
        <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
    </div>
  );
}
