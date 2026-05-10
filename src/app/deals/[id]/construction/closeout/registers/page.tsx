"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  FileSignature,
  ExternalLink,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Closeout registers — read-only views of warranties and lien waivers
// extracted by AI when the user uploads docs into closeout checklist items.
// Acts as the system-of-record for both, with status indicators showing
// expiring warranties and lien-waiver match issues.

interface Warranty {
  id: string;
  vendor: string | null;
  product: string;
  scope: string | null;
  start_date: string | null;
  duration_months: number | null;
  end_date: string | null;
  coverage_summary: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  source_document_id: string | null;
  ai_confidence: number | null;
}

interface LienWaiver {
  id: string;
  contractor_name: string | null;
  waiver_type: string | null;
  through_date: string | null;
  amount: number | null;
  draw_id: string | null;
  draw_number: number | null;
  draw_title: string | null;
  source_document_id: string | null;
  match_status: string;
  match_notes: string | null;
  ai_confidence: number | null;
  created_at: string;
}

const fc = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

const MATCH_TONE: Record<string, string> = {
  matched: "bg-emerald-500/15 text-emerald-300",
  needs_review: "bg-amber-500/15 text-amber-300",
  amount_mismatch: "bg-red-500/15 text-red-300",
  unverified: "bg-zinc-500/15 text-zinc-300",
};

const WAIVER_TYPE_LABEL: Record<string, string> = {
  conditional_progress: "Conditional Progress",
  unconditional_progress: "Unconditional Progress",
  conditional_final: "Conditional Final",
  unconditional_final: "Unconditional Final",
};

function isExpiringSoon(end: string | null): boolean {
  if (!end) return false;
  const d = new Date(`${end}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const days = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days > 0 && days < 60;
}

function isExpired(end: string | null): boolean {
  if (!end) return false;
  const d = new Date(`${end}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

export default function CloseoutRegistersPage({ params }: { params: { id: string } }) {
  const dealId = params.id;
  const [tab, setTab] = useState<"warranties" | "waivers">("warranties");
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [waivers, setWaivers] = useState<LienWaiver[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [wRes, lwRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/warranties`),
        fetch(`/api/deals/${dealId}/lien-waivers`),
      ]);
      const [wJ, lwJ] = await Promise.all([wRes.json(), lwRes.json()]);
      setWarranties(wJ.data || []);
      setWaivers(lwJ.data || []);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const removeWarranty = async (id: string) => {
    if (!confirm("Remove this warranty from the register?")) return;
    await fetch(`/api/deals/${dealId}/warranties/${id}`, { method: "DELETE" });
    load();
  };

  const removeWaiver = async (id: string) => {
    if (!confirm("Remove this lien-waiver record?")) return;
    await fetch(`/api/deals/${dealId}/lien-waivers/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/deals/${dealId}/construction/closeout`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="font-display text-2xl">Closeout Registers</h1>
        </div>
      </header>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Auto-populated by AI when you upload warranty / lien-waiver documents into closeout checklist items.
        This is the audit trail you'd hand to the lender or operations team at building turnover.
      </p>

      <div className="flex gap-2 text-xs">
        <button
          onClick={() => setTab("warranties")}
          className={cn(
            "px-3 py-1.5 rounded-md inline-flex items-center gap-1.5",
            tab === "warranties" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/30",
          )}
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Warranties ({warranties.length})
        </button>
        <button
          onClick={() => setTab("waivers")}
          className={cn(
            "px-3 py-1.5 rounded-md inline-flex items-center gap-1.5",
            tab === "waivers" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/30",
          )}
        >
          <FileSignature className="h-3.5 w-3.5" /> Lien Waivers ({waivers.length})
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-8">Loading…</div>
      ) : tab === "warranties" ? (
        warranties.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/40 p-8 text-center text-sm text-muted-foreground">
            No warranties registered yet. Upload a warranty PDF into a Warranties closeout item to populate this register automatically.
          </div>
        ) : (
          <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="text-2xs uppercase tracking-wider bg-muted/20 border-b border-border/30">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-left">Vendor</th>
                    <th className="px-3 py-2 text-left">Scope</th>
                    <th className="px-3 py-2 text-left">Start</th>
                    <th className="px-3 py-2 text-left">Duration</th>
                    <th className="px-3 py-2 text-left">End</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {warranties.map((w) => {
                    const expired = isExpired(w.end_date);
                    const expiring = !expired && isExpiringSoon(w.end_date);
                    return (
                      <tr key={w.id} className="group border-t border-border/20 hover:bg-muted/10">
                        <td className="px-3 py-2 font-medium">{w.product}</td>
                        <td className="px-3 py-2 text-muted-foreground">{w.vendor || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[260px] truncate">{w.scope || "—"}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {w.start_date ? new Date(`${w.start_date}T00:00:00`).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {w.duration_months ? `${w.duration_months} mo` : "—"}
                        </td>
                        <td className={cn("px-3 py-2 tabular-nums", expired && "text-red-400 font-medium", expiring && "text-amber-300 font-medium")}>
                          {w.end_date ? (
                            <span className="inline-flex items-center gap-1">
                              {(expired || expiring) && <AlertTriangle className="h-3 w-3" />}
                              {new Date(`${w.end_date}T00:00:00`).toLocaleDateString()}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {expired ? (
                            <Badge variant="secondary" className="text-2xs bg-red-500/15 text-red-300">expired</Badge>
                          ) : expiring ? (
                            <Badge variant="secondary" className="text-2xs bg-amber-500/15 text-amber-300">expiring soon</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-2xs bg-emerald-500/15 text-emerald-300">active</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100">
                            {w.source_document_id && (
                              <a
                                href={`/api/documents/${w.source_document_id}/view`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary"
                                title="View source PDF"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <button onClick={() => removeWarranty(w.id)} className="text-muted-foreground hover:text-red-400" title="Remove">
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
          </div>
        )
      ) : waivers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 p-8 text-center text-sm text-muted-foreground">
          No lien waivers registered yet. Upload a lien-waiver PDF into a Lien Waivers closeout item to populate this register automatically.
        </div>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-2xs uppercase tracking-wider bg-muted/20 border-b border-border/30">
                <tr>
                  <th className="px-3 py-2 text-left">Contractor</th>
                  <th className="px-3 py-2 text-left">Waiver Type</th>
                  <th className="px-3 py-2 text-left">Through Date</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Draw</th>
                  <th className="px-3 py-2 text-left">Match</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {waivers.map((w) => (
                  <tr key={w.id} className="group border-t border-border/20 hover:bg-muted/10">
                    <td className="px-3 py-2 font-medium">{w.contractor_name || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {w.waiver_type ? (WAIVER_TYPE_LABEL[w.waiver_type] || w.waiver_type) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {w.through_date ? new Date(`${w.through_date}T00:00:00`).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fc(w.amount)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {w.draw_number ? `Draw #${w.draw_number}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className={cn("text-2xs", MATCH_TONE[w.match_status] ?? MATCH_TONE.unverified)}>
                        {w.match_status === "matched" && <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />}
                        {w.match_status === "amount_mismatch" && <AlertTriangle className="h-2.5 w-2.5 inline mr-0.5" />}
                        {w.match_status === "needs_review" && <HelpCircle className="h-2.5 w-2.5 inline mr-0.5" />}
                        {w.match_status.replace(/_/g, " ")}
                      </Badge>
                      {w.match_notes && (
                        <div className="text-2xs text-muted-foreground mt-0.5 max-w-[280px]">{w.match_notes}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100">
                        {w.source_document_id && (
                          <a
                            href={`/api/documents/${w.source_document_id}/view`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                            title="View source PDF"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <button onClick={() => removeWaiver(w.id)} className="text-muted-foreground hover:text-red-400" title="Remove">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
