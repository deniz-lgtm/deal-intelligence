"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle,
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
  MessageSquare,
  FileSearch,
  ScrollText,
  Presentation,
  FolderArchive,
  Share2,
  ListChecks,
  CalendarPlus,
  CheckCircle2,
  ArrowRight,
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
type DocumentActionIntent = "ask" | "schedule" | "decision" | "checklist";
type DraftableDocumentActionIntent = "all" | Exclude<DocumentActionIntent, "ask">;

type DocumentDraftAction = {
  client_id?: string;
  type: DraftableDocumentActionIntent;
  title: string;
  body?: string | null;
  category?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  track?: "acquisition" | "development" | "construction" | null;
  confidence?: "high" | "medium" | "low";
  source_excerpt?: string | null;
  rationale?: string | null;
  source_document_ids?: string[] | null;
};

type DocumentActionDraft = {
  summary: string;
  gaps: string[];
  actions: DocumentDraftAction[];
  source_documents?: Array<{ id: string; original_name?: string | null; category?: string | null }>;
};

type DocumentActionApplyResult = {
  total: number;
  schedule: number;
  decision: number;
  checklist: number;
};

type ReviewResult = {
  document_type: string;
  executive_take: string;
  key_points: string[];
  red_flags: string[];
  missing_items: string[];
  questions_to_ask: string[];
  suggested_email: string;
  filing_suggestion: {
    category: string;
    deal_relevance: string;
  };
};

type PlaybookDocument = {
  id: string;
  title: string;
  category: string;
  chunk_count: number;
};

/** Parse an AI summary string into bullet points (split on ". " or newlines) */
function parseSummaryBullets(summary: string): string[] {
  // Split on newlines first, then periods
  const lines = summary
    .split(/\n|(?<=\.) /)
    .map((s) => s.trim().replace(/^[-•*]\s*/, ""))
    .filter((s) => s.length > 4);
  return lines.length > 1 ? lines : [summary];
}

function documentActionHref(
  dealId: string,
  doc: Pick<Document, "original_name" | "category">,
  intent: DocumentActionIntent
) {
  const categoryLabel =
    DOCUMENT_CATEGORIES[doc.category as DocumentCategory]?.label || doc.category;
  const base = `Use the document "${doc.original_name}" (${categoryLabel}) as the source.`;
  const prompts: Record<DocumentActionIntent, string> = {
    ask: `${base} Give me the key points, missing information, and recommended next action. Keep it concise and say if the document does not answer something.`,
    schedule: `${base} Identify any dates, obligations, or follow-up tasks that should become schedule items. Ask prep questions first if needed, then create only the rows you can support.`,
    decision: `${base} Identify any unresolved decision, RFI, or owner question this document creates. Keep it concise and tell me what should be logged.`,
    checklist: `${base} Identify any diligence checklist item this document creates or helps verify. Keep it concise and only suggest useful items.`,
  };
  return `/deals/${dealId}/chat?prompt=${encodeURIComponent(prompts[intent])}`;
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
  const [draftingAction, setDraftingAction] = useState<string | null>(null);
  const [actionReview, setActionReview] = useState<{
    source: {
      title: string;
      subtitle: string;
      endpoint: string;
    };
    intent: DraftableDocumentActionIntent;
    draft: DocumentActionDraft;
    selectedIds: string[];
  } | null>(null);
  const [applyingActions, setApplyingActions] = useState(false);
  const [actionCreated, setActionCreated] = useState<DocumentActionApplyResult | null>(null);
  const [reviewFrameworks, setReviewFrameworks] = useState<PlaybookDocument[]>([]);
  const [selectedReviewFrameworkId, setSelectedReviewFrameworkId] = useState("");
  const [reviewFocus, setReviewFocus] = useState(
    "Review this document as my personal real estate development associate. Be concise, flag what matters, and say plainly when the file does not answer something."
  );
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const [docReviewResult, setDocReviewResult] = useState<{
    doc: Document;
    review: ReviewResult;
    savedNoteId?: string | null;
  } | null>(null);

  useEffect(() => {
    loadDocuments();
  }, [params.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadFrameworks() {
      try {
        const res = await fetch("/api/playbook/documents");
        const json = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const rows = ((json.data || []) as PlaybookDocument[]).filter((doc) =>
          ["review_framework", "design_standard", "handbook"].includes(doc.category)
        );
        setReviewFrameworks(rows);
      } catch {
        // Frameworks are optional.
      }
    }
    loadFrameworks();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const draftDocumentActions = useCallback(
    async (doc: Document, intent: DraftableDocumentActionIntent) => {
      const key = `${doc.id}:${intent}`;
      setDraftingAction(key);
      try {
        const res = await fetch(`/api/deals/${params.id}/documents/${doc.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "draft", intent }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(json.error || "Could not draft actions from this document");
          return;
        }
        const draft = (json.data || { summary: "", gaps: [], actions: [] }) as DocumentActionDraft;
        const selectedIds = draft.actions
          .filter((action) => action.confidence !== "low")
          .map((action, index) => action.client_id || `${action.type}-${index}`);
        setActionCreated(null);
        setActionReview({
          source: {
            title: doc.original_name,
            subtitle: DOCUMENT_CATEGORIES[doc.category as DocumentCategory]?.label || doc.category,
            endpoint: `/api/deals/${params.id}/documents/${doc.id}/actions`,
          },
          intent,
          draft,
          selectedIds,
        });
        if (draft.actions.length === 0) {
          toast.message("No clear actions found in that document");
        }
      } catch {
        toast.error("Could not draft actions from this document");
      } finally {
        setDraftingAction(null);
      }
    },
    [params.id]
  );

  const draftBatchDocumentActions = useCallback(async () => {
    setDraftingAction("batch:all");
    try {
      const res = await fetch(`/api/deals/${params.id}/documents/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "draft", intent: "all" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "Could not draft actions from these documents");
        return;
      }
      const draft = (json.data || { summary: "", gaps: [], actions: [] }) as DocumentActionDraft;
      const sourceCount = draft.source_documents?.length ?? 0;
      const selectedIds = draft.actions
        .filter((action) => action.confidence !== "low")
        .map((action, index) => action.client_id || `${action.type}-${index}`);
      setActionCreated(null);
      setActionReview({
        source: {
          title: "Key document review",
          subtitle:
            sourceCount > 0
              ? `${sourceCount} source document${sourceCount === 1 ? "" : "s"} reviewed`
              : "Source documents reviewed",
          endpoint: `/api/deals/${params.id}/documents/actions`,
        },
        intent: "all",
        draft,
        selectedIds,
      });
      if (draft.actions.length === 0) {
        toast.message("No clear actions found in those documents");
      }
    } catch {
      toast.error("Could not draft actions from these documents");
    } finally {
      setDraftingAction(null);
    }
  }, [params.id]);

  const applyDraftActions = useCallback(async () => {
    if (!actionReview) return;
    const selected = actionReview.draft.actions.filter((action, index) =>
      actionReview.selectedIds.includes(action.client_id || `${action.type}-${index}`)
    );
    if (selected.length === 0) {
      toast.error("Select at least one action to create");
      return;
    }
    setApplyingActions(true);
    try {
      const res = await fetch(actionReview.source.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "apply", actions: selected }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "Could not create selected actions");
        return;
      }
      const count = json.data?.created?.length ?? selected.length;
      setActionCreated({
        total: count,
        schedule: selected.filter((action) => action.type === "schedule").length,
        decision: selected.filter((action) => action.type === "decision").length,
        checklist: selected.filter((action) => action.type === "checklist").length,
      });
      toast.success(`Created ${count} action${count === 1 ? "" : "s"}`);
    } catch {
      toast.error("Could not create selected actions");
    } finally {
      setApplyingActions(false);
    }
  }, [actionReview]);

  const reviewDocument = useCallback(
    async (doc: Document) => {
      setReviewingDocId(doc.id);
      try {
        const res = await fetch(`/api/documents/${doc.id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            focus: reviewFocus,
            review_playbook_id: selectedReviewFrameworkId || undefined,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(json.error || "Could not review this document");
          return;
        }
        const data = json.data || {};
        const review = (data.review || data) as ReviewResult;
        setDocReviewResult({ doc, review, savedNoteId: data.saved_note_id || null });
        toast.success("Review saved to this deal");
      } catch {
        toast.error("Could not review this document");
      } finally {
        setReviewingDocId(null);
      }
    },
    [reviewFocus, selectedReviewFrameworkId]
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

      {actionReview && (
        <DocumentActionReviewModal
          review={actionReview}
          dealId={params.id}
          applying={applyingActions}
          created={actionCreated}
          onClose={() => {
            setActionReview(null);
            setActionCreated(null);
          }}
          onToggle={(id) =>
            setActionReview((current) => {
              if (!current) return current;
              const selected = new Set(current.selectedIds);
              if (selected.has(id)) selected.delete(id);
              else selected.add(id);
              return { ...current, selectedIds: Array.from(selected) };
            })
          }
          onApply={applyDraftActions}
        />
      )}

      {docReviewResult && (
        <DocumentReviewModal
          result={docReviewResult}
          dealId={params.id}
          onClose={() => setDocReviewResult(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Documents & Intelligence</h2>
          <p className="text-sm text-muted-foreground">
            {documents.length} document{documents.length !== 1 ? "s" : ""} - upload, review, act, and share
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

      {/* Quick filter chips — "All Documents" + "AI Outputs". Keeps analyst-
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
              title="Proformas, IC packages, diligence summaries, and zoning reports generated by the app"
            >
              AI Outputs <span className={aiReportsOnly ? "text-amber-300/70" : "text-muted-foreground/70"}>({aiReportCount})</span>
            </button>
          )}
        </div>
      )}

      <DocumentsWorkflowHub
        dealId={params.id}
        documents={documents}
        frameworks={reviewFrameworks}
        selectedFrameworkId={selectedReviewFrameworkId}
        reviewFocus={reviewFocus}
        draftingAction={draftingAction}
        onSelectFramework={setSelectedReviewFrameworkId}
        onReviewFocusChange={setReviewFocus}
        onDraftBatchAction={draftBatchDocumentActions}
      />

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
          dealId={params.id}
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
          draftingAction={draftingAction}
          onDraftAction={draftDocumentActions}
          reviewingDocId={reviewingDocId}
          onReviewDocument={reviewDocument}
        />
      ) : (
        <GridView
          dealId={params.id}
          documents={visibleDocs}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          onDelete={deleteDocument}
          onView={(doc) => canPreview(doc) ? setViewingDoc(doc) : window.open(`/api/documents/${doc.id}/view`, "_blank")}
          onRecategorize={recategorize}
          recategorizing={recategorizing}
          deleting={deleting}
          draftingAction={draftingAction}
          onDraftAction={draftDocumentActions}
          reviewingDocId={reviewingDocId}
          onReviewDocument={reviewDocument}
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

function DocumentsWorkflowHub({
  dealId,
  documents,
  frameworks,
  selectedFrameworkId,
  reviewFocus,
  draftingAction,
  onSelectFramework,
  onReviewFocusChange,
  onDraftBatchAction,
}: {
  dealId: string;
  documents: Document[];
  frameworks: PlaybookDocument[];
  selectedFrameworkId: string;
  reviewFocus: string;
  draftingAction: string | null;
  onSelectFramework: (id: string) => void;
  onReviewFocusChange: (value: string) => void;
  onDraftBatchAction: () => void;
}) {
  const countByCategory = (category: DocumentCategory) =>
    documents.filter((doc) => doc.category === category).length;
  const sourceCount = documents.filter((doc) => !AI_REPORT_CATEGORIES.includes(doc.category)).length;
  const outputCount = documents.filter((doc) => AI_REPORT_CATEGORIES.includes(doc.category)).length;
  const omCount = countByCategory("om");
  const financialCount = countByCategory("financial");
  const marketCount = countByCategory("market");
  const keyCount = documents.filter((doc) => doc.is_key).length;
  const ddCount = countByCategory("dd_abstract");
  const packageCount =
    countByCategory("investment_package") + countByCategory("ic_package");
  const sourceReviewPrompt =
    "Review this deal's source files. Give me the key points, missing information, conflicting assumptions, and the next three useful actions. Keep it concise and say when the files do not answer something.";
  const sharePrepPrompt =
    "Review the deal documents and tell me what is ready to share externally, what should stay internal, and what missing files would make the share room more complete. Keep it concise.";

  const workflowSteps = [
    {
      label: "Upload",
      body: sourceCount > 0 ? `${sourceCount} source file${sourceCount === 1 ? "" : "s"} collected` : "Add OM, rent roll, reports, plans, or diligence files",
      complete: sourceCount > 0,
    },
    {
      label: "Extract",
      body: omCount > 0 || financialCount > 0 || marketCount > 0
        ? `${omCount} OM / ${financialCount} financial / ${marketCount} market`
        : "Classify files and pull high-level assumptions",
      complete: omCount > 0 || financialCount > 0 || marketCount > 0,
    },
    {
      label: "Review",
      body: ddCount > 0 ? `${ddCount} diligence summary saved` : "Generate or refresh the diligence summary",
      complete: ddCount > 0,
    },
    {
      label: "Act",
      body: keyCount > 0 ? `${keyCount} key file${keyCount === 1 ? "" : "s"} marked for decisions` : "Turn findings into schedule, decisions, or checklist",
      complete: keyCount > 0,
    },
    {
      label: "Package",
      body: packageCount > 0 ? `${packageCount} package output${packageCount === 1 ? "" : "s"} saved` : "Build IC package or share room",
      complete: packageCount > 0,
    },
  ];

  const actions = [
    {
      href: `/deals/${dealId}/om-analysis`,
      label: "Offering Memo",
      meta: omCount > 0 ? `${omCount} source${omCount === 1 ? "" : "s"}` : "No OM yet",
      icon: FileSearch,
    },
    {
      href: `/deals/${dealId}/dd-abstract`,
      label: "Diligence Summary",
      meta: ddCount > 0 ? `${ddCount} saved` : "Draft",
      icon: ScrollText,
    },
    {
      href: `/deals/${dealId}/investment-package`,
      label: "IC Package",
      meta: packageCount > 0 ? `${packageCount} saved` : "Build",
      icon: Presentation,
    },
    {
      href: `/deals/${dealId}/reports`,
      label: "Output Library",
      meta: outputCount > 0 ? `${outputCount} outputs` : "Library",
      icon: FolderArchive,
    },
    {
      href: `/deals/${dealId}/room`,
      label: "Share Room",
      meta: "Share",
      icon: Share2,
    },
    {
      href: `/deals/${dealId}/chat?prompt=${encodeURIComponent(sourceReviewPrompt)}`,
      label: "Assistant",
      meta: "Ask",
      icon: MessageSquare,
    },
  ];

  const workActions = [
    {
      onClick: onDraftBatchAction,
      label: "Create follow-up work",
      body:
        keyCount > 0
          ? "Review key files and draft schedule, decision/RFI, and checklist work."
          : "Review source files and draft schedule, decision/RFI, and checklist work.",
      icon: CalendarPlus,
      loading: draftingAction === "batch:all",
    },
    {
      href: `/deals/${dealId}/decisions`,
      label: "Open decisions / RFIs",
      body: "Track questions raised by diligence, design, legal, or construction docs.",
      icon: CheckCircle2,
    },
    {
      href: `/deals/${dealId}/checklist`,
      label: "Open diligence tasks",
      body: "Verify uploaded backup and attach schedule items where needed.",
      icon: ListChecks,
    },
    {
      href: `/deals/${dealId}/chat?prompt=${encodeURIComponent(sharePrepPrompt)}`,
      label: "Prep share room",
      body: "Check what is safe and useful to send outside the team.",
      icon: Share2,
    },
  ];

  return (
    <section className="border rounded-xl bg-card/70 overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr]">
        <div className="p-4 border-b md:border-b-0 md:border-r border-border/60">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Document workflow
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="text-2xl font-semibold tabular-nums">{sourceCount}</div>
              <div className="text-[11px] text-muted-foreground">Source docs</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums">{outputCount}</div>
              <div className="text-[11px] text-muted-foreground">Outputs</div>
            </div>
          </div>
          <Link
            href={`/deals/${dealId}/chat?prompt=${encodeURIComponent(sourceReviewPrompt)}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/30"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Ask about files
          </Link>
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-1 gap-px bg-border/50 lg:grid-cols-5">
            {workflowSteps.map((step, index) => (
              <div key={step.label} className="bg-card p-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                      step.complete
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-border bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {step.complete ? <CheckCircle2 className="h-3 w-3" /> : index + 1}
                  </span>
                  <span className="text-xs font-medium">{step.label}</span>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group flex items-center gap-3 p-4 border-b border-r border-border/50 hover:bg-muted/40 transition-colors min-h-[76px]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted/60 text-muted-foreground group-hover:text-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{action.label}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      {action.meta}
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="grid gap-3 border-t border-border/50 bg-card p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                <FileSearch className="h-3.5 w-3.5" />
                Review lens
              </div>
              <textarea
                value={reviewFocus}
                onChange={(event) => onReviewFocusChange(event.target.value)}
                rows={2}
                className="mt-2 w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs leading-5 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Saved framework
              </label>
              <select
                value={selectedFrameworkId}
                onChange={(event) => onSelectFramework(event.target.value)}
                className="mt-2 w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-xs outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
              >
                <option value="">No framework</option>
                {frameworks.map((framework) => (
                  <option key={framework.id} value={framework.id}>
                    {framework.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-px bg-border/50 md:grid-cols-2 xl:grid-cols-4">
            {workActions.map((action) => {
              const Icon = action.icon;
              const isButton = "onClick" in action;
              const isLoading = Boolean("loading" in action && action.loading);
              const content = (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <Icon className="h-4 w-4 text-primary" />
                      )}
                      <span className="text-sm font-medium">{action.label}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{action.body}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              );
              if (isButton) {
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    disabled={isLoading || sourceCount === 0}
                    className="group bg-card p-4 text-left transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {content}
                  </button>
                );
              }
              return (
                <Link
                  key={action.label}
                  href={action.href}
                  className="group bg-card p-4 transition-colors hover:bg-muted/30"
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
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
  dealId,
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
  draftingAction,
  onDraftAction,
  reviewingDocId,
  onReviewDocument,
}: {
  dealId: string;
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
  draftingAction?: string | null;
  onDraftAction: (doc: Document, intent: DraftableDocumentActionIntent) => void;
  reviewingDocId?: string | null;
  onReviewDocument: (doc: Document) => void;
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
                    dealId={dealId}
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
                    draftingAction={draftingAction}
                    onDraftAction={onDraftAction}
                    reviewingDocId={reviewingDocId}
                    onReviewDocument={onReviewDocument}
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
  dealId,
  documents,
  activeCategory,
  onCategoryChange,
  onDelete,
  onView,
  onRecategorize,
  recategorizing,
  deleting,
  draftingAction,
  onDraftAction,
  reviewingDocId,
  onReviewDocument,
}: {
  dealId: string;
  documents: Document[];
  activeCategory: DocumentCategory | "all";
  onCategoryChange: (c: DocumentCategory | "all") => void;
  onDelete: (id: string) => void;
  onView: (doc: Document) => void;
  onRecategorize: (docId: string, cat: DocumentCategory) => void;
  recategorizing: string | null;
  deleting: string | null;
  draftingAction?: string | null;
  onDraftAction: (doc: Document, intent: DraftableDocumentActionIntent) => void;
  reviewingDocId?: string | null;
  onReviewDocument: (doc: Document) => void;
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
            dealId={dealId}
            doc={doc}
            onDelete={onDelete}
            onView={onView}
            onRecategorize={onRecategorize}
            recategorizing={recategorizing}
            deleting={deleting}
            draftingAction={draftingAction}
            onDraftAction={onDraftAction}
            reviewingDocId={reviewingDocId}
            onReviewDocument={onReviewDocument}
          />
        ))}
      </div>
    </div>
  );
}

function DocRow({
  dealId,
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
  draftingAction,
  onDraftAction,
  reviewingDocId,
  onReviewDocument,
}: {
  dealId: string;
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
  draftingAction?: string | null;
  onDraftAction: (doc: Document, intent: DraftableDocumentActionIntent) => void;
  reviewingDocId?: string | null;
  onReviewDocument: (doc: Document) => void;
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
        <div className="mt-2 flex flex-wrap gap-1.5">
          <DocActionButton
            icon={<FileSearch className="h-3 w-3" />}
            label="Review"
            loading={reviewingDocId === doc.id}
            onClick={() => onReviewDocument(doc)}
          />
          <DocActionLink href={documentActionHref(dealId, doc, "ask")} icon={<MessageSquare className="h-3 w-3" />} label="Ask" />
          <DocActionButton
            icon={<CalendarPlus className="h-3 w-3" />}
            label="Schedule"
            loading={draftingAction === `${doc.id}:schedule`}
            onClick={() => onDraftAction(doc, "schedule")}
          />
          <DocActionButton
            icon={<CheckCircle2 className="h-3 w-3" />}
            label="Decision"
            loading={draftingAction === `${doc.id}:decision`}
            onClick={() => onDraftAction(doc, "decision")}
          />
          <DocActionButton
            icon={<ListChecks className="h-3 w-3" />}
            label="Task"
            loading={draftingAction === `${doc.id}:checklist`}
            onClick={() => onDraftAction(doc, "checklist")}
          />
        </div>
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
  dealId,
  doc,
  onDelete,
  onView,
  onRecategorize,
  recategorizing,
  deleting,
  draftingAction,
  onDraftAction,
  reviewingDocId,
  onReviewDocument,
}: {
  dealId: string;
  doc: Document;
  onDelete: (id: string) => void;
  onView: (doc: Document) => void;
  onRecategorize: (docId: string, cat: DocumentCategory) => void;
  recategorizing: string | null;
  deleting: string | null;
  draftingAction?: string | null;
  onDraftAction: (doc: Document, intent: DraftableDocumentActionIntent) => void;
  reviewingDocId?: string | null;
  onReviewDocument: (doc: Document) => void;
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
        <div className="mt-3 flex flex-wrap gap-1.5">
          <DocActionButton
            icon={<FileSearch className="h-3 w-3" />}
            label="Review"
            loading={reviewingDocId === doc.id}
            onClick={() => onReviewDocument(doc)}
          />
          <DocActionLink href={documentActionHref(dealId, doc, "ask")} icon={<MessageSquare className="h-3 w-3" />} label="Ask" />
          <DocActionButton
            icon={<CalendarPlus className="h-3 w-3" />}
            label="Schedule"
            loading={draftingAction === `${doc.id}:schedule`}
            onClick={() => onDraftAction(doc, "schedule")}
          />
          <DocActionButton
            icon={<CheckCircle2 className="h-3 w-3" />}
            label="Decision"
            loading={draftingAction === `${doc.id}:decision`}
            onClick={() => onDraftAction(doc, "decision")}
          />
          <DocActionButton
            icon={<ListChecks className="h-3 w-3" />}
            label="Task"
            loading={draftingAction === `${doc.id}:checklist`}
            onClick={() => onDraftAction(doc, "checklist")}
          />
        </div>
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

function DocActionLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
    >
      {icon}
      {label}
    </Link>
  );
}

function DocActionButton({
  icon,
  label,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/50 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-wait disabled:opacity-70"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function DocumentReviewModal({
  result,
  dealId,
  onClose,
}: {
  result: { doc: Document; review: ReviewResult; savedNoteId?: string | null };
  dealId: string;
  onClose: () => void;
}) {
  const { doc, review } = result;
  const [selectedPushItems, setSelectedPushItems] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = { note: true, document: true };
    review.questions_to_ask?.slice(0, 8).forEach((_, index) => {
      initial[`rfi:${index}`] = true;
    });
    review.red_flags?.slice(0, 8).forEach((_, index) => {
      initial[`risk:${index}`] = true;
    });
    review.missing_items?.slice(0, 8).forEach((_, index) => {
      initial[`task:${index}`] = true;
    });
    return initial;
  });
  const [pushingToNotion, setPushingToNotion] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);

  const togglePushItem = (id: string) => {
    setSelectedPushItems((current) => ({ ...current, [id]: !current[id] }));
  };

  const ensureNotionProject = async () => {
    const res = await fetch("/api/notion/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deal_id: dealId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not create Notion project");
    return json.data;
  };

  const pushReviewToNotion = async () => {
    setPushingToNotion(true);
    setNotionError(null);
    try {
      const approvedItems = {
        rfis: (review.questions_to_ask || [])
          .slice(0, 8)
          .filter((_, index) => selectedPushItems[`rfi:${index}`])
          .map((question) => ({
            question,
            priority: "P2 - Medium",
            phase: "Due Diligence",
          })),
        risks: (review.red_flags || [])
          .slice(0, 8)
          .filter((_, index) => selectedPushItems[`risk:${index}`])
          .map((flag) => ({
            title: flag,
            severity: "Medium",
            phase: "Due Diligence",
            mitigation: "Review with the deal team and assign owner in Notion.",
          })),
        tasks: (review.missing_items || [])
          .slice(0, 8)
          .filter((_, index) => selectedPushItems[`task:${index}`])
          .map((item) => ({
            title: item,
            priority: "P2 - Medium",
            phase: "Due Diligence",
            category: "Document Review",
            notes: `Follow-up from review of ${doc.original_name}.`,
          })),
        documents: selectedPushItems.document
          ? [
              {
                title: doc.original_name,
                type: notionDocumentType(doc.category),
                status: "In Review",
                link: typeof window !== "undefined" ? `${window.location.origin}/api/documents/${doc.id}/view` : undefined,
                phase: "Due Diligence",
                notes: review.executive_take,
              },
            ]
          : [],
        notes: selectedPushItems.note
          ? [
              {
                title: `Review: ${doc.original_name}`,
                type: "Other",
                summary: [
                  review.executive_take,
                  ...(review.key_points || []).map((point) => `Key point: ${point}`),
                ].join("\n"),
              },
            ]
          : [],
      };

      let res = await fetch(`/api/review-packets/${result.savedNoteId || doc.id}/push-to-notion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, approved_items: approvedItems }),
      });
      let json = await res.json().catch(() => ({}));

      if (res.status === 409 && json.code === "NOTION_PROJECT_REQUIRED") {
        await ensureNotionProject();
        res = await fetch(`/api/review-packets/${result.savedNoteId || doc.id}/push-to-notion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deal_id: dealId, approved_items: approvedItems }),
        });
        json = await res.json().catch(() => ({}));
      }

      if (!res.ok) {
        throw new Error(json.error || "Could not push review to Notion");
      }
      const created = (json.data?.created || {}) as Record<string, unknown>;
      const totalCreated = Object.values(created).reduce<number>(
        (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
        0
      );
      toast.success(`Pushed ${totalCreated} item${totalCreated === 1 ? "" : "s"} to Notion`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not push review to Notion";
      setNotionError(message);
      toast.error(message);
    } finally {
      setPushingToNotion(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4">
      <div className="mx-auto flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <FileSearch className="h-3.5 w-3.5 text-primary" />
              Document review
            </div>
            <h3 className="mt-1 truncate text-lg font-semibold">{doc.original_name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {review.document_type} - saved to this deal
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="rounded-lg border border-primary/20 bg-primary/10 p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-primary">Bottom line</p>
            <p className="mt-2 text-sm leading-6">{review.executive_take}</p>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ReviewList title="Key points" items={review.key_points} icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} />
            <ReviewList title="Red flags" items={review.red_flags} icon={<AlertTriangle className="h-4 w-4 text-amber-400" />} />
            <ReviewList title="Missing items" items={review.missing_items} icon={<FileText className="h-4 w-4 text-blue-400" />} />
            <ReviewList title="Questions to ask" items={review.questions_to_ask} icon={<MessageSquare className="h-4 w-4 text-primary" />} />
          </div>
          {review.suggested_email && (
            <div className="mt-4 rounded-lg border border-border/60 bg-background/50 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Suggested response</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{review.suggested_email}</p>
            </div>
          )}
          <div className="mt-4 rounded-lg border border-border/60 bg-background/50 p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Filing suggestion</p>
            <p className="mt-2 text-sm leading-6">
              {DOCUMENT_CATEGORIES[review.filing_suggestion?.category as DocumentCategory]?.label || review.filing_suggestion?.category || "Project document"}
              {review.filing_suggestion?.deal_relevance ? ` - ${review.filing_suggestion.deal_relevance}` : ""}
            </p>
          </div>
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-300">Push selected items to Notion</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  These records will attach to this deal&apos;s Notion Pipeline project. If no project exists yet, Deal Intelligence will create one first.
                </p>
              </div>
              <Button size="sm" className="gap-1.5" onClick={pushReviewToNotion} disabled={pushingToNotion}>
                {pushingToNotion ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                Push to Notion
              </Button>
            </div>
            {notionError && (
              <p className="mt-2 text-xs text-rose-300">{notionError}</p>
            )}
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <NotionPushToggle
                id="document"
                checked={!!selectedPushItems.document}
                label="Key document record"
                detail={doc.original_name}
                onToggle={togglePushItem}
              />
              <NotionPushToggle
                id="note"
                checked={!!selectedPushItems.note}
                label="Review note"
                detail={review.executive_take}
                onToggle={togglePushItem}
              />
              {(review.questions_to_ask || []).slice(0, 8).map((question, index) => (
                <NotionPushToggle
                  key={`rfi:${index}`}
                  id={`rfi:${index}`}
                  checked={!!selectedPushItems[`rfi:${index}`]}
                  label="RFI / question"
                  detail={question}
                  onToggle={togglePushItem}
                />
              ))}
              {(review.red_flags || []).slice(0, 8).map((flag, index) => (
                <NotionPushToggle
                  key={`risk:${index}`}
                  id={`risk:${index}`}
                  checked={!!selectedPushItems[`risk:${index}`]}
                  label="Issue / risk"
                  detail={flag}
                  onToggle={togglePushItem}
                />
              ))}
              {(review.missing_items || []).slice(0, 8).map((item, index) => (
                <NotionPushToggle
                  key={`task:${index}`}
                  id={`task:${index}`}
                  checked={!!selectedPushItems[`task:${index}`]}
                  label="Task"
                  detail={item}
                  onToggle={togglePushItem}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <p className="text-xs text-muted-foreground">
            Review note saved. Use questions as follow-ups if they are worth tracking.
          </p>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/notes?deal=${dealId}`}>Open notes</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/deals/${dealId}/tasks`}>Open follow-ups</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotionPushToggle({
  id,
  checked,
  label,
  detail,
  onToggle,
}: {
  id: string;
  checked: boolean;
  label: string;
  detail: string;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      className={`rounded-lg border p-3 text-left transition-colors ${
        checked
          ? "border-amber-500/35 bg-amber-500/10"
          : "border-border/60 bg-background/40 hover:bg-muted/30"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? "border-amber-400 bg-amber-400 text-black" : "border-border"
        }`}>
          {checked && <CheckCircle2 className="h-3 w-3" />}
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-foreground">{detail}</span>
        </span>
      </div>
    </button>
  );
}

function notionDocumentType(category: string) {
  const value = category.toLowerCase();
  if (value.includes("om")) return "OM / Marketing";
  if (value.includes("title")) return "Title Commitment";
  if (value.includes("survey")) return "Survey";
  if (value.includes("environment") || value.includes("phase")) return "Phase I/II";
  if (value.includes("zoning")) return "Zoning Letter";
  if (value.includes("plan") || value.includes("drawing") || value.includes("site")) return "Plans / Drawings";
  if (value.includes("permit")) return "Permit";
  if (value.includes("loi")) return "LOI";
  if (value.includes("psa")) return "PSA / PA";
  return "Other";
}

function ReviewList({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-medium">{title}</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing material flagged.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li key={index} className="text-sm leading-6 text-muted-foreground">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function actionId(action: DocumentDraftAction, index: number) {
  return action.client_id || `${action.type}-${index}`;
}

function actionLabel(type: DraftableDocumentActionIntent) {
  if (type === "all") return "Follow-Up";
  if (type === "schedule") return "Schedule";
  if (type === "decision") return "Decision";
  return "Task";
}

function DocumentActionReviewModal({
  review,
  dealId,
  applying,
  created,
  onClose,
  onToggle,
  onApply,
}: {
  review: {
    source: {
      title: string;
      subtitle: string;
      endpoint: string;
    };
    intent: DraftableDocumentActionIntent;
    draft: DocumentActionDraft;
    selectedIds: string[];
  };
  dealId: string;
  applying: boolean;
  created: DocumentActionApplyResult | null;
  onClose: () => void;
  onToggle: (id: string) => void;
  onApply: () => void;
}) {
  const selectedCount = review.selectedIds.length;
  const createdLinks = created
    ? [
        created.schedule > 0
          ? { href: `/deals/${dealId}/schedule`, label: "Open schedule", count: created.schedule }
          : null,
        created.decision > 0
          ? { href: `/deals/${dealId}/decisions`, label: "Open decisions", count: created.decision }
          : null,
        created.checklist > 0
          ? { href: `/deals/${dealId}/checklist`, label: "Open checklist", count: created.checklist }
          : null,
      ].filter(Boolean) as Array<{ href: string; label: string; count: number }>
    : [];
  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4">
      <div className="mx-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Draft {actionLabel(review.intent)} Actions
            </div>
            <h3 className="mt-1 truncate text-lg font-semibold">{review.source.title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{review.source.subtitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{review.draft.summary}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {created ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    Created {created.total} action{created.total === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The selected items are now linked back to their source documents as context.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {createdLinks.map((link) => (
                      <Button key={link.href} asChild variant="outline" size="sm">
                        <Link href={link.href} onClick={onClose}>
                          {link.label}
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            {link.count}
                          </Badge>
                        </Link>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : review.draft.gaps.length > 0 ? (
            <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-xs font-medium text-amber-200">Missing or unclear</p>
              <ul className="mt-2 space-y-1">
                {review.draft.gaps.map((gap, index) => (
                  <li key={index} className="text-xs text-muted-foreground">
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!created && review.draft.actions.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm font-medium">No supported actions found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The document may still be useful context, but the AI did not find enough evidence to create work.
              </p>
            </div>
          ) : !created ? (
            <div className="space-y-2">
              {review.draft.actions.map((action, index) => {
                const id = actionId(action, index);
                const checked = review.selectedIds.includes(id);
                return (
                  <label
                    key={id}
                    className={`block cursor-pointer rounded-lg border p-3 transition-colors ${
                      checked ? "border-primary/40 bg-primary/5" : "hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={checked}
                        onChange={() => onToggle(id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {actionLabel(action.type)}
                          </Badge>
                          {action.track && (
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {action.track}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {action.confidence || "medium"} confidence
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm font-medium">{action.title}</p>
                        {action.body && (
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.body}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          {action.category && <span>{action.category}</span>}
                          {action.due_date && <span>Due {action.due_date}</span>}
                          {action.start_date && <span>Start {action.start_date}</span>}
                          {action.end_date && <span>End {action.end_date}</span>}
                        </div>
                        {action.source_excerpt && (
                          <p className="mt-2 border-l-2 border-border pl-2 text-[11px] leading-4 text-muted-foreground">
                            {action.source_excerpt}
                          </p>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-5 py-4">
          <p className="text-xs text-muted-foreground">
            {created
              ? "Done. Use the links to jump into the created work."
              : `${selectedCount} selected. Review before creating; low-confidence items start unchecked.`}
          </p>
          <div className="flex items-center gap-2">
            {created ? (
              <Button onClick={onClose}>Close</Button>
            ) : (
              <>
                <Button variant="outline" onClick={onClose} disabled={applying}>
                  Cancel
                </Button>
                <Button onClick={onApply} disabled={applying || selectedCount === 0}>
                  {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create selected
                </Button>
              </>
            )}
          </div>
        </div>
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
