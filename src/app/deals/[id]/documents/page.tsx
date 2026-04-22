"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  FileText,
  File,
  Folder,
  Trash2,
  Sparkles,
  Grid3X3,
  Upload,
  Loader2,
  Eye,
  X,
  ExternalLink,
  GripVertical,
  CloudDownload,
  Star,
  History,
  GitCompareArrows,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DocumentUpload from "@/components/DocumentUpload";
import DropboxImportModal from "@/components/DropboxImportModal";
import CloudImportModal from "@/components/CloudImportModal";
import { DOCUMENT_CATEGORIES, AI_REPORT_CATEGORIES, type Document, type DocumentCategory } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { toast } from "sonner";

type ViewMode = "grid" | "folders";

/** Parse an AI summary string into bullet points (split on ". " or newlines) */
function parseSummaryBullets(summary: string): string[] {
  // Split on newlines first, then periods
  const lines = summary
    .split(/\n|(?<=\.) /)
    .map((s) => s.trim().replace(/^[-•*]\s*/, ""))
    .filter((s) => s.length > 4);
  return lines.length > 1 ? lines : [summary];
}

export default function DocumentsPage({ params }: { params: { id: string } }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("folders");
  const [showUpload, setShowUpload] = useState(false);
  const [activeCategory, setActiveCategory] = useState<DocumentCategory | "all">("all");
  // Meta filter that collapses all AI-generated report categories into
  // one chip so analysts can pull up past exports without hunting
  // through four separate folders.
  const [aiReportsOnly, setAiReportsOnly] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [recategorizing, setRecategorizing] = useState<string | null>(null);
  const [showDropbox, setShowDropbox] = useState(false);
  const [versionsForDoc, setVersionsForDoc] = useState<Document | null>(null);

  useEffect(() => {
    loadDocuments();
  }, [params.id]);

  const loadDocuments = async () => {
    try {
      const res = await fetch(`/api/deals/${params.id}/documents`);
      const json = await res.json();
      setDocuments(json.data || []);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  };

  const deleteDocument = async (id: string) => {
    if (!confirm("Delete this document?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/documents/${id}`, { method: "DELETE" });
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (viewingDoc?.id === id) setViewingDoc(null);
      toast.success("Document deleted");
    } catch {
      toast.error("Failed to delete document");
    } finally {
      setDeleting(null);
    }
  };

  const recategorize = useCallback(async (docId: string, newCategory: DocumentCategory) => {
    setRecategorizing(docId);
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: newCategory }),
      });
      if (!res.ok) throw new Error("Failed");
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, category: newCategory } : d))
      );
      toast.success(`Moved to ${DOCUMENT_CATEGORIES[newCategory]?.label}`);
    } catch {
      toast.error("Failed to move document");
    } finally {
      setRecategorizing(null);
    }
  }, []);

  const toggleKeyDocument = useCallback(async (docId: string, isKey: boolean) => {
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_key: isKey }),
      });
      if (!res.ok) throw new Error("Failed");
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, is_key: isKey } : d))
      );
      toast.success(isKey ? "Marked as key document" : "Unmarked key document");
    } catch {
      toast.error("Failed to update document");
    }
  }, []);

  const [reExtracting, setReExtracting] = useState<string | null>(null);
  const reExtract = useCallback(
    async (docId: string) => {
      setReExtracting(docId);
      try {
        const res = await fetch(
          `/api/deals/${params.id}/documents/${docId}/re-extract`,
          { method: "POST" }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || "Re-extraction failed");
          return;
        }
        toast.success(
          "Re-extracted — submarket metrics and market report refreshed"
        );
      } catch {
        toast.error("Re-extraction failed");
      } finally {
        setReExtracting(null);
      }
    },
    [params.id]
  );

  const handleUploadComplete = () => {
    setShowUpload(false);
    loadDocuments();
    toast.success("Documents uploaded and classified");
  };

  const byCategory = documents.reduce<Record<string, Document[]>>((acc, d) => {
    if (!acc[d.category]) acc[d.category] = [];
    acc[d.category].push(d);
    return acc;
  }, {});

  const categories = Object.keys(DOCUMENT_CATEGORIES) as DocumentCategory[];
  const filledCategories = categories.filter((c) => (byCategory[c] || []).length > 0);
  const emptyCategories = categories.filter((c) => !(byCategory[c] || []).length);

  const aiReportSet = new Set<string>(AI_REPORT_CATEGORIES);
  const visibleDocs = (() => {
    if (aiReportsOnly) return documents.filter((d) => aiReportSet.has(d.category));
    if (activeCategory === "all") return documents;
    return documents.filter((d) => d.category === activeCategory);
  })();
  const aiReportCount = documents.filter((d) => aiReportSet.has(d.category)).length;

  const canPreview = (doc: Document) =>
    doc.mime_type === "application/pdf" || doc.mime_type.startsWith("image/");

  return (
    <div className="space-y-5">
      {/* Cloud import modal (Dropbox + Google Drive) */}
      <CloudImportModal
        dealId={params.id}
        open={showDropbox}
        onClose={() => setShowDropbox(false)}
        onImported={() => { setShowDropbox(false); loadDocuments(); }}
      />

      {/* Document viewer modal */}
      {viewingDoc && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
          <div className="flex items-center justify-between bg-card px-4 py-3 border-b shrink-0">
            <div className="flex items-center gap-3">
              <DocFileIcon mimeType={viewingDoc.mime_type} />
              <div>
                <p className="font-medium text-sm">{viewingDoc.original_name}</p>
                <p className="text-xs text-muted-foreground">
                  {DOCUMENT_CATEGORIES[viewingDoc.category as DocumentCategory]?.label} · {formatBytes(viewingDoc.file_size)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a href={`/api/documents/${viewingDoc.id}/view`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-1 text-xs">
                  <ExternalLink className="h-3 w-3" /> Open in tab
                </Button>
              </a>
              <Button variant="ghost" size="icon" onClick={() => setViewingDoc(null)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden bg-muted">
            {viewingDoc.mime_type.startsWith("image/") ? (
              <div className="h-full flex items-center justify-center p-4">
                <img
                  src={`/api/documents/${viewingDoc.id}/view`}
                  alt={viewingDoc.original_name}
                  className="max-h-full max-w-full object-contain rounded"
                />
              </div>
            ) : (
              <iframe
                src={`/api/documents/${viewingDoc.id}/view`}
                className="w-full h-full"
                title={viewingDoc.original_name}
              />
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Documents</h2>
          <p className="text-sm text-muted-foreground">
            {documents.length} document{documents.length !== 1 ? "s" : ""} — drag to move between folders
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("folders")}
              className={`px-3 py-1.5 text-sm transition-colors ${
                viewMode === "folders"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              <Folder className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`px-3 py-1.5 text-sm transition-colors ${
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowDropbox(true)}
            className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            <CloudDownload className="h-4 w-4" />
            Cloud Import
          </Button>
          <Button size="sm" onClick={() => setShowUpload(!showUpload)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </div>
      </div>

      {/* Upload area */}
      {showUpload && (
        <div className="border rounded-xl p-5 bg-card">
          <DocumentUpload
            dealId={params.id}
            onUploadComplete={handleUploadComplete}
          />
        </div>
      )}

      {/* Quick filter chips — "All Docs" + "AI Reports". Keeps analyst-
          uploaded files separate from anything this app generated so past
          proformas / investment packages / DD abstracts / zoning reports
          are easy to pull up. */}
      {!loading && documents.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => { setAiReportsOnly(false); setActiveCategory("all"); }}
            className={`px-3 py-1.5 rounded-full border transition-colors ${
              !aiReportsOnly && activeCategory === "all"
                ? "bg-primary/15 border-primary/40 text-foreground"
                : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
            }`}
          >
            All Documents <span className="text-muted-foreground/70">({documents.length})</span>
          </button>
          {aiReportCount > 0 && (
            <button
              onClick={() => { setAiReportsOnly(true); setActiveCategory("all"); }}
              className={`px-3 py-1.5 rounded-full border transition-colors ${
                aiReportsOnly
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                  : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
              }`}
              title="Proformas, Investment Packages, DD Abstracts, and Zoning Reports generated by the app"
            >
              ✨ AI Reports <span className={aiReportsOnly ? "text-amber-300/70" : "text-muted-foreground/70"}>({aiReportCount})</span>
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-xl">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="font-medium mb-1">No documents yet</p>
          <p className="text-sm text-muted-foreground mb-4">
            Upload documents and AI will automatically classify them into folders
          </p>
          <Button onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload documents
          </Button>
        </div>
      ) : viewMode === "folders" ? (
        <FolderView
          byCategory={byCategory}
          filledCategories={filledCategories}
          emptyCategories={emptyCategories}
          onDelete={deleteDocument}
          onView={(doc) => canPreview(doc) ? setViewingDoc(doc) : window.open(`/api/documents/${doc.id}/view`, "_blank")}
          onRecategorize={recategorize}
          onToggleKey={toggleKeyDocument}
          onShowVersions={(doc) => setVersionsForDoc(doc)}
          onReExtract={reExtract}
          recategorizing={recategorizing}
          deleting={deleting}
          reExtracting={reExtracting}
        />
      ) : (
        <GridView
          documents={visibleDocs}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          onDelete={deleteDocument}
          onView={(doc) => canPreview(doc) ? setViewingDoc(doc) : window.open(`/api/documents/${doc.id}/view`, "_blank")}
          onRecategorize={recategorize}
          recategorizing={recategorizing}
          deleting={deleting}
        />
      )}

      {/* Version history modal */}
      {versionsForDoc && (
        <VersionHistoryModal
          dealId={params.id}
          doc={versionsForDoc}
          onClose={() => setVersionsForDoc(null)}
        />
      )}
    </div>
  );
}

/** Drop target folder component */
function DropFolder({
  category,
  onDrop,
  children,
  className = "",
}: {
  category: DocumentCategory;
  onDrop: (docId: string, newCat: DocumentCategory) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`${className} transition-colors ${over ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const docId = e.dataTransfer.getData("docId");
        if (docId) onDrop(docId, category);
      }}
    >
      {children}
    </div>
  );
}

function FolderView({
  byCategory,
  filledCategories,
  emptyCategories,
  onDelete,
  onView,
  onRecategorize,
  onToggleKey,
  onShowVersions,
  onReExtract,
  recategorizing,
  deleting,
  reExtracting,
}: {
  byCategory: Record<string, Document[]>;
  filledCategories: DocumentCategory[];
  emptyCategories: DocumentCategory[];
  onDelete: (id: string) => void;
  onView: (doc: Document) => void;
  onRecategorize: (docId: string, cat: DocumentCategory) => void;
  onToggleKey: (docId: string, isKey: boolean) => void;
  onShowVersions: (doc: Document) => void;
  onReExtract?: (docId: string) => void;
  recategorizing: string | null;
  deleting: string | null;
  reExtracting?: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(filledCategories));

  const toggle = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const allCategories = Object.keys(DOCUMENT_CATEGORIES) as DocumentCategory[];

  return (
    <div className="grid grid-cols-1 gap-3">
      {allCategories.map((cat) => {
        const catInfo = DOCUMENT_CATEGORIES[cat];
        const docs = byCategory[cat] || [];
        const isExpanded = expanded.has(cat);
        const isEmpty = docs.length === 0;

        return (
          <DropFolder key={cat} category={cat} onDrop={onRecategorize} className="border rounded-xl overflow-hidden bg-card">
            <button
              onClick={() => toggle(cat)}
              className={`w-full flex items-center gap-3 p-4 hover:bg-accent/50 transition-colors ${isEmpty ? "opacity-60" : ""}`}
            >
              <span className="text-xl">{catInfo.icon}</span>
              <div className="flex-1 text-left">
                <p className="font-medium text-sm">{catInfo.label}</p>
                <p className="text-xs text-muted-foreground">
                  {isEmpty ? "Empty — drop documents here" : `${docs.length} document${docs.length !== 1 ? "s" : ""}`}
                </p>
              </div>
              {!isEmpty && (
                <Badge variant="secondary" className="text-xs">
                  {docs.length}
                </Badge>
              )}
            </button>

            {isExpanded && docs.length > 0 && (
              <div className="border-t divide-y">
                {docs.map((doc) => (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    onDelete={onDelete}
                    onView={onView}
                    onRecategorize={onRecategorize}
                    onToggleKey={onToggleKey}
                    onShowVersions={onShowVersions}
                    onReExtract={onReExtract}
                    recategorizing={recategorizing}
                    deleting={deleting}
                    reExtracting={reExtracting}
                  />
                ))}
              </div>
            )}
          </DropFolder>
        );
      })}
    </div>
  );
}

function GridView({
  documents,
  activeCategory,
  onCategoryChange,
  onDelete,
  onView,
  onRecategorize,
  recategorizing,
  deleting,
}: {
  documents: Document[];
  activeCategory: DocumentCategory | "all";
  onCategoryChange: (c: DocumentCategory | "all") => void;
  onDelete: (id: string) => void;
  onView: (doc: Document) => void;
  onRecategorize: (docId: string, cat: DocumentCategory) => void;
  recategorizing: string | null;
  deleting: string | null;
}) {
  return (
    <div>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <button
          onClick={() => onCategoryChange("all")}
          className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
            activeCategory === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "hover:bg-accent border-border"
          }`}
        >
          All ({documents.length})
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {documents.map((doc) => (
          <GridDocCard
            key={doc.id}
            doc={doc}
            onDelete={onDelete}
            onView={onView}
            onRecategorize={onRecategorize}
            recategorizing={recategorizing}
            deleting={deleting}
          />
        ))}
      </div>
    </div>
  );
}

function DocRow({
  doc,
  onDelete,
  onView,
  onRecategorize,
  onToggleKey,
  onShowVersions,
  onReExtract,
  recategorizing,
  deleting,
  reExtracting,
}: {
  doc: Document & { is_key?: boolean };
  onDelete: (id: string) => void;
  onView: (doc: Document) => void;
  onRecategorize: (docId: string, cat: DocumentCategory) => void;
  onToggleKey: (docId: string, isKey: boolean) => void;
  onShowVersions: (doc: Document) => void;
  onReExtract?: (docId: string) => void;
  recategorizing: string | null;
  deleting: string | null;
  reExtracting?: string | null;
}) {
  const [showCatMenu, setShowCatMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bullets = doc.ai_summary ? parseSummaryBullets(doc.ai_summary) : [];

  // Close menu on outside click
  useEffect(() => {
    if (!showCatMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCatMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCatMenu]);

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("docId", doc.id)}
    >
      {/* Drag handle */}
      <GripVertical className="h-4 w-4 text-muted-foreground/40 mt-1 shrink-0 cursor-grab active:cursor-grabbing group-hover:text-muted-foreground transition-colors" />
      <button onClick={() => onView(doc)} className="shrink-0 hover:opacity-70 mt-0.5">
        <DocFileIcon mimeType={doc.mime_type} />
      </button>
      <button
        onClick={() => onToggleKey(doc.id, !doc.is_key)}
        className={`shrink-0 mt-1 transition-colors ${doc.is_key ? "text-amber-400" : "text-muted-foreground/30 hover:text-amber-400/60"}`}
        title={doc.is_key ? "Key document (click to unmark)" : "Mark as key document"}
      >
        <Star className={`h-3.5 w-3.5 ${doc.is_key ? "fill-amber-400" : ""}`} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onView(doc)}
            className="text-sm font-medium truncate text-left hover:text-primary transition-colors"
          >
            {doc.original_name}
          </button>
          {doc.version > 1 && (
            <button
              onClick={() => onShowVersions(doc)}
              className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold uppercase tracking-wide hover:bg-primary/25 transition-colors flex-shrink-0"
              title="View version history"
            >
              v{doc.version}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{formatBytes(doc.file_size)}</p>
        {doc.auto_diff_result && (() => {
          const diff = typeof doc.auto_diff_result === "string"
            ? JSON.parse(doc.auto_diff_result)
            : doc.auto_diff_result;
          if (!diff?.summary) return null;
          const hasMaterial = Array.isArray(diff.changes) && diff.changes.some((c: Record<string, unknown>) => c.severity === "material");
          // "Downstream" delta — if the upload pipeline captured a
          // feasibility snapshot and has a parent snapshot to diff
          // against, we show one compact line here so the analyst
          // can see NOI / cap rate / max-bid movement without opening
          // the version history dialog.
          const ds = diff.downstream as {
            noi_delta: number;
            noi_delta_pct: number;
            cap_rate_delta_bps: number;
            max_bid_delta: number;
          } | undefined;
          const fmtMoney = (n: number) => {
            const abs = Math.abs(n);
            if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
            if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
            return `$${n}`;
          };
          const downstreamText = ds
            ? [
                ds.noi_delta !== 0 ? `NOI ${ds.noi_delta > 0 ? "+" : ""}${fmtMoney(ds.noi_delta)}` : null,
                Math.abs(ds.cap_rate_delta_bps) >= 1
                  ? `cap ${ds.cap_rate_delta_bps > 0 ? "+" : ""}${ds.cap_rate_delta_bps.toFixed(0)}bps`
                  : null,
                ds.max_bid_delta !== 0
                  ? `max bid ${ds.max_bid_delta > 0 ? "+" : ""}${fmtMoney(ds.max_bid_delta)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "";
          return (
            <button
              onClick={() => onShowVersions(doc)}
              className={`mt-1 flex flex-col items-start gap-0.5 text-[10px] p-1.5 rounded-md border transition-colors hover:brightness-110 w-full ${
                hasMaterial
                  ? "bg-amber-500/5 border-amber-500/20 text-amber-200/90"
                  : "bg-blue-500/5 border-blue-500/20 text-blue-200/90"
              }`}
            >
              <span className="flex items-start gap-1.5">
                <GitCompareArrows className="h-3 w-3 flex-shrink-0 mt-0.5" />
                <span className="text-left">{diff.summary}</span>
              </span>
              {downstreamText && (
                <span className="pl-[18px] tabular-nums font-medium">
                  Feasibility impact: {downstreamText}
                </span>
              )}
            </button>
          );
        })()}
        {bullets.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {bullets.slice(0, 3).map((b, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <Sparkles className="h-2.5 w-2.5 text-primary shrink-0 mt-0.5" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onView(doc)}
          className="text-muted-foreground hover:text-primary transition-colors"
          title="Preview"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        {doc.version > 1 && (
          <button
            onClick={() => onShowVersions(doc)}
            className="text-muted-foreground hover:text-primary transition-colors"
            title="Version history + changes"
          >
            <History className="h-3.5 w-3.5" />
          </button>
        )}
        {onReExtract && doc.category === "market" && (
          <button
            onClick={() => onReExtract(doc.id)}
            disabled={reExtracting === doc.id}
            className="text-muted-foreground hover:text-primary transition-colors"
            title="Re-run AI extraction (refresh submarket metrics)"
          >
            {reExtracting === doc.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {/* Recategorize button */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowCatMenu((v) => !v)}
            className="text-muted-foreground hover:text-primary transition-colors"
            title="Move to folder"
            disabled={recategorizing === doc.id}
          >
            {recategorizing === doc.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Folder className="h-3.5 w-3.5" />
            )}
          </button>
          {showCatMenu && (
            <div className="absolute right-0 top-6 z-50 bg-popover border rounded-xl shadow-lg py-1 w-52 max-h-64 overflow-y-auto">
              <p className="text-[10px] text-muted-foreground px-3 py-1 font-medium uppercase tracking-wide">Move to folder</p>
              {(Object.keys(DOCUMENT_CATEGORIES) as DocumentCategory[]).map((cat) => (
                <button
                  key={cat}
                  disabled={cat === doc.category}
                  onClick={() => { setShowCatMenu(false); onRecategorize(doc.id, cat); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left ${cat === doc.category ? "opacity-40 cursor-default" : ""}`}
                >
                  <span>{DOCUMENT_CATEGORIES[cat].icon}</span>
                  <span>{DOCUMENT_CATEGORIES[cat].label}</span>
                  {cat === doc.category && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onDelete(doc.id)}
          disabled={deleting === doc.id}
          className="text-muted-foreground hover:text-destructive transition-colors"
        >
          {deleting === doc.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function GridDocCard({
  doc,
  onDelete,
  onView,
  onRecategorize,
  recategorizing,
  deleting,
}: {
  doc: Document;
  onDelete: (id: string) => void;
  onView: (doc: Document) => void;
  onRecategorize: (docId: string, cat: DocumentCategory) => void;
  recategorizing: string | null;
  deleting: string | null;
}) {
  const [showCatMenu, setShowCatMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bullets = doc.ai_summary ? parseSummaryBullets(doc.ai_summary) : [];

  useEffect(() => {
    if (!showCatMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowCatMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCatMenu]);

  return (
    <div
      className="flex items-start gap-3 p-4 border rounded-xl bg-card hover:shadow-sm transition-all group"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("docId", doc.id)}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground/40 mt-0.5 shrink-0 cursor-grab active:cursor-grabbing group-hover:text-muted-foreground transition-colors" />
      <button onClick={() => onView(doc)} className="shrink-0 hover:opacity-70 transition-opacity">
        <DocFileIcon mimeType={doc.mime_type} />
      </button>
      <div className="flex-1 min-w-0">
        <button
          onClick={() => onView(doc)}
          className="font-medium text-sm truncate text-left hover:text-primary transition-colors block w-full"
        >
          {doc.original_name}
        </button>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="secondary" className="text-xs">
            {DOCUMENT_CATEGORIES[doc.category as DocumentCategory]?.icon}{" "}
            {DOCUMENT_CATEGORIES[doc.category as DocumentCategory]?.label || doc.category}
          </Badge>
          <span className="text-xs text-muted-foreground">{formatBytes(doc.file_size)}</span>
        </div>
        {bullets.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {bullets.slice(0, 3).map((b, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <Sparkles className="h-2.5 w-2.5 text-primary shrink-0 mt-0.5" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onView(doc)}
          className="text-muted-foreground hover:text-primary transition-colors"
          title="Preview"
        >
          <Eye className="h-4 w-4" />
        </button>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowCatMenu((v) => !v)}
            className="text-muted-foreground hover:text-primary transition-colors"
            title="Move to folder"
            disabled={recategorizing === doc.id}
          >
            {recategorizing === doc.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Folder className="h-4 w-4" />
            )}
          </button>
          {showCatMenu && (
            <div className="absolute right-0 top-6 z-50 bg-popover border rounded-xl shadow-lg py-1 w-52 max-h-64 overflow-y-auto">
              <p className="text-[10px] text-muted-foreground px-3 py-1 font-medium uppercase tracking-wide">Move to folder</p>
              {(Object.keys(DOCUMENT_CATEGORIES) as DocumentCategory[]).map((cat) => (
                <button
                  key={cat}
                  disabled={cat === doc.category}
                  onClick={() => { setShowCatMenu(false); onRecategorize(doc.id, cat); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left ${cat === doc.category ? "opacity-40 cursor-default" : ""}`}
                >
                  <span>{DOCUMENT_CATEGORIES[cat].icon}</span>
                  <span>{DOCUMENT_CATEGORIES[cat].label}</span>
                  {cat === doc.category && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onDelete(doc.id)}
          disabled={deleting === doc.id}
          className="text-muted-foreground hover:text-destructive transition-colors"
        >
          {deleting === doc.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

function DocFileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") {
    return <FileText className="h-5 w-5 text-red-500 shrink-0" />;
  }
  if (mimeType.startsWith("image/")) {
    return <File className="h-5 w-5 text-green-500 shrink-0" />;
  }
  return <File className="h-5 w-5 text-blue-500 shrink-0" />;
}

// ── Version History Modal ────────────────────────────────────────────────
//
// Opens when the user clicks a vN chip or History icon on a document row.
// Fetches the full version chain (oldest → newest) and lets the analyst
// run a Claude-powered diff between any version and its parent.

interface VersionRow {
  id: string;
  version: number;
  original_name: string;
  category: string;
  uploaded_at: string;
  parent_document_id: string | null;
  file_size: number;
}

interface DiffResult {
  summary: string;
  no_material_changes: boolean;
  changes: Array<{
    severity: "material" | "minor" | "informational";
    change: string;
  }>;
  previous: { id: string; name: string; version: number };
  current: { id: string; name: string; version: number };
}

function VersionHistoryModal({
  dealId,
  doc,
  onClose,
}: {
  dealId: string;
  doc: Document;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [diffing, setDiffing] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/documents/${doc.id}/versions`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const rows: VersionRow[] = json.data || [];
        setVersions(rows);
      })
      .catch(() => setError("Failed to load version chain"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dealId, doc.id]);

  async function runDiff(versionId: string) {
    setDiffing(versionId);
    setDiff(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/documents/${versionId}/diff`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Diff failed");
        return;
      }
      setDiff(json.data);
    } finally {
      setDiffing(null);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Version History</h3>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs text-muted-foreground">
            Versions auto-chained from filename + category. Click{" "}
            <em>See Changes</em> to compare any version against its parent
            with Claude.
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {error && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded p-2">
              {error}
            </div>
          )}
          {versions && versions.length > 0 && (
            <div className="space-y-1.5">
              {versions.map((v) => {
                const isCurrent = v.id === doc.id;
                return (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-md border ${
                      isCurrent
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/40 bg-muted/10"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold uppercase tracking-wide">
                          v{v.version}
                        </span>
                        <span className="text-xs text-foreground truncate">
                          {v.original_name}
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                            selected
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(v.uploaded_at).toLocaleString()} ·{" "}
                        {formatBytes(v.file_size)}
                      </div>
                    </div>
                    {v.parent_document_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runDiff(v.id)}
                        disabled={diffing === v.id}
                      >
                        {diffing === v.id ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <GitCompareArrows className="h-3 w-3 mr-1" />
                        )}
                        See Changes
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {diff && <DiffResultCard diff={diff} />}
        </div>
      </div>
    </div>
  );
}

function DiffResultCard({ diff }: { diff: DiffResult }) {
  const severityColors: Record<
    "material" | "minor" | "informational",
    string
  > = {
    material: "bg-red-500/10 text-red-300 border-red-500/30",
    minor: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    informational: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  };
  return (
    <div className="border border-primary/40 rounded-lg p-4 bg-primary/5 space-y-3 animate-fade-up">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary" />
        Claude diff — v{diff.previous.version} → v{diff.current.version}
      </div>
      <div className="text-sm text-foreground font-medium">
        {diff.summary}
      </div>
      {diff.no_material_changes ? (
        <div className="text-xs text-muted-foreground">
          No material changes detected.
        </div>
      ) : (
        <div className="space-y-1.5">
          {diff.changes.map((c, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 p-2 rounded border text-xs ${
                severityColors[c.severity] || severityColors.informational
              }`}
            >
              <span className="text-[9px] uppercase tracking-wide font-semibold flex-shrink-0 mt-0.5">
                {c.severity}
              </span>
              <span className="flex-1 text-foreground/90">{c.change}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
