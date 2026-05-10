"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Trash2,
  FileQuestion,
  Upload,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "open" | "in_review" | "answered" | "closed";

interface RFI {
  id: string;
  rfi_number: string | null;
  subject: string;
  submitted_by: string | null;
  submitted_date: string | null;
  response_required_by: string | null;
  responded_date: string | null;
  status: Status;
  discipline: string | null;
  cost_impact: number | null;
  schedule_impact_days: number | null;
  response_summary: string | null;
  source_document_id: string | null;
  notes: string | null;
  created_at: string;
}

const STATUS_TONE: Record<Status, string> = {
  open: "bg-amber-500/15 text-amber-300",
  in_review: "bg-blue-500/15 text-blue-300",
  answered: "bg-emerald-500/15 text-emerald-300",
  closed: "bg-zinc-500/15 text-zinc-400",
};

const fc = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function ConstructionRfisPage({ params }: { params: { id: string } }) {
  const dealId = params.id;
  const [items, setItems] = useState<RFI[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/construction-rfis`);
      const j = await res.json();
      setItems(j.data || []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: Status, response?: string) => {
    await fetch(`/api/deals/${dealId}/construction-rfis/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        ...(status === "answered" && !response ? { responded_date: new Date().toISOString().slice(0, 10) } : {}),
        ...(response ? { response_summary: response, responded_date: new Date().toISOString().slice(0, 10) } : {}),
      }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this RFI?")) return;
    await fetch(`/api/deals/${dealId}/construction-rfis/${id}`, { method: "DELETE" });
    load();
  };

  const filtered = filter === "all" ? items : items.filter((i) => i.status === "open" || i.status === "in_review");

  // Highlight overdue: response_required_by in the past and status not closed.
  const isOverdue = (r: RFI) => {
    if (!r.response_required_by) return false;
    if (r.status === "answered" || r.status === "closed") return false;
    return new Date(r.response_required_by + "T00:00:00") < new Date();
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileQuestion className="h-5 w-5 text-primary" />
            Construction RFIs
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Storage and tracking for contractor-submitted RFIs. Upload the PDF; AI extracts RFI #, subject,
            submission date, response deadline, and discipline. Track response status to closeout.
          </p>
        </div>
        <Link href={`/deals/${dealId}/construction/rfis/new`}>
          <Button size="sm">
            <Upload className="h-4 w-4 mr-1" /> Upload RFI
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
              {items.length === 0 ? "No RFIs uploaded yet." : "No open RFIs."}
            </p>
            {items.length === 0 && (
              <Link href={`/deals/${dealId}/construction/rfis/new`}>
                <Button size="sm" variant="outline">
                  <Upload className="h-3 w-3 mr-1" /> Upload first RFI
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-2xs uppercase tracking-wider bg-muted/20 border-b border-border/30">
                <tr>
                  <th className="px-3 py-2 text-left">RFI #</th>
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2 text-left">From</th>
                  <th className="px-3 py-2 text-left">Discipline</th>
                  <th className="px-3 py-2 text-left">Submitted</th>
                  <th className="px-3 py-2 text-left">Due</th>
                  <th className="px-3 py-2 text-right">Cost Δ</th>
                  <th className="px-3 py-2 text-right">Sched Δ</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const overdue = isOverdue(r);
                  return (
                    <tr key={r.id} className="group border-t border-border/20 hover:bg-muted/10">
                      <td className="px-3 py-2 tabular-nums font-medium">{r.rfi_number || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.subject}</div>
                        {r.response_summary && (
                          <div className="text-2xs text-muted-foreground mt-0.5 max-w-md truncate italic">→ {r.response_summary}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.submitted_by || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.discipline || "—"}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {r.submitted_date ? new Date(r.submitted_date + "T00:00:00").toLocaleDateString() : "—"}
                      </td>
                      <td className={cn("px-3 py-2 tabular-nums", overdue ? "text-red-400 font-medium" : "text-muted-foreground")}>
                        {r.response_required_by ? (
                          <span className="inline-flex items-center gap-1">
                            {overdue && <AlertTriangle className="h-3 w-3" />}
                            {new Date(r.response_required_by + "T00:00:00").toLocaleDateString()}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.cost_impact == null ? "—" : fc(Number(r.cost_impact))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.schedule_impact_days == null ? "—" : `${r.schedule_impact_days >= 0 ? "+" : ""}${r.schedule_impact_days}d`}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className={cn("text-2xs", STATUS_TONE[r.status])}>{r.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100">
                          {r.source_document_id && (
                            <a
                              href={`/api/documents/${r.source_document_id}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-primary"
                              title="View PDF"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {r.status !== "answered" && (
                            <button
                              onClick={() => {
                                const resp = prompt("Response summary:") ?? "";
                                if (resp) setStatus(r.id, "answered", resp);
                                else setStatus(r.id, "answered");
                              }}
                              className="text-emerald-400 hover:text-emerald-300"
                              title="Mark answered"
                            >
                              ✓
                            </button>
                          )}
                          {r.status === "answered" && (
                            <button onClick={() => setStatus(r.id, "closed")} className="text-muted-foreground hover:text-foreground" title="Close">
                              ⊘
                            </button>
                          )}
                          <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-red-400" title="Delete">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
