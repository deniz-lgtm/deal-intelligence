"use client";

import React, { useState, useEffect } from "react";
import {
  X, Folder, FileText, Check, Loader2, ChevronLeft, Cloud,
  HardDrive, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Provider = "dropbox" | "google_drive";

interface CloudFile {
  id: string;
  name: string;
  isFolder: boolean;
  supported: boolean;
  path?: string; // Dropbox uses path
}

interface Props {
  dealId: string;
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export default function CloudImportModal({ dealId, open, onClose, onImported }: Props) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [dropboxStatus, setDropboxStatus] = useState<{ connected: boolean; email?: string } | null>(null);
  const [gdriveStatus, setGdriveStatus] = useState<{ configured: boolean; connected: boolean; email?: string } | null>(null);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Dropbox: path-based navigation
  const [currentPath, setCurrentPath] = useState("/");
  const [pathStack, setPathStack] = useState<string[]>([]);
  // Google Drive: folder ID-based navigation
  const [currentFolderId, setCurrentFolderId] = useState("root");
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([]);

  // Check connection status on mount
  useEffect(() => {
    if (!open) return;
    fetch("/api/dropbox/status").then(r => r.json()).then(j => setDropboxStatus(j.data || j)).catch(() => setDropboxStatus({ connected: false }));
    fetch("/api/google-drive/status").then(r => r.json()).then(j => setGdriveStatus(j.data || { configured: false, connected: false })).catch(() => setGdriveStatus({ configured: false, connected: false }));
  }, [open]);

  // Browse files when provider changes or navigation changes
  useEffect(() => {
    if (!provider) return;
    setLoading(true);
    setSelected(new Set());

    if (provider === "dropbox") {
      fetch(`/api/dropbox/browse?path=${encodeURIComponent(currentPath)}`)
        .then(r => r.json())
        .then(j => {
          const entries = j.data || j.entries || [];
          setFiles(entries.map((e: any) => ({
            id: e.path_lower || e.id || e.name,
            name: e.name,
            isFolder: e[".tag"] === "folder" || e.isFolder,
            supported: e.supported ?? true,
            path: e.path_lower || e.path_display,
          })));
        })
        .catch(() => toast.error("Failed to browse Dropbox"))
        .finally(() => setLoading(false));
    } else {
      fetch(`/api/google-drive/browse?folder_id=${encodeURIComponent(currentFolderId)}`)
        .then(r => r.json())
        .then(j => {
          const entries = j.data || [];
          setFiles(entries.map((e: any) => ({
            id: e.id,
            name: e.name,
            isFolder: e.isFolder,
            supported: e.supported ?? true,
          })));
        })
        .catch(() => toast.error("Failed to browse Google Drive"))
        .finally(() => setLoading(false));
    }
  }, [provider, currentPath, currentFolderId]);

  const navigateToFolder = (file: CloudFile) => {
    if (provider === "dropbox") {
      setPathStack(prev => [...prev, currentPath]);
      setCurrentPath(file.path || file.name);
    } else {
      setFolderStack(prev => [...prev, { id: currentFolderId, name: "Back" }]);
      setCurrentFolderId(file.id);
    }
  };

  const navigateBack = () => {
    if (provider === "dropbox") {
      const prev = pathStack[pathStack.length - 1] || "/";
      setPathStack(s => s.slice(0, -1));
      setCurrentPath(prev);
    } else {
      const prev = folderStack[folderStack.length - 1];
      setFolderStack(s => s.slice(0, -1));
      setCurrentFolderId(prev?.id || "root");
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllFiles = () => {
    const fileIds = files.filter(f => !f.isFolder && f.supported).map(f => f.id);
    setSelected(new Set(fileIds));
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      if (provider === "dropbox") {
        const paths = Array.from(selected);
        const res = await fetch("/api/dropbox/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deal_id: dealId, paths }),
        });
        const json = await res.json();
        const data = json.data || json;
        toast.success(`Imported ${data.imported || 0} files${data.skipped ? `, ${data.skipped} skipped (duplicates)` : ""}`);
      } else {
        const file_ids = Array.from(selected);
        const res = await fetch("/api/google-drive/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deal_id: dealId, file_ids }),
        });
        const json = await res.json();
        const data = json.data || json;
        toast.success(`Imported ${data.imported || 0} files${data.skipped ? `, ${data.skipped} skipped` : ""}`);
      }
      onImported?.();
      onClose();
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleDisconnect = async () => {
    if (provider === "dropbox") {
      await fetch("/api/dropbox/disconnect", { method: "POST" });
      setDropboxStatus({ connected: false });
    } else {
      await fetch("/api/google-drive/disconnect", { method: "POST" });
      setGdriveStatus({ configured: true, connected: false });
    }
    setProvider(null);
    toast.success("Disconnected");
  };

  if (!open) return null;

  const canGoBack = provider === "dropbox" ? pathStack.length > 0 : folderStack.length > 0;
  const isConnected = provider === "dropbox" ? dropboxStatus?.connected : gdriveStatus?.connected;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Import from Cloud</h3>
            {provider && isConnected && (
              <span className="text-xs text-muted-foreground">
                ({provider === "dropbox" ? dropboxStatus?.email : gdriveStatus?.email})
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* Provider Selector (if not yet chosen) */}
        {!provider && (
          <div className="p-6 space-y-3">
            <p className="text-sm text-muted-foreground mb-4">Choose a cloud storage provider to import files from:</p>
            <button
              onClick={() => {
                if (dropboxStatus?.connected) setProvider("dropbox");
                else window.location.href = `/api/dropbox/auth?deal_id=${dealId}`;
              }}
              className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors text-left"
            >
              <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <HardDrive className="h-5 w-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Dropbox</p>
                <p className="text-xs text-muted-foreground">
                  {dropboxStatus?.connected ? `Connected as ${dropboxStatus.email}` : "Click to connect"}
                </p>
              </div>
              {dropboxStatus?.connected && <Check className="h-4 w-4 text-emerald-400" />}
            </button>

            {gdriveStatus?.configured !== false && (
              <button
                onClick={() => {
                  if (gdriveStatus?.connected) setProvider("google_drive");
                  else window.location.href = `/api/google-drive/auth?deal_id=${dealId}`;
                }}
                className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/30 transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <Cloud className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Google Drive</p>
                  <p className="text-xs text-muted-foreground">
                    {gdriveStatus?.connected ? `Connected as ${gdriveStatus.email}` : "Click to connect"}
                  </p>
                </div>
                {gdriveStatus?.connected && <Check className="h-4 w-4 text-emerald-400" />}
              </button>
            )}
          </div>
        )}

        {/* File Browser */}
        {provider && isConnected && (
          <>
            {/* Navigation bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/10">
              {canGoBack && (
                <button onClick={navigateBack} className="text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => setProvider(null)} className="text-xs text-muted-foreground hover:text-foreground">
                ← Providers
              </button>
              <div className="flex-1" />
              <button onClick={selectAllFiles} className="text-xs text-primary hover:underline">
                Select all files
              </button>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto px-2 py-1" style={{ maxHeight: "400px" }}>
              {loading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : files.length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">No files in this folder</p>
              ) : (
                files.map(f => (
                  <button
                    key={f.id}
                    onClick={() => f.isFolder ? navigateToFolder(f) : f.supported ? toggleSelect(f.id) : null}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-muted/30 transition-colors ${!f.supported && !f.isFolder ? "opacity-40" : ""}`}
                  >
                    {f.isFolder ? (
                      <Folder className="h-4 w-4 text-amber-400 shrink-0" />
                    ) : (
                      <div className={`h-4 w-4 rounded border shrink-0 flex items-center justify-center ${selected.has(f.id) ? "bg-primary border-primary" : "border-border"}`}>
                        {selected.has(f.id) && <Check className="h-2.5 w-2.5 text-white" />}
                      </div>
                    )}
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{f.name}</span>
                    {f.isFolder && <ChevronLeft className="h-3 w-3 text-muted-foreground ml-auto rotate-180" />}
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/10">
              <button onClick={handleDisconnect} className="text-xs text-muted-foreground hover:text-red-400 flex items-center gap-1">
                <LogOut className="h-3 w-3" /> Disconnect
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" onClick={handleImport} disabled={selected.size === 0 || importing}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Import {selected.size > 0 ? `(${selected.size})` : ""}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Not connected state */}
        {provider && !isConnected && (
          <div className="p-6 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              {provider === "dropbox" ? "Connect your Dropbox account to browse and import files." : "Connect your Google Drive account to browse and import files."}
            </p>
            <Button onClick={() => {
              window.location.href = provider === "dropbox"
                ? `/api/dropbox/auth?deal_id=${dealId}`
                : `/api/google-drive/auth?deal_id=${dealId}`;
            }}>
              Connect {provider === "dropbox" ? "Dropbox" : "Google Drive"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
