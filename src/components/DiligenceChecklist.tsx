"use client";

import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  Circle,
  XCircle,
  AlertTriangle,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronRight,
  Upload,
  FileText,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/types";
import type { ChecklistItem, ChecklistStatus } from "@/lib/types";

interface ChecklistItemRow extends ChecklistItem {
  ai_filled: boolean;
}

interface DiligenceChecklistProps {
  dealId: string;
}

const STATUS_CONFIG: Record<
  ChecklistStatus,
  {
    icon: typeof CheckCircle2;
    label: string;
    className: string;
    badgeVariant: "success" | "secondary" | "outline" | "issue" | "warning";
  }
> = {
  complete: { icon: CheckCircle2, label: "Complete", className: "text-emerald-400", badgeVariant: "success" },
  pending: { icon: Circle, label: "Pending", className: "text-muted-foreground/40", badgeVariant: "secondary" },
  na: { icon: XCircle, label: "N/A", className: "text-muted-foreground/30", badgeVariant: "outline" },
  issue: { icon: AlertTriangle, label: "Issue", className: "text-red-400", badgeVariant: "issue" },
};

const CATEGORY_DOC_MAP: Record<string, DocumentCategory[]> = {
  "Title & Ownership": ["title_ownership"],
  "Environmental": ["environmental"],
  "Zoning & Entitlements": ["zoning_entitlements"],
  "Financial": ["financial"],
  "Leases": ["leases"],
  "Physical Inspections": ["surveys_engineering", "inspections"],
  "Legal & Contracts": ["legal"],
  "Utilities & Infrastructure": ["other"],
  "Permits & Compliance": ["zoning_entitlements", "legal"],
  "Market & Valuation": ["financial"],
  "Insurance": ["insurance"],
};

export default function DiligenceChecklist({ dealId }: DiligenceChecklistProps) {
  const [items, setItems] = useState<ChecklistItemRow[]>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; original_name: string; category: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [autofilling, setAutofilling] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState("");
  const [autofillResult, setAutofillResult] = useState<{ filled: number; message?: string } | null>(null);
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    loadAll();
  }, [dealId]);

  const loadAll = async () => {
    try {
      const [checklistRes, docsRes] = await Promise.all([
        fetch(`/api/checklist?deal_id=${dealId}`),
        fetch(`/api/deals/${dealId}/documents`),
      ]);
      const [checklistJson, docsJson] = await Promise.all([checklistRes.json(), docsRes.json()]);
      if (checklistJson.data) setItems(checklistJson.data);
      if (docsJson.data) setDocuments(docsJson.data);
    } catch (err) {
      console.error("Failed to load checklist:", err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: ChecklistStatus, notes?: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status, notes: notes ?? item.notes } : item))
    );
    await fetch("/api/checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, notes }),
    });
  };

  const autoFill = async () => {
    setAutofilling(true);
    setAutofillResult(null);
    try {
      const res = await fetch("/api/checklist/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });
      const json = await res.json();
      if (json.data) {
        setItems(json.data.items);
        setAutofillResult({ filled: json.data.filled_count, message: json.data.message });
        const filledCats = new Set<string>(
          json.data.items
            .filter((i: ChecklistItemRow) => i.ai_filled)
            .map((i: ChecklistItemRow) => i.category)
        );
        setExpandedCategories(filledCats);
      }
    } catch (err) {
      console.error("Auto-fill failed:", err);
    } finally {
      setAutofilling(false);
    }
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleCategoryUpload = async (category: string, files: FileList) => {
    if (!files || files.length === 0) return;
    setUploadingFiles((prev) => ({ ...prev, [category]: true }));
    try {
      const formData = new FormData();
      formData.append("deal_id", dealId);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetch("/api/documents/upload", { method: "POST", body: formData });
      if (res.ok) {
        const docsRes = await fetch(`/api/deals/${dealId}/documents`);
        const docsJson = await docsRes.json();
        if (docsJson.data) setDocuments(docsJson.data);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploadingFiles((prev) => ({ ...prev, [category]: false }));
      setUploadingCategory(null);
    }
  };

  const categories = items.reduce<Record<string, ChecklistItemRow[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const totalItems = items.length;
  const completeItems = items.filter((i) => i.status === "complete").length;
  const issueItems = items.filter((i) => i.status === "issue").length;
  const progressPct = totalItems > 0 ? Math.round((completeItems / totalItems) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border/60 bg-card shadow-card">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium tabular-nums">{completeItems} / {totalItems} complete</span>
            <span className="text-sm font-bold text-primary tabular-nums">{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
          {issueItems > 0 && (
            <p className="text-2xs text-red-400 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {issueItems} issue{issueItems !== 1 ? "s" : ""} flagged
            </p>
          )}
        </div>
        <Button onClick={autoFill} disabled={autofilling} variant="outline" size="sm" className="shrink-0 gap-1.5">
          {autofilling ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" />Analyzing...</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5 text-primary" />AI Auto-fill</>
          )}
        </Button>
      </div>

      {autofillResult && (
        <div className="text-xs text-muted-foreground bg-primary/[0.05] border border-primary/15 rounded-lg px-3 py-2.5 flex items-center gap-2">
          <Sparkles className="h-3 w-3 text-primary shrink-0" />
          {autofillResult.message
            ? autofillResult.message
            : `AI filled ${autofillResult.filled} checklist item${autofillResult.filled !== 1 ? "s" : ""} based on your documents.`}
        </div>
      )}

      {/* Category sections */}
      {Object.entries(categories).map(([category, catItems]) => {
        const isExpanded = expandedCategories.has(category);
        const catComplete = catItems.filter((i) => i.status === "complete").length;
        const catTotal = catItems.length;
        const catPct = catTotal > 0 ? Math.round((catComplete / catTotal) * 100) : 0;
        const hasIssues = catItems.some((i) => i.status === "issue");
        const isUploading = uploadingFiles[category];

        const relevantDocCats = CATEGORY_DOC_MAP[category] || [];
        const relevantDocs = documents.filter((d) => relevantDocCats.includes(d.category as DocumentCategory));

        return (
          <div key={category} className="border border-border/60 rounded-xl overflow-hidden shadow-card">
            {/* Category header */}
            <div className="flex items-center bg-card hover:bg-muted/20 transition-colors">
              <button
                onClick={() => toggleCategory(category)}
                className="flex-1 flex items-center gap-3 p-4 text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                )}
                <span className="font-medium text-sm">{category}</span>
                {hasIssues && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
              </button>
              <div className="flex items-center gap-3 pr-4">
                <span className="text-2xs text-muted-foreground tabular-nums">{catComplete}/{catTotal}</span>
                <div className="w-16 bg-muted/30 rounded-full h-1">
                  <div
                    className={cn(
                      "h-1 rounded-full transition-all duration-300",
                      catPct === 100 ? "bg-emerald-400" : hasIssues ? "bg-red-400" : "gradient-gold"
                    )}
                    style={{ width: `${catPct}%` }}
                  />
                </div>
                <button
                  onClick={() => setUploadingCategory(uploadingCategory === category ? null : category)}
                  className="text-muted-foreground/40 hover:text-primary transition-colors"
                  title={`Upload to ${category}`}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Per-category upload area */}
            {uploadingCategory === category && (
              <div className="border-t border-border/30 bg-muted/10 p-3 flex items-center gap-3">
                <label className="flex-1 cursor-pointer">
                  <input
                    type="file"
                    multiple
                    className="sr-only"
                    ref={(el) => { fileInputRefs.current[category] = el; }}
                    onChange={(e) => {
                      if (e.target.files) handleCategoryUpload(category, e.target.files);
                    }}
                  />
                  <div className="flex items-center gap-2 border-2 border-dashed border-border/40 rounded-lg px-4 py-2.5 hover:border-primary/40 transition-colors">
                    <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Click to upload documents for <strong>{category}</strong></span>
                  </div>
                </label>
                <button onClick={() => setUploadingCategory(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {isExpanded && (
              <div className="border-t border-border/30">
                {/* Relevant docs panel */}
                {relevantDocs.length > 0 && (
                  <div className="px-4 py-2.5 bg-primary/[0.03] border-b border-border/20 flex items-start gap-2">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-2xs font-medium text-primary mb-1">Relevant documents</p>
                      <div className="flex flex-wrap gap-1.5">
                        {relevantDocs.map((d) => (
                          <a
                            key={d.id}
                            href={`/api/documents/${d.id}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-2xs bg-muted/30 border border-border/30 rounded-md px-2 py-0.5 hover:bg-muted/50 transition-colors truncate max-w-[200px]"
                            title={d.original_name}
                          >
                            {d.original_name}
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="divide-y divide-border/20">
                  {catItems.map((item) => (
                    <ChecklistRow
                      key={item.id}
                      item={item}
                      onStatusChange={(status) => updateStatus(item.id, status, item.notes || undefined)}
                      onNotesEdit={() => { setEditingNotes(item.id); setNotesValue(item.notes || ""); }}
                      editingNotes={editingNotes === item.id}
                      notesValue={notesValue}
                      onNotesChange={setNotesValue}
                      onNotesSave={() => { updateStatus(item.id, item.status, notesValue); setEditingNotes(null); }}
                      onNotesCancel={() => setEditingNotes(null)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ChecklistRowProps {
  item: ChecklistItemRow;
  onStatusChange: (status: ChecklistStatus) => void;
  onNotesEdit: () => void;
  editingNotes: boolean;
  notesValue: string;
  onNotesChange: (v: string) => void;
  onNotesSave: () => void;
  onNotesCancel: () => void;
}

const STATUS_CYCLE: ChecklistStatus[] = ["pending", "complete", "issue", "na"];

function ChecklistRow({
  item,
  onStatusChange,
  onNotesEdit,
  editingNotes,
  notesValue,
  onNotesChange,
  onNotesSave,
  onNotesCancel,
}: ChecklistRowProps) {
  const config = STATUS_CONFIG[item.status];
  const Icon = config.icon;

  const cycleStatus = () => {
    const idx = STATUS_CYCLE.indexOf(item.status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    onStatusChange(next);
  };

  return (
    <div className={cn(
      "px-4 py-3 bg-card hover:bg-muted/10 transition-colors",
      item.status === "issue" && "bg-red-500/[0.03]"
    )}>
      <div className="flex items-start gap-3">
        <button
          onClick={cycleStatus}
          className={cn("mt-0.5 shrink-0 transition-colors hover:opacity-70", config.className)}
          title={`Status: ${config.label}. Click to cycle.`}
        >
          <Icon className="h-4.5 w-4.5" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={cn(
              "text-sm leading-relaxed",
              item.status === "na" && "line-through text-muted-foreground/50",
              item.status === "complete" && "text-muted-foreground"
            )}>
              {item.item}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              {item.ai_filled && (
                <span title="AI filled">
                  <Sparkles className="h-3 w-3 text-primary/50" />
                </span>
              )}
              <Badge variant={config.badgeVariant} className="text-[10px] px-1.5 py-0">
                {config.label}
              </Badge>
            </div>
          </div>

          {item.notes && !editingNotes && (
            <button onClick={onNotesEdit} className="text-2xs text-muted-foreground mt-1 text-left hover:text-foreground transition-colors italic">
              {item.notes}
            </button>
          )}

          {editingNotes ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={notesValue}
                onChange={(e) => onNotesChange(e.target.value)}
                className="input-field resize-none h-16 text-xs"
                placeholder="Add notes..."
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-6 text-2xs px-2" onClick={onNotesSave}>Save</Button>
                <Button size="sm" variant="ghost" className="h-6 text-2xs px-2" onClick={onNotesCancel}>Cancel</Button>
              </div>
            </div>
          ) : (
            !item.notes && (
              <button onClick={onNotesEdit} className="text-2xs text-muted-foreground/30 mt-1 hover:text-muted-foreground transition-colors">
                + Add note
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
