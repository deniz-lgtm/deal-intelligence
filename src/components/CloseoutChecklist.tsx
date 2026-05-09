"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  Plus,
  Trash2,
  Edit2,
  ExternalLink,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ChecklistItem, ChecklistStatus } from "@/lib/types";

interface ChecklistItemRow extends ChecklistItem {
  ai_filled: boolean;
  phase: string;
}

interface Attachment {
  id: string;
  checklist_item_id: string;
  document_id: string;
  uploaded_by: string | null;
  ai_verdict: "satisfied" | "partial" | "not_satisfied" | "unrelated" | null;
  ai_summary: string | null;
  ai_confidence: number | null;
  verified_at: string | null;
  created_at: string;
  original_name?: string;
  file_path?: string;
}

const STATUS_CONFIG: Record<
  ChecklistStatus,
  { icon: typeof CheckCircle2; label: string; className: string; badgeVariant: "success" | "secondary" | "outline" | "issue" | "warning" }
> = {
  complete: { icon: CheckCircle2, label: "Complete", className: "text-emerald-400", badgeVariant: "success" },
  pending: { icon: Circle, label: "Pending", className: "text-muted-foreground/40", badgeVariant: "secondary" },
  na: { icon: XCircle, label: "N/A", className: "text-muted-foreground/30", badgeVariant: "outline" },
  issue: { icon: AlertTriangle, label: "Issue", className: "text-red-400", badgeVariant: "issue" },
};

const VERDICT_TONE: Record<NonNullable<Attachment["ai_verdict"]>, string> = {
  satisfied: "bg-emerald-500/15 text-emerald-300",
  partial: "bg-amber-500/15 text-amber-300",
  not_satisfied: "bg-red-500/15 text-red-300",
  unrelated: "bg-zinc-500/15 text-zinc-300",
};

const STATUS_CYCLE: ChecklistStatus[] = ["pending", "complete", "issue", "na"];

interface Props {
  dealId: string;
}

export default function CloseoutChecklist({ dealId }: Props) {
  const [items, setItems] = useState<ChecklistItemRow[]>([]);
  const [attachmentsByItem, setAttachmentsByItem] = useState<Record<string, Attachment[]>>({});
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // New-item dialog
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newItemForm, setNewItemForm] = useState({ category: "", item: "" });

  // Inline edit
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ item: "", category: "" });

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/checklist?deal_id=${dealId}&phase=closeout`);
      const j = await res.json();
      const list: ChecklistItemRow[] = j.data || [];
      setItems(list);
      // Bulk load attachments per item — small N (~40 items), fine to fetch in parallel.
      const att: Record<string, Attachment[]> = {};
      await Promise.all(
        list.map(async (i) => {
          const r = await fetch(`/api/checklist/${i.id}/attachments`);
          const aj = await r.json();
          att[i.id] = aj.data || [];
        })
      );
      setAttachmentsByItem(att);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const updateStatus = async (id: string, status: ChecklistStatus, notes?: string) => {
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, status, notes: notes ?? i.notes } : i));
    await fetch("/api/checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, notes }),
    });
  };

  const cycleStatus = (item: ChecklistItemRow) => {
    const idx = STATUS_CYCLE.indexOf(item.status);
    updateStatus(item.id, STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]);
  };

  const handleUpload = async (itemId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading((p) => ({ ...p, [itemId]: true }));
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/checklist/${itemId}/attachments`, { method: "POST", body: fd });
        const j = await res.json();
        const attachmentId = j.data?.id;
        if (attachmentId) {
          // Auto-verify so the user sees the verdict without an extra click.
          fetch(`/api/checklist/${itemId}/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attachment_id: attachmentId }),
          }).catch(() => {/* swallow */});
        }
      }
      // Reload attachments + items (status may have auto-promoted to complete).
      await loadAll();
    } finally {
      setUploading((p) => ({ ...p, [itemId]: false }));
    }
  };

  const verifyAttachment = async (itemId: string, attachmentId: string) => {
    setVerifying((p) => ({ ...p, [attachmentId]: true }));
    try {
      await fetch(`/api/checklist/${itemId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachment_id: attachmentId }),
      });
      await loadAll();
    } finally {
      setVerifying((p) => ({ ...p, [attachmentId]: false }));
    }
  };

  const removeAttachment = async (itemId: string, attachmentId: string) => {
    if (!confirm("Remove this attachment?")) return;
    await fetch(`/api/checklist/${itemId}/attachments/${attachmentId}`, { method: "DELETE" });
    loadAll();
  };

  const addItem = async () => {
    if (!newItemForm.category.trim() || !newItemForm.item.trim()) return;
    await fetch(`/api/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deal_id: dealId,
        category: newItemForm.category.trim(),
        item: newItemForm.item.trim(),
        phase: "closeout",
      }),
    });
    setNewDialogOpen(false);
    setNewItemForm({ category: "", item: "" });
    loadAll();
  };

  const removeItem = async (id: string) => {
    if (!confirm("Delete this checklist item?")) return;
    await fetch(`/api/checklist?id=${id}`, { method: "DELETE" });
    loadAll();
  };

  const commitEdit = async (id: string) => {
    await fetch(`/api/checklist`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, item: editDraft.item.trim(), category: editDraft.category.trim() }),
    });
    setEditingItemId(null);
    loadAll();
  };

  // Group by category, preserve insertion order from server.
  const grouped = useMemo(() => {
    const m = new Map<string, ChecklistItemRow[]>();
    for (const i of items) {
      if (!m.has(i.category)) m.set(i.category, []);
      m.get(i.category)!.push(i);
    }
    return m;
  }, [items]);

  const totalItems = items.length;
  const completeItems = items.filter((i) => i.status === "complete").length;
  const issueItems = items.filter((i) => i.status === "issue").length;
  const pct = totalItems > 0 ? Math.round((completeItems / totalItems) * 100) : 0;

  const toggleCategory = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border/60 bg-card shadow-card">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium tabular-nums">{completeItems} / {totalItems} complete</span>
            <span className="text-sm font-bold text-primary tabular-nums">{pct}%</span>
          </div>
          <Progress value={pct} className="h-1.5" />
          {issueItems > 0 && (
            <p className="text-2xs text-red-400 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {issueItems} issue{issueItems !== 1 ? "s" : ""} flagged
            </p>
          )}
        </div>
        <Button onClick={() => { setNewItemForm({ category: "", item: "" }); setNewDialogOpen(true); }} variant="outline" size="sm">
          <Plus className="h-3 w-3 mr-1" /> Add Item
        </Button>
      </div>

      {/* Categories */}
      {Array.from(grouped.entries()).map(([category, catItems]) => {
        const isExpanded = expanded.has(category);
        const catComplete = catItems.filter((i) => i.status === "complete").length;
        const catTotal = catItems.length;
        const catPct = catTotal > 0 ? Math.round((catComplete / catTotal) * 100) : 0;
        const hasIssues = catItems.some((i) => i.status === "issue");

        return (
          <div key={category} className="border border-border/60 rounded-xl overflow-hidden shadow-card">
            <div className="flex items-center bg-card hover:bg-muted/20 transition-colors">
              <button
                onClick={() => toggleCategory(category)}
                className="flex-1 flex items-center gap-3 p-4 text-left"
              >
                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground/60 shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />}
                <span className="font-medium text-sm">{category}</span>
                {hasIssues && <AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
              </button>
              <div className="flex items-center gap-3 pr-4">
                <span className="text-2xs text-muted-foreground tabular-nums">{catComplete}/{catTotal}</span>
                <div className="w-16 bg-muted/30 rounded-full h-1">
                  <div
                    className={cn("h-1 rounded-full transition-all duration-300", catPct === 100 ? "bg-emerald-400" : hasIssues ? "bg-red-400" : "gradient-gold")}
                    style={{ width: `${catPct}%` }}
                  />
                </div>
                <button
                  onClick={() => { setNewItemForm({ category, item: "" }); setNewDialogOpen(true); }}
                  className="text-muted-foreground/40 hover:text-primary transition-colors"
                  title={`Add item to ${category}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-border/30 divide-y divide-border/20">
                {catItems.map((item) => {
                  const cfg = STATUS_CONFIG[item.status];
                  const Icon = cfg.icon;
                  const attachments = attachmentsByItem[item.id] || [];
                  const isEditing = editingItemId === item.id;
                  return (
                    <div key={item.id} className={cn("px-4 py-3 bg-card hover:bg-muted/10 transition-colors group", item.status === "issue" && "bg-red-500/[0.03]")}>
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => cycleStatus(item)}
                          className={cn("mt-0.5 shrink-0 transition-colors hover:opacity-70", cfg.className)}
                          title={`Status: ${cfg.label}. Click to cycle.`}
                        >
                          <Icon className="h-4.5 w-4.5" />
                        </button>
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <input
                                className="flex-1 bg-background border border-border rounded-md px-2 py-1 text-sm"
                                value={editDraft.item}
                                onChange={(e) => setEditDraft({ ...editDraft, item: e.target.value })}
                                autoFocus
                              />
                              <Button size="sm" className="h-7 text-2xs" onClick={() => commitEdit(item.id)}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-2xs" onClick={() => setEditingItemId(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-2">
                              <p className={cn("text-sm leading-relaxed", item.status === "na" && "line-through text-muted-foreground/50", item.status === "complete" && "text-muted-foreground")}>
                                {item.item}
                              </p>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Badge variant={cfg.badgeVariant} className="text-[10px] px-1.5 py-0">{cfg.label}</Badge>
                                <button
                                  onClick={() => { setEditingItemId(item.id); setEditDraft({ item: item.item, category: item.category }); }}
                                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                                  title="Edit"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => removeItem(item.id)}
                                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Attachments */}
                          {attachments.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              {attachments.map((a) => {
                                const verdict = a.ai_verdict;
                                const conf = a.ai_confidence !== null ? Math.round(Number(a.ai_confidence) * 100) : null;
                                return (
                                  <div key={a.id} className="rounded-md border border-border/30 bg-background/60 p-2 text-2xs">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <a
                                        href={`/api/documents/${a.document_id}/view`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-primary hover:underline truncate max-w-[260px]"
                                      >
                                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                        {a.original_name || a.document_id}
                                      </a>
                                      {verdict && (
                                        <Badge variant="secondary" className={cn("text-[10px]", VERDICT_TONE[verdict])}>
                                          {verdict}
                                          {conf !== null && <span className="ml-1 opacity-70">{conf}%</span>}
                                        </Badge>
                                      )}
                                      {!verdict && (
                                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                          {verifying[a.id] ? "Verifying…" : "Unverified"}
                                        </Badge>
                                      )}
                                      <button
                                        onClick={() => verifyAttachment(item.id, a.id)}
                                        disabled={!!verifying[a.id]}
                                        className="text-muted-foreground hover:text-primary"
                                        title={verdict ? "Re-verify" : "Verify with AI"}
                                      >
                                        {verifying[a.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                                      </button>
                                      <button
                                        onClick={() => removeAttachment(item.id, a.id)}
                                        className="ml-auto text-muted-foreground hover:text-red-400"
                                        title="Remove"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                    {a.ai_summary && (
                                      <p className="text-muted-foreground italic mt-1">{a.ai_summary}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Upload */}
                          <div className="mt-2">
                            <input
                              ref={(el) => { fileRefs.current[item.id] = el; }}
                              type="file"
                              multiple
                              className="sr-only"
                              onChange={(e) => handleUpload(item.id, e.target.files)}
                            />
                            <button
                              onClick={() => fileRefs.current[item.id]?.click()}
                              disabled={!!uploading[item.id]}
                              className="text-2xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                            >
                              {uploading[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                              {uploading[item.id] ? "Uploading…" : "Upload supporting doc"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Closeout Item</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Section</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={newItemForm.category}
                onChange={(e) => setNewItemForm({ ...newItemForm, category: e.target.value })}
                placeholder="e.g., Permits & CofO, Warranties, Punch List"
                list="closeout-categories"
              />
              <datalist id="closeout-categories">
                {Array.from(grouped.keys()).map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Item</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={newItemForm.item}
                onChange={(e) => setNewItemForm({ ...newItemForm, item: e.target.value })}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setNewDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={addItem}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
