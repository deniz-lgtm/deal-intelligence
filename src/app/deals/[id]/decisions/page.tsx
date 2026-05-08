"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, MessageSquare, CheckCircle2, XCircle, Trash2, Filter, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const CATEGORIES = ["diligence", "design", "construction", "finance", "legal", "other"] as const;
const STATUSES = ["open", "in_review", "resolved", "closed"] as const;
type Category = (typeof CATEGORIES)[number];
type Status = (typeof STATUSES)[number];

const STATUS_CONFIG: Record<Status, { label: string; tone: string }> = {
  open: { label: "Open", tone: "bg-amber-500/20 text-amber-300" },
  in_review: { label: "In Review", tone: "bg-blue-500/20 text-blue-300" },
  resolved: { label: "Resolved", tone: "bg-emerald-500/20 text-emerald-300" },
  closed: { label: "Closed", tone: "bg-zinc-500/20 text-zinc-400" },
};

const CATEGORY_TONE: Record<Category, string> = {
  diligence: "bg-primary/15 text-primary",
  design: "bg-purple-500/15 text-purple-300",
  construction: "bg-orange-500/15 text-orange-300",
  finance: "bg-emerald-500/15 text-emerald-300",
  legal: "bg-red-500/15 text-red-300",
  other: "bg-zinc-500/15 text-zinc-300",
};

interface Decision {
  id: string;
  number: number;
  title: string;
  body: string | null;
  category: Category | null;
  status: Status;
  asked_by: string | null;
  assigned_to: string | null;
  due_date: string | null;
  resolution: string | null;
  comment_count: number;
  created_at: string;
  resolved_at: string | null;
}

interface Comment {
  id: string;
  decision_id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
}

export default function DecisionsPage({ params }: { params: { id: string } }) {
  const dealId = params.id;
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterCategory, setFilterCategory] = useState<Category | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  // New-decision dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    body: "",
    category: "diligence" as Category,
    assigned_to: "",
    due_date: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/decisions`);
      const j = await res.json();
      setDecisions(j.data || []);
    } catch (err) {
      console.error("Failed to load decisions", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadComments = async (decisionId: string) => {
    try {
      const res = await fetch(`/api/deals/${dealId}/decisions/${decisionId}/comments`);
      const j = await res.json();
      setComments((prev) => ({ ...prev, [decisionId]: j.data || [] }));
    } catch (err) {
      console.error("Failed to load comments", err);
    }
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!comments[id]) await loadComments(id);
  };

  const submitNew = async () => {
    if (!form.title.trim()) return;
    await fetch(`/api/deals/${dealId}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(),
        body: form.body.trim() || null,
        category: form.category,
        assigned_to: form.assigned_to.trim() || null,
        due_date: form.due_date || null,
      }),
    });
    setDialogOpen(false);
    setForm({ title: "", body: "", category: "diligence", assigned_to: "", due_date: "" });
    load();
  };

  const setStatus = async (decisionId: string, status: Status, resolution?: string) => {
    await fetch(`/api/deals/${dealId}/decisions/${decisionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(resolution !== undefined ? { resolution } : {}) }),
    });
    load();
  };

  const remove = async (decisionId: string) => {
    if (!confirm("Delete this decision/RFI?")) return;
    await fetch(`/api/deals/${dealId}/decisions/${decisionId}`, { method: "DELETE" });
    if (expandedId === decisionId) setExpandedId(null);
    load();
  };

  const submitComment = async (decisionId: string) => {
    const body = (commentDraft[decisionId] || "").trim();
    if (!body) return;
    await fetch(`/api/deals/${dealId}/decisions/${decisionId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setCommentDraft((prev) => ({ ...prev, [decisionId]: "" }));
    loadComments(decisionId);
    load();
  };

  const filtered = decisions.filter((d) => {
    if (filterStatus !== "all" && d.status !== filterStatus) return false;
    if (filterCategory !== "all" && d.category !== filterCategory) return false;
    return true;
  });

  const openCount = decisions.filter((d) => d.status === "open" || d.status === "in_review").length;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h1 className="font-display text-2xl">Decisions & RFIs</h1>
          <Badge variant="secondary" className="text-2xs">{openCount} open</Badge>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New
        </Button>
      </header>

      <p className="text-xs text-muted-foreground -mt-2">
        Internal log of open questions, decisions to make, and RFIs across diligence, design, and construction.
        Different from the external Deal Room Q&amp;A — this stays inside the team.
      </p>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as Status | "all")}
          className="bg-background border border-border rounded-md px-2 py-1 text-xs"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as Category | "all")}
          className="bg-background border border-border rounded-md px-2 py-1 text-xs"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="text-muted-foreground tabular-nums ml-auto">{filtered.length} of {decisions.length}</span>
      </div>

      {/* List */}
      <div className="border border-border/40 rounded-lg overflow-hidden bg-card/40">
        {loading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground mb-2">
              {decisions.length === 0
                ? "No decisions or RFIs logged yet."
                : "No items match the current filter."}
            </p>
            {decisions.length === 0 && (
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add the first one
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map((d) => {
              const isExpanded = expandedId === d.id;
              const sCfg = STATUS_CONFIG[d.status];
              return (
                <div key={d.id} className="group">
                  <button
                    onClick={() => toggleExpand(d.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 text-left"
                  >
                    <span className="text-2xs tabular-nums text-muted-foreground w-10 flex-shrink-0">#{d.number}</span>
                    <span className="flex-1 min-w-0 text-sm truncate">{d.title}</span>
                    {d.category && (
                      <Badge variant="secondary" className={cn("text-2xs", CATEGORY_TONE[d.category])}>
                        {d.category}
                      </Badge>
                    )}
                    <Badge variant="secondary" className={cn("text-2xs", sCfg.tone)}>
                      {sCfg.label}
                    </Badge>
                    {d.due_date && (
                      <span className="text-2xs text-muted-foreground tabular-nums hidden md:inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(d.due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                    <span className="text-2xs text-muted-foreground hidden md:inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {d.comment_count}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 space-y-3 bg-muted/10 border-t border-border/20">
                      {d.body && (
                        <p className="text-xs whitespace-pre-wrap text-foreground/90">{d.body}</p>
                      )}
                      {d.resolution && (
                        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
                          <div className="text-2xs uppercase tracking-wider text-emerald-400 mb-1">Resolution</div>
                          <p className="whitespace-pre-wrap">{d.resolution}</p>
                        </div>
                      )}

                      {/* Action row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {d.status !== "in_review" && d.status !== "resolved" && (
                          <Button size="sm" variant="outline" className="h-7 text-2xs"
                            onClick={() => setStatus(d.id, "in_review")}>
                            Mark In Review
                          </Button>
                        )}
                        {d.status !== "resolved" && (
                          <Button size="sm" variant="outline" className="h-7 text-2xs"
                            onClick={() => {
                              const r = prompt("Resolution note (optional):") ?? "";
                              setStatus(d.id, "resolved", r || undefined);
                            }}>
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Resolve
                          </Button>
                        )}
                        {d.status === "resolved" && (
                          <Button size="sm" variant="outline" className="h-7 text-2xs"
                            onClick={() => setStatus(d.id, "open")}>
                            Re-open
                          </Button>
                        )}
                        {d.status !== "closed" && (
                          <Button size="sm" variant="ghost" className="h-7 text-2xs"
                            onClick={() => setStatus(d.id, "closed")}>
                            <XCircle className="h-3 w-3 mr-1" /> Close
                          </Button>
                        )}
                        <button
                          onClick={() => remove(d.id)}
                          className="ml-auto text-muted-foreground hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Comments */}
                      <div className="space-y-2 pt-2 border-t border-border/20">
                        <div className="text-2xs uppercase tracking-wider text-muted-foreground">Discussion</div>
                        {(comments[d.id] || []).length === 0 ? (
                          <p className="text-2xs text-muted-foreground italic">No comments yet.</p>
                        ) : (
                          (comments[d.id] || []).map((c) => (
                            <div key={c.id} className="rounded border border-border/30 bg-background/50 px-3 py-2">
                              <div className="text-2xs text-muted-foreground mb-1">
                                {c.author_user_id ?? "—"} &middot; {new Date(c.created_at).toLocaleString()}
                              </div>
                              <p className="text-xs whitespace-pre-wrap">{c.body}</p>
                            </div>
                          ))
                        )}
                        <div className="flex items-start gap-2 pt-1">
                          <textarea
                            rows={2}
                            value={commentDraft[d.id] || ""}
                            onChange={(e) => setCommentDraft((p) => ({ ...p, [d.id]: e.target.value }))}
                            placeholder="Add a comment…"
                            className="flex-1 bg-background border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                          />
                          <Button size="sm" onClick={() => submitComment(d.id)}>
                            Post
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New-decision dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Decision / RFI</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title</label>
              <input
                autoFocus
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g., Confirm parking ratio with city planner"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Detail</label>
              <textarea
                rows={3}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Assignee</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.assigned_to}
                  onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                  placeholder="user id or name"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Due</label>
                <input
                  type="date"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={submitNew}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
