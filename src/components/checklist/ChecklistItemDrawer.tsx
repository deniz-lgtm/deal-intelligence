"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Circle,
  FileText,
  GanttChart,
  Loader2,
  Paperclip,
  Plus,
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

              {/* Notes */}
              <section>
                <SectionLabel>Notes</SectionLabel>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => {
                    if (notesDraft !== (detail.notes ?? "")) patch({ notes: notesDraft });
                  }}
                  rows={4}
                  placeholder="Context, evidence, links…"
                  className="mt-1 w-full resize-y rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/50 focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/15"
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

              {/* Linked schedule tasks — interactive add comes in PR B */}
              <section>
                <SectionLabel>
                  <GanttChart className="h-3 w-3" />
                  Mini-schedule
                </SectionLabel>
                {detail.linked_schedule_tasks.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    No scheduled tasks for this item yet. Linking to the deal schedule comes next.
                  </p>
                ) : (
                  <ul className="mt-1 divide-y divide-border/30 rounded-md border border-border/40 bg-background/40">
                    {detail.linked_schedule_tasks.map((t) => (
                      <li key={t.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-foreground/90">{t.label}</span>
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
