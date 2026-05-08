"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  ClipboardSignature,
  AlertTriangle,
  Edit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export default function ConstructabilityPage({ params }: { params: { id: string } }) {
  const dealId = params.id;
  const [items, setItems] = useState<CItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: CATEGORIES[0],
    severity: "medium" as Severity,
    assignee: "",
    due_date: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/constructability`);
      const j = await res.json();
      setItems(j.data || []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.title.trim()) return;
    await fetch(`/api/deals/${dealId}/constructability`, {
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
    setDialogOpen(false);
    setForm({ title: "", description: "", category: CATEGORIES[0], severity: "medium", assignee: "", due_date: "" });
    load();
  };

  const setStatus = async (id: string, status: Status) => {
    await fetch(`/api/deals/${dealId}/constructability/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    await fetch(`/api/deals/${dealId}/constructability/${id}`, { method: "DELETE" });
    load();
  };

  const filtered = filter === "all" ? items : items.filter((i) => i.status === "open" || i.status === "in_review");

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ClipboardSignature className="h-5 w-5 text-primary" />
            Constructability & GMP Review
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Findings raised during constructability review and GMP buyout — drawing conflicts, scope gaps,
            long-lead procurement risks, code issues, and site logistics. Resolve before mobilization.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Item
        </Button>
      </header>

      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setFilter("open")}
          className={cn("px-2.5 py-1 rounded-md border", filter === "open" ? "bg-primary/15 border-primary/40 text-primary" : "border-border/40 text-muted-foreground hover:bg-muted/30")}
        >
          Open
        </button>
        <button
          onClick={() => setFilter("all")}
          className={cn("px-2.5 py-1 rounded-md border", filter === "all" ? "bg-primary/15 border-primary/40 text-primary" : "border-border/40 text-muted-foreground hover:bg-muted/30")}
        >
          All
        </button>
        <span className="ml-auto text-muted-foreground tabular-nums">{filtered.length} of {items.length}</span>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              {items.length === 0 ? "No constructability items yet." : "No open items."}
            </p>
            {items.length === 0 && (
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add the first one
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map((it) => (
              <div key={it.id} className="px-4 py-3 group hover:bg-muted/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className="text-2xs tabular-nums text-muted-foreground mt-0.5">CR-{String(it.number).padStart(3, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{it.title}</span>
                        <Badge variant="secondary" className={cn("text-2xs", SEV_TONE[it.severity])}>
                          {it.severity === "high" && <AlertTriangle className="h-2.5 w-2.5 mr-0.5 inline" />}
                          {it.severity}
                        </Badge>
                        {it.category && (
                          <Badge variant="outline" className="text-2xs">{it.category}</Badge>
                        )}
                        <Badge variant="secondary" className={cn("text-2xs ml-auto", STATUS_TONE[it.status])}>
                          {it.status}
                        </Badge>
                      </div>
                      {it.description && (
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{it.description}</p>
                      )}
                      {(it.assignee || it.due_date) && (
                        <div className="text-2xs text-muted-foreground mt-1 flex items-center gap-3">
                          {it.assignee && <span>Assignee: {it.assignee}</span>}
                          {it.due_date && <span>Due: {new Date(it.due_date + "T00:00:00").toLocaleDateString()}</span>}
                        </div>
                      )}
                      {it.resolution && (
                        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 mt-1.5 text-2xs">
                          <span className="text-emerald-400 font-medium">Resolution: </span>
                          {it.resolution}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                    {it.status !== "resolved" && it.status !== "closed" && (
                      <button
                        onClick={() => {
                          const r = prompt("Resolution note (optional):") ?? "";
                          fetch(`/api/deals/${dealId}/constructability/${it.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ status: "resolved", ...(r ? { resolution: r } : {}) }),
                          }).then(load);
                        }}
                        className="text-emerald-400 hover:text-emerald-300"
                        title="Resolve"
                      >
                        ✓
                      </button>
                    )}
                    {it.status === "resolved" && (
                      <button onClick={() => setStatus(it.id, "closed")} className="text-muted-foreground hover:text-foreground" title="Close">
                        ⊘
                      </button>
                    )}
                    <button onClick={() => remove(it.id)} className="text-muted-foreground hover:text-red-400" title="Delete">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Constructability Item</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title</label>
              <input
                autoFocus
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <textarea
                rows={3}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-none"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
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
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={form.severity}
                  onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Due</label>
                <input
                  type="date"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assignee</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={form.assignee}
                onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                placeholder="GC PM, architect, etc."
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={submit}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
