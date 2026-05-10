"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Trash2,
  ClipboardSignature,
  AlertTriangle,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  attachment_count?: number;
}

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

  const setStatus = async (id: string, status: Status) => {
    await fetch(`/api/deals/${dealId}/constructability/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
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
            long-lead procurement risks, code issues, and site logistics. Each finding has its own page with
            reference images you can paste right from the clipboard.
          </p>
        </div>
        <Link href={`/deals/${dealId}/pre-construction/constructability/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" /> New Item
          </Button>
        </Link>
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
              <Link href={`/deals/${dealId}/pre-construction/constructability/new`}>
                <Button size="sm" variant="outline">
                  <Plus className="h-3 w-3 mr-1" /> Add the first one
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map((it) => (
              <Link
                key={it.id}
                href={`/deals/${dealId}/pre-construction/constructability/${it.id}`}
                className="block px-4 py-3 group hover:bg-muted/10 transition-colors"
              >
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
                        {it.attachment_count != null && it.attachment_count > 0 && (
                          <Badge variant="outline" className="text-2xs inline-flex items-center gap-1">
                            <ImageIcon className="h-2.5 w-2.5" /> {it.attachment_count}
                          </Badge>
                        )}
                        <Badge variant="secondary" className={cn("text-2xs ml-auto", STATUS_TONE[it.status])}>
                          {it.status}
                        </Badge>
                      </div>
                      {it.description && (
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-2">{it.description}</p>
                      )}
                      {(it.assignee || it.due_date) && (
                        <div className="text-2xs text-muted-foreground mt-1 flex items-center gap-3">
                          {it.assignee && <span>Assignee: {it.assignee}</span>}
                          {it.due_date && <span>Due: {new Date(it.due_date + "T00:00:00").toLocaleDateString()}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                    {it.status !== "resolved" && it.status !== "closed" && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
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
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setStatus(it.id, "closed");
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        title="Close"
                      >
                        ⊘
                      </button>
                    )}
                    <button
                      onClick={(e) => remove(e, it.id)}
                      className="text-muted-foreground hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
