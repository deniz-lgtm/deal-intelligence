"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ClipboardSignature, Save, X, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ImagePasteDrop from "@/components/ImagePasteDrop";
import { cn } from "@/lib/utils";

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

type Severity = "low" | "medium" | "high";

const SEV_TONE: Record<Severity, string> = {
  low: "bg-zinc-500/15 text-zinc-300",
  medium: "bg-amber-500/15 text-amber-300",
  high: "bg-red-500/20 text-red-300",
};

interface PendingImage {
  id: string;            // local-only id for keying / removal pre-save
  file: File;
  previewUrl: string;
  caption: string;
}

// Full-page "new constructability item" entry. Lets the user draft the
// finding text alongside reference images (drawing snippets, photos)
// pasted from the clipboard. Images are uploaded after the item itself
// is created so we have an item_id to attach them to.
export default function NewConstructabilityPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const dealId = params.id;

  const [form, setForm] = useState({
    title: "",
    description: "",
    category: CATEGORIES[0],
    severity: "medium" as Severity,
    assignee: "",
    due_date: "",
  });
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [saving, setSaving] = useState(false);

  // Revoke object URLs on unmount so the page doesn't leak blob URLs.
  useEffect(() => {
    return () => {
      for (const p of pending) URL.revokeObjectURL(p.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = async (files: File[]) => {
    setPending((prev) => [
      ...prev,
      ...files.map((f) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        caption: "",
      })),
    ]);
  };

  const removePending = (id: string) => {
    setPending((prev) => {
      const next = prev.filter((p) => p.id !== id);
      const removed = prev.find((p) => p.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const setCaption = (id: string, caption: string) => {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
  };

  const submit = async () => {
    if (!form.title.trim()) {
      alert("Title is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/constructability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          title: form.title.trim(),
          description: form.description || null,
          assignee: form.assignee || null,
          due_date: form.due_date || null,
        }),
      });
      const j = await res.json();
      const itemId = j.data?.id as string | undefined;
      if (!res.ok || !itemId) {
        alert(j.error || "Failed to create item.");
        return;
      }
      // Upload each image with its caption, one at a time so the captions
      // stay paired with their files. Could be parallelized but the UX is
      // a single "Saving" toast either way.
      for (const p of pending) {
        const fd = new FormData();
        fd.append("file", p.file);
        if (p.caption.trim()) fd.append("caption", p.caption.trim());
        await fetch(`/api/deals/${dealId}/constructability/${itemId}/attachments`, {
          method: "POST",
          body: fd,
        });
      }
      router.push(`/deals/${dealId}/pre-construction/constructability/${itemId}`);
    } finally {
      setSaving(false);
    }
  };

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
          <h1 className="font-display text-2xl">New Constructability Item</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/deals/${dealId}/pre-construction/constructability`}>
            <Button variant="ghost" size="sm" disabled={saving}>
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          </Link>
          <Button size="sm" onClick={submit} disabled={saving || !form.title.trim()}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving…</> : <><Save className="h-3.5 w-3.5 mr-1" /> Save</>}
          </Button>
        </div>
      </header>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Document a constructability finding raised during review or GMP buyout. Take a snip / screenshot of
        the detail you're calling out (drawing conflict, scope gap, long-lead item) and paste it directly —
        anywhere on the page. Multiple images are supported. The finding can be edited later.
      </p>

      {/* Two-column layout: form on left, image gallery on right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Left: form ─────────────────────────────────────────────── */}
        <section className="rounded-xl border border-border/40 bg-card/40 p-5 space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Finding</h2>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Title <span className="text-red-400">*</span></label>
            <input
              autoFocus
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g., A2.10 column line E conflicts with mechanical chase"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Description</label>
            <textarea
              rows={6}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Reference the drawing(s) / spec section. Describe the conflict and proposed resolution path."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Category</label>
              <select
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Severity</label>
              <div className="flex gap-1.5">
                {(["low", "medium", "high"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({ ...form, severity: s })}
                    className={cn(
                      "px-3 py-1.5 rounded-md border text-xs flex-1",
                      form.severity === s ? cn(SEV_TONE[s], "border-transparent") : "border-border/40 text-muted-foreground hover:bg-muted/30",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assignee</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.assignee}
                onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                placeholder="GC PM, architect, etc."
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Due Date</label>
              <input
                type="date"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>
          </div>
        </section>

        {/* ── Right: image attachments ───────────────────────────────── */}
        <section className="rounded-xl border border-border/40 bg-card/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Reference Images
            </h2>
            {pending.length > 0 && (
              <Badge variant="secondary" className="text-2xs">{pending.length} pending</Badge>
            )}
          </div>
          <ImagePasteDrop onFiles={addFiles} fill={false} />
          {pending.length > 0 && (
            <div className="space-y-3">
              {pending.map((p) => (
                <div key={p.id} className="rounded-lg border border-border/40 bg-background/60 overflow-hidden">
                  <div className="relative">
                    <img src={p.previewUrl} alt="snippet" className="w-full max-h-72 object-contain bg-black/20" />
                    <button
                      type="button"
                      onClick={() => removePending(p.id)}
                      className="absolute top-2 right-2 bg-background/80 backdrop-blur rounded-md p-1 text-muted-foreground hover:text-red-400 transition-colors"
                      title="Remove image"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    className="w-full bg-transparent border-t border-border/30 px-3 py-2 text-xs focus:outline-none focus:bg-muted/20"
                    value={p.caption}
                    onChange={(e) => setCaption(p.id, e.target.value)}
                    placeholder="Caption (optional) — e.g., 'A2.10, RCP detail 7'"
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
