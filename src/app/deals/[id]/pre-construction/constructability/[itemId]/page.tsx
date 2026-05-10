"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardSignature,
  Trash2,
  Save,
  Edit2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ImagePasteDrop from "@/components/ImagePasteDrop";
import { cn } from "@/lib/utils";

type Severity = "low" | "medium" | "high";
type Status = "open" | "in_review" | "resolved" | "closed";

interface CItem {
  id: string;
  number: number;
  title: string;
  description: string | null;
  category: string | null;
  severity: Severity;
  assignee: string | null;
  due_date: string | null;
  status: Status;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

interface Attachment {
  id: string;
  item_id: string;
  document_id: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
  original_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
}

const CATEGORIES = [
  "Drawing conflict",
  "Scope gap",
  "Long-lead procurement",
  "Constructability issue",
  "Code compliance",
  "Site logistics",
  "GMP buyout",
  "Other",
];

const SEV_TONE: Record<Severity, string> = {
  low: "bg-zinc-500/15 text-zinc-300",
  medium: "bg-amber-500/15 text-amber-300",
  high: "bg-red-500/20 text-red-300",
};
const STATUS_TONE: Record<Status, string> = {
  open: "bg-amber-500/15 text-amber-300",
  in_review: "bg-blue-500/15 text-blue-300",
  resolved: "bg-emerald-500/15 text-emerald-300",
  closed: "bg-zinc-500/15 text-zinc-400",
};

export default function ConstructabilityDetailPage({ params }: { params: { id: string; itemId: string } }) {
  const router = useRouter();
  const { id: dealId, itemId } = params;

  const [item, setItem] = useState<CItem | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    category: "",
    severity: "medium" as Severity,
    assignee: "",
    due_date: "",
    status: "open" as Status,
    resolution: "",
  });

  const load = useCallback(async () => {
    try {
      const [iRes, aRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/constructability`).then((r) => r.json()),
        fetch(`/api/deals/${dealId}/constructability/${itemId}/attachments`).then((r) => r.json()),
      ]);
      const found = (iRes.data || []).find((x: CItem) => x.id === itemId) as CItem | undefined;
      if (found) {
        setItem(found);
        setDraft({
          title: found.title,
          description: found.description || "",
          category: found.category || CATEGORIES[0],
          severity: found.severity,
          assignee: found.assignee || "",
          due_date: found.due_date || "",
          status: found.status,
          resolution: found.resolution || "",
        });
      }
      setAttachments(aRes.data || []);
    } finally {
      setLoading(false);
    }
  }, [dealId, itemId]);

  useEffect(() => { load(); }, [load]);

  const addFiles = async (files: File[]) => {
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      await fetch(`/api/deals/${dealId}/constructability/${itemId}/attachments`, {
        method: "POST",
        body: fd,
      });
    }
    await load();
  };

  const updateCaption = async (attId: string, caption: string) => {
    setAttachments((prev) => prev.map((a) => (a.id === attId ? { ...a, caption } : a)));
    await fetch(`/api/deals/${dealId}/constructability/${itemId}/attachments/${attId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption }),
    });
  };

  const removeAttachment = async (attId: string) => {
    if (!confirm("Remove this image?")) return;
    await fetch(`/api/deals/${dealId}/constructability/${itemId}/attachments/${attId}`, { method: "DELETE" });
    load();
  };

  const saveEdits = async () => {
    if (!draft.title.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/deals/${dealId}/constructability/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description || null,
          category: draft.category,
          severity: draft.severity,
          assignee: draft.assignee || null,
          due_date: draft.due_date || null,
          status: draft.status,
          resolution: draft.resolution || null,
        }),
      });
      setEditing(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: Status, resolution?: string) => {
    await fetch(`/api/deals/${dealId}/constructability/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(resolution !== undefined ? { resolution } : {}) }),
    });
    load();
  };

  const remove = async () => {
    if (!confirm("Delete this item permanently? Attached images will also be removed.")) return;
    await fetch(`/api/deals/${dealId}/constructability/${itemId}`, { method: "DELETE" });
    router.push(`/deals/${dealId}/pre-construction/constructability`);
  };

  if (loading) return <div className="text-xs text-muted-foreground py-8">Loading…</div>;
  if (!item) return <div className="text-xs text-red-400 py-8">Item not found.</div>;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/deals/${dealId}/pre-construction/constructability`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <ClipboardSignature className="h-5 w-5 text-primary" />
          <span className="text-2xs tabular-nums text-muted-foreground">CR-{String(item.number).padStart(3, "0")}</span>
          {!editing && <h1 className="font-display text-2xl truncate">{item.title}</h1>}
          {!editing && (
            <>
              <Badge variant="secondary" className={cn("text-2xs", SEV_TONE[item.severity])}>{item.severity}</Badge>
              <Badge variant="secondary" className={cn("text-2xs", STATUS_TONE[item.status])}>{item.status}</Badge>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <>
              {item.status !== "resolved" && item.status !== "closed" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const r = prompt("Resolution note (optional):") ?? "";
                    setStatus("resolved", r || undefined);
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Resolve
                </Button>
              )}
              {item.status === "resolved" && (
                <Button variant="outline" size="sm" onClick={() => setStatus("closed")}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Close
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={remove} className="text-muted-foreground hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); load(); }} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdits} disabled={saving}>
                {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save</>}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Left: details ─────────────────────────────────────────── */}
        <section className="rounded-xl border border-border/40 bg-card/40 p-5 space-y-4">
          {editing ? (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Title</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                <textarea
                  rows={6}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                    value={draft.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  >
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Severity</label>
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                    value={draft.severity}
                    onChange={(e) => setDraft({ ...draft, severity: e.target.value as Severity })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Assignee</label>
                  <input
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                    value={draft.assignee}
                    onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Due Date</label>
                  <input
                    type="date"
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                    value={draft.due_date}
                    onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                  <select
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
                  >
                    <option value="open">Open</option>
                    <option value="in_review">In Review</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Resolution</label>
                <textarea
                  rows={3}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
                  value={draft.resolution}
                  onChange={(e) => setDraft({ ...draft, resolution: e.target.value })}
                  placeholder="How was the finding closed out?"
                />
              </div>
            </>
          ) : (
            <>
              <FieldRow label="Description">
                {item.description ? <p className="whitespace-pre-wrap">{item.description}</p> : <span className="text-muted-foreground/60 italic">—</span>}
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Category" inline>{item.category || "—"}</FieldRow>
                <FieldRow label="Severity" inline>
                  <Badge variant="secondary" className={cn("text-2xs", SEV_TONE[item.severity])}>
                    {item.severity === "high" && <AlertTriangle className="h-2.5 w-2.5 mr-0.5 inline" />}
                    {item.severity}
                  </Badge>
                </FieldRow>
                <FieldRow label="Assignee" inline>{item.assignee || <span className="text-muted-foreground/60">—</span>}</FieldRow>
                <FieldRow label="Due Date" inline>
                  {item.due_date ? new Date(item.due_date + "T00:00:00").toLocaleDateString() : <span className="text-muted-foreground/60">—</span>}
                </FieldRow>
                <FieldRow label="Status" inline>
                  <Badge variant="secondary" className={cn("text-2xs", STATUS_TONE[item.status])}>{item.status}</Badge>
                </FieldRow>
                <FieldRow label="Created" inline>{new Date(item.created_at).toLocaleDateString()}</FieldRow>
              </div>
              {item.resolution && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="text-2xs uppercase tracking-wider text-emerald-400 mb-1">Resolution</div>
                  <p className="text-sm whitespace-pre-wrap">{item.resolution}</p>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Right: image gallery + paste-drop ─────────────────────── */}
        <section className="rounded-xl border border-border/40 bg-card/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Reference Images
            </h2>
            <Badge variant="secondary" className="text-2xs">{attachments.length}</Badge>
          </div>
          <ImagePasteDrop onFiles={addFiles} compact={attachments.length > 0} />
          <div className="space-y-3">
            {attachments.map((a) => (
              <AttachmentCard
                key={a.id}
                attachment={a}
                onCaptionChange={(c) => updateCaption(a.id, c)}
                onRemove={() => removeAttachment(a.id)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function FieldRow({ label, children, inline }: { label: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={cn("text-sm", inline && "")}>{children}</div>
    </div>
  );
}

function AttachmentCard({
  attachment,
  onCaptionChange,
  onRemove,
}: {
  attachment: Attachment;
  onCaptionChange: (c: string) => void;
  onRemove: () => void;
}) {
  const isImage = (attachment.mime_type || "").startsWith("image/");
  const isPdf = (attachment.mime_type || "") === "application/pdf";
  const viewUrl = `/api/documents/${attachment.document_id}/view`;
  const [caption, setCaption] = useState(attachment.caption || "");
  // Debounce-ish: commit on blur, not every keystroke.
  const commit = () => {
    if (caption !== (attachment.caption || "")) onCaptionChange(caption);
  };
  return (
    <div className="rounded-lg border border-border/40 bg-background/60 overflow-hidden group">
      <div className="relative">
        {isImage ? (
          <a href={viewUrl} target="_blank" rel="noopener noreferrer" title="Open full size">
            <img src={viewUrl} alt={attachment.caption || attachment.original_name || "snippet"} className="w-full max-h-96 object-contain bg-black/20" />
          </a>
        ) : isPdf ? (
          <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-6 text-sm hover:bg-muted/20">
            <ExternalLink className="h-4 w-4 text-primary" />
            {attachment.original_name || "PDF"}
          </a>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">{attachment.original_name}</div>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-2 right-2 bg-background/80 backdrop-blur rounded-md p-1 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        className="w-full bg-transparent border-t border-border/30 px-3 py-2 text-xs focus:outline-none focus:bg-muted/20"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="Caption (optional)"
      />
    </div>
  );
}
