"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  FileText,
  GanttChart,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Trash2,
  User as UserIcon,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, titleCase } from "@/lib/utils";
import { toast } from "sonner";
import type {
  ChecklistAttachment,
  ChecklistItemComment,
  ChecklistItemDetail,
  ChecklistStatus,
  Document,
} from "@/lib/types";

interface ChecklistItemDrawerProps {
  itemId: string | null;
  dealId: string;
  open: boolean;
  onClose: () => void;
  /** Called after any mutation so the parent list can refresh. */
  onMutated?: (next?: { id: string; status?: ChecklistStatus; notes?: string | null }) => void;
}

const STATUSES: { value: ChecklistStatus; label: string; tone: string; icon: typeof CheckCircle2 }[] = [
  { value: "pending", label: "Pending", tone: "text-muted-foreground", icon: Circle },
  { value: "complete", label: "Complete", tone: "text-emerald-500", icon: CheckCircle2 },
  { value: "issue", label: "Issue", tone: "text-rose-500", icon: AlertTriangle },
  { value: "na", label: "N/A", tone: "text-muted-foreground/60", icon: XCircle },
];

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added manually",
  assistant: "Created by assistant",
  autofill: "Filled by AI",
  template: "From template",
};

/**
 * Per-item detail drawer — opens from the diligence checklist when a
 * row is clicked. Shows notes, assignee, due date, document
 * attachments, and (in PR B) linked mini-schedule tasks.
 */
export function ChecklistItemDrawer({
  itemId,
  dealId,
  open,
  onClose,
  onMutated,
}: ChecklistItemDrawerProps) {
  const [detail, setDetail] = useState<ChecklistItemDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local drafts for inputs — committed on blur or click-out.
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [dueDraft, setDueDraft] = useState("");

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/checklist/${itemId}`);
      const json = await res.json();
      if (json?.data) {
        setDetail(json.data);
        setTitleDraft(json.data.title ?? json.data.item ?? "");
        setNotesDraft(json.data.notes ?? "");
        setDueDraft(json.data.due_date ? String(json.data.due_date).slice(0, 10) : "");
      }
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (open && itemId) load();
    if (!open) setDetail(null);
  }, [open, itemId, load]);

  const patch = async (updates: Record<string, unknown>) => {
    if (!itemId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/checklist/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        toast.error("Update failed");
        return;
      }
      const json = await res.json();
      if (json?.data) {
        setDetail((prev) => (prev ? { ...prev, ...json.data } : prev));
        onMutated?.({
          id: itemId,
          status: json.data.status,
          notes: json.data.notes,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const detachDocument = async (attachmentId: string) => {
    if (!itemId) return;
    const res = await fetch(`/api/checklist/${itemId}/attachments/${attachmentId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to remove attachment");
      return;
    }
    setDetail((prev) =>
      prev ? { ...prev, attachments: prev.attachments.filter((a) => a.id !== attachmentId) } : prev
    );
  };

  const onAttachmentAdded = (attachment: ChecklistAttachment) => {
    setDetail((prev) =>
      prev ? { ...prev, attachments: [attachment, ...prev.attachments] } : prev
    );
  };

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close item"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
      />
      <aside
        role="dialog"
        aria-label="Checklist item detail"
        className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-xl flex-col border-l border-border/60 bg-card shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/40 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {detail?.category ?? "Checklist"}
            </div>
            <textarea
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const v = titleDraft.trim();
                if (!detail) return;
                const original = detail.title ?? detail.item ?? "";
                if (v && v !== original) patch({ title: v });
              }}
              rows={1}
              className="mt-1 w-full resize-none bg-transparent text-base font-semibold text-foreground outline-none focus:bg-background/60"
            />
            {detail?.source_context && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                {SOURCE_LABEL[detail.source_context] ?? titleCase(detail.source_context)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loading && !detail && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}

          {detail && (
            <>
              {/* Status pills */}
              <section>
                <SectionLabel>Status</SectionLabel>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => {
                    const active = detail.status === s.value;
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => patch({ status: s.value })}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                          active
                            ? "border-primary/45 bg-primary/10 text-foreground"
                            : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                        )}
                      >
                        <Icon className={cn("h-3 w-3", s.tone)} />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Assignee + due date */}
              <section className="grid gap-3 sm:grid-cols-2">
                <div>
                  <SectionLabel>
                    <UserIcon className="h-3 w-3" />
                    Assignee
                  </SectionLabel>
                  <input
                    type="text"
                    placeholder="Email or name"
                    defaultValue={detail.assignee_user_id ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null;
                      if (v !== (detail.assignee_user_id ?? null)) patch({ assignee_user_id: v });
                    }}
                    className="mt-1 w-full rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
                  />
                </div>
                <div>
                  <SectionLabel>
                    <CalendarClock className="h-3 w-3" />
                    Due
                  </SectionLabel>
                  <input
                    type="date"
                    value={dueDraft}
                    onChange={(e) => setDueDraft(e.target.value)}
                    onBlur={() => {
                      const original = detail.due_date ? String(detail.due_date).slice(0, 10) : "";
                      if (dueDraft !== original) patch({ due_date: dueDraft || null });
                    }}
                    className="mt-1 w-full rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-sm focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
                  />
                </div>
              </section>

              {/* Description — the persistent context block. Stored in
                  checklist_items.notes for back-compat. */}
              <section>
                <SectionLabel>Description</SectionLabel>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => {
                    if (notesDraft !== (detail.notes ?? "")) patch({ notes: notesDraft });
                  }}
                  rows={6}
                  placeholder="What this task covers — scope, context, key questions…"
                  className="mt-1 min-h-[6rem] w-full resize-y rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-sm leading-6 placeholder:text-muted-foreground/50 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
              </section>

              {/* Threaded comments — append-only running log. */}
              <section>
                <SectionLabel>
                  <MessageSquare className="h-3 w-3" />
                  Comments
                </SectionLabel>
                <CommentsThread
                  itemId={detail.id}
                  comments={detail.comments ?? []}
                  onAdded={(c) =>
                    setDetail((prev) =>
                      prev ? { ...prev, comments: [...(prev.comments ?? []), c] } : prev
                    )
                  }
                  onDeleted={(commentId) =>
                    setDetail((prev) =>
                      prev
                        ? { ...prev, comments: (prev.comments ?? []).filter((c) => c.id !== commentId) }
                        : prev
                    )
                  }
                />
              </section>

              {/* Attachments */}
              <section>
                <div className="flex items-center justify-between">
                  <SectionLabel>
                    <Paperclip className="h-3 w-3" />
                    Documents
                  </SectionLabel>
                  <AttachmentAddButton
                    itemId={detail.id}
                    dealId={dealId}
                    onAdded={onAttachmentAdded}
                  />
                </div>
                {detail.attachments.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground/70">No documents attached yet.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-border/30 rounded-md border border-border/40 bg-background/40">
                    {detail.attachments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <a
                          href={`/api/documents/${a.document_id}/view`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-w-0 items-center gap-2 text-sm hover:text-primary"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{a.document_name ?? a.document_id}</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => detachDocument(a.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-rose-500"
                          aria-label="Remove attachment"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Linked schedule tasks — mini-schedule for this item */}
              <section>
                <div className="flex items-center justify-between">
                  <SectionLabel>
                    <GanttChart className="h-3 w-3" />
                    Mini-schedule
                  </SectionLabel>
                  <AddScheduledTaskButton
                    dealId={dealId}
                    checklistItemId={detail.id}
                    defaultDue={detail.due_date}
                    onCreated={(task) => {
                      setDetail((prev) =>
                        prev
                          ? {
                              ...prev,
                              linked_schedule_tasks: [task, ...prev.linked_schedule_tasks],
                            }
                          : prev
                      );
                    }}
                  />
                </div>
                {detail.linked_schedule_tasks.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    No scheduled tasks yet. Add one to put this on the deal&apos;s master schedule.
                  </p>
                ) : (
                  <ul className="mt-1 divide-y divide-border/30 rounded-md border border-border/40 bg-background/40">
                    {detail.linked_schedule_tasks.map((t) => (
                      <li key={t.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`/deals/${dealId}/schedule`}
                            className="truncate text-foreground/90 hover:text-primary"
                          >
                            {t.is_milestone ? "◆ " : ""}
                            {t.label}
                          </Link>
                          {t.track && (
                            <span className="rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                              {t.track}
                            </span>
                          )}
                        </div>
                        {(t.start_date || t.end_date) && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {t.start_date ?? "—"} → {t.end_date ?? "—"}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="shrink-0 border-t border-border/40 px-4 py-2 text-[10px] text-muted-foreground">
          {detail && (
            <div className="flex items-center justify-between">
              <span>Updated {new Date(detail.updated_at).toLocaleString()}</span>
              <Link
                href={`/deals/${dealId}/documents`}
                className="hover:text-foreground"
              >
                Open deal documents →
              </Link>
            </div>
          )}
        </footer>
      </aside>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Two paths: upload a new file (multipart POST), or link an existing
 * deal document (JSON POST with document_id).
 */
function AttachmentAddButton({
  itemId,
  dealId,
  onAdded,
}: {
  itemId: string;
  dealId: string;
  onAdded: (attachment: ChecklistAttachment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open || docs.length > 0) return;
    fetch(`/api/deals/${dealId}/documents`)
      .then((r) => r.json())
      .then((j) => Array.isArray(j?.data) && setDocs(j.data))
      .catch(() => undefined);
  }, [open, dealId, docs.length]);

  const link = async (documentId: string) => {
    const res = await fetch(`/api/checklist/${itemId}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: documentId }),
    });
    if (!res.ok) {
      toast.error("Failed to attach document");
      return;
    }
    const json = await res.json();
    if (json?.data) onAdded(json.data);
    setOpen(false);
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/checklist/${itemId}/attachments`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        toast.error("Upload failed");
        return;
      }
      const json = await res.json();
      if (json?.data) onAdded(json.data);
      setOpen(false);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="h-3 w-3" />
        Add
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-10 w-72 rounded-lg border border-border/60 bg-card p-2 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Attach a document
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/50 bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Upload
              <input
                type="file"
                hidden
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                }}
              />
            </label>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {docs.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground/70">
                No deal documents yet.
              </p>
            ) : (
              <ul>
                {docs.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => link(d.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/40"
                    >
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span className="truncate">{d.original_name ?? d.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86_400 * 14) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Append-only thread under each checklist item. Each comment renders
 * as its own bordered bullet with author + relative time. Cmd/Ctrl+Enter
 * (or click Send) posts the entry.
 */
function CommentsThread({
  itemId,
  comments,
  onAdded,
  onDeleted,
}: {
  itemId: string;
  comments: ChecklistItemComment[];
  onAdded: (comment: ChecklistItemComment) => void;
  onDeleted: (commentId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/checklist/${itemId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        toast.error("Failed to post comment");
        return;
      }
      const json = await res.json();
      if (json?.data) onAdded(json.data);
      setDraft("");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (commentId: string) => {
    const res = await fetch(`/api/checklist/${itemId}/comments/${commentId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Failed to delete comment");
      return;
    }
    onDeleted(commentId);
  };

  return (
    <div className="mt-1 space-y-2">
      {comments.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">
          No comments yet. Drop a note for yourself or the team below.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {comments.map((c) => (
            <li
              key={c.id}
              className="group flex gap-2 rounded-md border border-border/40 bg-background/40 px-3 py-2 text-sm"
            >
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-foreground/90">{c.body}</p>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/70">
                  <span>{c.author_user_id ? c.author_user_id : "anon"}</span>
                  <span>·</span>
                  <span title={new Date(c.created_at).toLocaleString()}>
                    {relativeTime(c.created_at)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(c.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-rose-500"
                aria-label="Delete comment"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Add a comment — ⌘↵ to post"
          className="min-h-[2.5rem] flex-1 resize-y rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
        />
        <Button
          size="sm"
          disabled={posting || !draft.trim()}
          onClick={submit}
          className="h-9 shrink-0 px-3"
        >
          {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Inline mini-form to create a new deal_dev_phases row linked back to
 * this checklist item. Posts to /api/deals/[id]/dev-schedule with the
 * new linked_checklist_item_id column.
 */
function AddScheduledTaskButton({
  dealId,
  checklistItemId,
  defaultDue,
  onCreated,
}: {
  dealId: string;
  checklistItemId: string;
  defaultDue: string | null;
  onCreated: (task: {
    id: string;
    label: string;
    track: string | null;
    start_date: string | null;
    end_date: string | null;
    status: string | null;
    pct_complete: number | null;
    is_milestone: boolean | null;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [track, setTrack] = useState<"acquisition" | "development" | "construction">("development");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState(defaultDue ? String(defaultDue).slice(0, 10) : "");
  const [isMilestone, setIsMilestone] = useState(false);
  const [saving, setSaving] = useState(false);
  const prevOpenRef = useRef(false);

  // Only seed endDate from defaultDue when the popover transitions
  // from closed → open. If we re-seed on every defaultDue change,
  // any background patch on the parent drawer (status, assignee, etc.)
  // that refreshes `detail` would wipe the date the user just typed.
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setEndDate(defaultDue ? String(defaultDue).slice(0, 10) : "");
    }
    prevOpenRef.current = open;
  }, [open, defaultDue]);

  const submit = async () => {
    if (!label.trim()) {
      toast.error("Label required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/dev-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          track,
          start_date: startDate || null,
          end_date: endDate || null,
          is_milestone: isMilestone,
          linked_checklist_item_id: checklistItemId,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to add scheduled task");
        return;
      }
      const json = await res.json();
      if (json?.data) {
        onCreated({
          id: json.data.id,
          label: json.data.label,
          track: json.data.track,
          start_date: json.data.start_date,
          end_date: json.data.end_date,
          status: json.data.status,
          pct_complete: json.data.pct_complete,
          is_milestone: json.data.is_milestone,
        });
        toast.success("Added to schedule");
        setLabel("");
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus className="h-3 w-3" />
        Add scheduled task
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-10 w-80 space-y-2 rounded-lg border border-border/60 bg-card p-3 shadow-xl">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Task label — e.g. Order title commitment"
            maxLength={200}
            autoFocus
            className="w-full rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
              title="Start"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
              title="End / due"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <select
              value={track}
              onChange={(e) =>
                setTrack(e.target.value as "acquisition" | "development" | "construction")
              }
              className="rounded-md border border-border/50 bg-background/60 px-2 py-1 text-xs focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              <option value="acquisition">Acquisition</option>
              <option value="development">Development</option>
              <option value="construction">Construction</option>
            </select>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={isMilestone}
                onChange={(e) => setIsMilestone(e.target.checked)}
              />
              Milestone
            </label>
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} className="h-7 text-xs">
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={submit} className="h-7 text-xs">
              {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
