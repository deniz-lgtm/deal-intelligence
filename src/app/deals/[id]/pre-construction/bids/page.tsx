"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Mail,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Award,
  Edit2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types mirror the API payload ─────────────────────────────────────────────

interface Bid {
  id: string;
  contractor_name: string;
  contractor_company: string | null;
  contractor_email: string | null;
  bid_date: string | null;
  total_amount: number | null;
  status: "received" | "analyzed" | "shortlisted" | "declined" | "awarded";
  source_document_id: string | null;
  raw_text: string | null;
  extraction_status: "pending" | "analyzed";
  notes: string | null;
}

interface ScopeItem {
  id: string;
  division: string | null;
  scope: string;
  notes: string | null;
  sort_order: number;
}

type BidItemStatus = "included" | "excluded" | "alternate" | "unclear";

interface BidItem {
  id: string;
  bid_id: string;
  scope_item_id: string;
  amount: number | null;
  status: BidItemStatus;
  qualifier_note: string | null;
  ai_generated: boolean;
}

interface Question {
  id: string;
  bid_id: string;
  question: string;
  category: string | null;
  status: "open" | "sent" | "answered" | "resolved";
  answer: string | null;
  ai_generated: boolean;
}

interface FullLeveling {
  bids: Bid[];
  scope_items: ScopeItem[];
  bid_items: BidItem[];
  questions: Question[];
}

const fc = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

const STATUS_CFG: Record<BidItemStatus, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  included: { label: "✓", tone: "text-emerald-400", icon: CheckCircle2 },
  excluded: { label: "✕", tone: "text-red-400", icon: XCircle },
  alternate: { label: "ALT", tone: "text-blue-300", icon: AlertTriangle },
  unclear: { label: "?", tone: "text-amber-300", icon: HelpCircle },
};

const BID_STATUS_TONE: Record<Bid["status"], string> = {
  received: "bg-zinc-500/20 text-zinc-300",
  analyzed: "bg-blue-500/20 text-blue-300",
  shortlisted: "bg-amber-500/20 text-amber-300",
  declined: "bg-red-500/20 text-red-300",
  awarded: "bg-emerald-500/20 text-emerald-300",
};

const QUESTION_CATEGORY_LABEL: Record<string, string> = {
  exclusion_clarification: "Exclusion clarification",
  scope_gap: "Scope gap",
  assumption_diff: "Assumption difference",
  pricing_outlier: "Pricing outlier",
  other: "Other",
};

export default function BidsPage({ params }: { params: { id: string } }) {
  const dealId = params.id;
  const [data, setData] = useState<FullLeveling | null>(null);
  const [loading, setLoading] = useState(true);
  const [leveling, setLeveling] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);

  // Inline cell edit
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [cellDraft, setCellDraft] = useState({ amount: "", qualifier_note: "" });

  // Per-bid details expand
  const [expandedBids, setExpandedBids] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/gc-bids`);
      const j = await res.json();
      setData(j.data);
    } catch (err) {
      console.error("Failed to load bids", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteBid = async (bidId: string) => {
    if (!confirm("Delete this bid? Its line items and questions will also be removed.")) return;
    await fetch(`/api/deals/${dealId}/gc-bids/${bidId}`, { method: "DELETE" });
    load();
  };

  const updateBidStatus = async (bidId: string, status: Bid["status"]) => {
    await fetch(`/api/deals/${dealId}/gc-bids/${bidId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const runLeveling = async () => {
    if (!data || data.bids.length === 0) return;
    setLeveling(true);
    setLevelError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/gc-bids/level`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setLevelError(j.error || "Leveling failed");
      } else {
        load();
      }
    } catch (err) {
      console.error(err);
      setLevelError("Leveling request failed.");
    } finally {
      setLeveling(false);
    }
  };

  // Lookup map for fast cell rendering: `${bidId}::${scopeId}` → bid item.
  const cellMap = useMemo(() => {
    if (!data) return new Map<string, BidItem>();
    const m = new Map<string, BidItem>();
    for (const bi of data.bid_items) m.set(`${bi.bid_id}::${bi.scope_item_id}`, bi);
    return m;
  }, [data]);

  const questionsByBid = useMemo(() => {
    const m: Record<string, Question[]> = {};
    if (!data) return m;
    for (const q of data.questions) {
      (m[q.bid_id] ||= []).push(q);
    }
    return m;
  }, [data]);

  // Adjusted total — apples-to-apples. For each bid, where the bid excludes
  // or is unclear on a scope item, impute the median of other bids' amounts
  // for that item (when at least one other bid included it). Surfaces who's
  // truly cheapest after gaps are normalized away.
  const adjustedTotals = useMemo(() => {
    if (!data) return new Map<string, { included: number; imputed: number; adjusted: number; imputationCount: number }>();
    const m = new Map<string, { included: number; imputed: number; adjusted: number; imputationCount: number }>();

    // Index per scope item: included amounts across bids that included it.
    const includedByScope = new Map<string, number[]>();
    for (const bi of data.bid_items) {
      if (bi.status === "included" && bi.amount !== null && bi.amount !== undefined) {
        const arr = includedByScope.get(bi.scope_item_id) ?? [];
        arr.push(Number(bi.amount));
        includedByScope.set(bi.scope_item_id, arr);
      }
    }
    const median = (arr: number[]) => {
      if (arr.length === 0) return null;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
    };

    for (const bid of data.bids) {
      let included = 0;
      let imputed = 0;
      let imputationCount = 0;
      for (const scope of data.scope_items) {
        const cell = cellMap.get(`${bid.id}::${scope.id}`);
        if (cell?.status === "included" && cell.amount !== null && cell.amount !== undefined) {
          included += Number(cell.amount);
        } else if (!cell || cell.status === "excluded" || cell.status === "unclear") {
          // Impute when other bids included this scope.
          const others = (includedByScope.get(scope.id) ?? []).filter((_, i) => {
            // Exclude this bid's own number from the median pool.
            const cellsForScope = data.bid_items.filter((bi) => bi.scope_item_id === scope.id && bi.status === "included" && bi.amount !== null && bi.amount !== undefined);
            return cellsForScope[i]?.bid_id !== bid.id;
          });
          const m = median(others);
          if (m !== null) {
            imputed += m;
            imputationCount++;
          }
        }
        // status === "alternate" → 0 (alts aren't in the base scope)
      }
      m.set(bid.id, { included, imputed, adjusted: included + imputed, imputationCount });
    }
    return m;
  }, [data, cellMap]);

  // Lowest adjusted total = the apples-to-apples winner.
  const lowestAdjusted = useMemo(() => {
    let lowest: number | null = null;
    for (const v of Array.from(adjustedTotals.values())) {
      if (v.adjusted > 0 && (lowest === null || v.adjusted < lowest)) lowest = v.adjusted;
    }
    return lowest;
  }, [adjustedTotals]);

  const groupedScope = useMemo(() => {
    const groups: Record<string, ScopeItem[]> = {};
    if (!data) return groups;
    for (const s of data.scope_items) {
      const div = s.division || "Other";
      (groups[div] ||= []).push(s);
    }
    return groups;
  }, [data]);

  const startCellEdit = (item: BidItem | undefined) => {
    if (!item) return;
    setEditingCellId(item.id);
    setCellDraft({
      amount: item.amount === null ? "" : String(item.amount),
      qualifier_note: item.qualifier_note || "",
    });
  };

  const commitCellEdit = async (item: BidItem) => {
    const amount = cellDraft.amount.trim() === "" ? null : Number(cellDraft.amount);
    const qualifier_note = cellDraft.qualifier_note.trim() || null;
    setEditingCellId(null);
    await fetch(`/api/deals/${dealId}/gc-bid-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, qualifier_note }),
    });
    load();
  };

  const cycleCellStatus = async (item: BidItem) => {
    const order: BidItemStatus[] = ["included", "excluded", "alternate", "unclear"];
    const next = order[(order.indexOf(item.status) + 1) % order.length];
    await fetch(`/api/deals/${dealId}/gc-bid-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    load();
  };

  const updateQuestionStatus = async (qId: string, status: Question["status"]) => {
    await fetch(`/api/deals/${dealId}/gc-bid-questions/${qId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const setQuestionAnswer = async (qId: string) => {
    const answer = prompt("Answer / contractor response:") ?? "";
    if (answer === "") return;
    await fetch(`/api/deals/${dealId}/gc-bid-questions/${qId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer, status: "answered" }),
    });
    load();
  };

  if (loading) {
    return <div className="text-xs text-muted-foreground py-8">Loading bids…</div>;
  }
  if (!data) {
    return <div className="text-xs text-red-400 py-8">Failed to load bids.</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            GC Bid Leveling
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Add each contractor's bid (paste raw text or notes), then run AI leveling. Claude normalizes scope across bids,
            flags exclusions and qualifications, and drafts clarifying questions per contractor.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/deals/${dealId}/pre-construction/bids/new`}>
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" /> Add Bid
            </Button>
          </Link>
          <Button size="sm" disabled={leveling || data.bids.length === 0} onClick={runLeveling}>
            {leveling ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Leveling…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-1" /> AI Level Bids</>
            )}
          </Button>
        </div>
      </header>

      {levelError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {levelError}
        </div>
      )}

      {/* ── Bid cards ─────────────────────────────────────────────────────── */}
      {data.bids.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 bg-card/30 p-8 text-center">
          <Award className="h-6 w-6 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground mb-3">No bids yet. Add the first contractor bid to start leveling.</p>
          <Link href={`/deals/${dealId}/pre-construction/bids/new`}>
            <Button size="sm" variant="outline">
              <Plus className="h-3 w-3 mr-1" /> Add First Bid
            </Button>
          </Link>
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.bids.map((b) => {
            const isExpanded = expandedBids.has(b.id);
            const qs = questionsByBid[b.id] || [];
            const openQs = qs.filter((q) => q.status === "open").length;
            return (
              <div key={b.id} className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
                <div className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display text-base truncate">{b.contractor_name}</div>
                      {b.contractor_company && (
                        <div className="text-2xs text-muted-foreground truncate">{b.contractor_company}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge className={cn("text-2xs", BID_STATUS_TONE[b.status])} variant="secondary">
                        {b.status}
                      </Badge>
                      <button onClick={() => deleteBid(b.id)} className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-foreground">Total Bid</span>
                    <span className="font-bold tabular-nums">{fc(b.total_amount)}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap text-2xs">
                    <select
                      value={b.status}
                      onChange={(e) => updateBidStatus(b.id, e.target.value as Bid["status"])}
                      className="bg-background border border-border rounded px-1.5 py-0.5 text-2xs"
                    >
                      {(["received", "analyzed", "shortlisted", "declined", "awarded"] as Bid["status"][]).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    {b.contractor_email && (
                      <a href={`mailto:${b.contractor_email}`} className="flex items-center gap-1 text-muted-foreground hover:text-primary">
                        <Mail className="h-3 w-3" /> Email
                      </a>
                    )}
                    {openQs > 0 && (
                      <span className="flex items-center gap-1 text-amber-300">
                        <HelpCircle className="h-3 w-3" /> {openQs} open Q
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setExpandedBids((prev) => {
                        const next = new Set(prev);
                        if (next.has(b.id)) next.delete(b.id);
                        else next.add(b.id);
                        return next;
                      });
                    }}
                    className="w-full text-2xs text-muted-foreground hover:text-foreground flex items-center gap-1 pt-1"
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {isExpanded ? "Hide details" : "Show details"}
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-border/30 px-4 py-3 space-y-3 bg-muted/10">
                    {b.source_document_id && (
                      <div>
                        <a
                          href={`/api/documents/${b.source_document_id}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-2xs text-primary hover:underline"
                        >
                          View source bid PDF →
                        </a>
                      </div>
                    )}
                    {b.notes && (
                      <div>
                        <div className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">Notes</div>
                        <p className="text-xs whitespace-pre-wrap">{b.notes}</p>
                      </div>
                    )}
                    <div>
                      <div className="text-2xs uppercase tracking-wider text-muted-foreground mb-1">
                        Clarifying Questions ({qs.length})
                      </div>
                      {qs.length === 0 ? (
                        <p className="text-2xs text-muted-foreground italic">No questions. Run AI leveling to generate.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {qs.map((q) => (
                            <li key={q.id} className="rounded border border-border/30 bg-background/60 p-2 text-xs">
                              <div className="flex items-start gap-2">
                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                  {QUESTION_CATEGORY_LABEL[q.category || "other"]}
                                </Badge>
                                <p className="flex-1">{q.question}</p>
                              </div>
                              {q.answer && (
                                <p className="mt-1.5 pl-2 border-l-2 border-emerald-400/50 text-2xs text-muted-foreground italic">
                                  {q.answer}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1.5 text-2xs">
                                <select
                                  value={q.status}
                                  onChange={(e) => updateQuestionStatus(q.id, e.target.value as Question["status"])}
                                  className="bg-background border border-border rounded px-1.5 py-0.5 text-2xs"
                                >
                                  {(["open", "sent", "answered", "resolved"] as Question["status"][]).map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                  ))}
                                </select>
                                <button onClick={() => setQuestionAnswer(q.id)} className="text-muted-foreground hover:text-primary">
                                  <Edit2 className="h-3 w-3" />
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* ── Leveling table ─────────────────────────────────────────────────── */}
      {data.scope_items.length > 0 && (
        <section className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
          <header className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <h3 className="text-sm font-medium">Leveling Table</h3>
            <span className="text-2xs text-muted-foreground">
              {data.scope_items.length} scope rows × {data.bids.length} bids
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-muted/20 border-b border-border/30 text-2xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2 sticky left-0 bg-muted/30 z-10 min-w-[260px]">Scope</th>
                  {data.bids.map((b) => (
                    <th key={b.id} className="text-right px-3 py-2 min-w-[160px]">
                      <div className="font-medium normal-case tracking-normal">{b.contractor_name}</div>
                      {b.total_amount !== null && (
                        <div className="text-muted-foreground tabular-nums normal-case font-normal">
                          {fc(b.total_amount)}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(groupedScope).map(([div, items]) => (
                  <DivisionGroup
                    key={div}
                    division={div}
                    items={items}
                    bids={data.bids}
                    cellMap={cellMap}
                    editingCellId={editingCellId}
                    cellDraft={cellDraft}
                    onCellStatusCycle={cycleCellStatus}
                    onCellEdit={startCellEdit}
                    onCellCommit={commitCellEdit}
                    onCellDraftChange={setCellDraft}
                  />
                ))}
                {/* Totals row — original bid totals */}
                <tr className="border-t-2 border-border/40 bg-muted/30 font-medium">
                  <td className="px-3 py-2 sticky left-0 bg-muted/30 z-10">Total Bid</td>
                  {data.bids.map((b) => (
                    <td key={b.id} className="px-3 py-2 text-right tabular-nums">
                      {fc(b.total_amount)}
                    </td>
                  ))}
                </tr>
                {/* Imputation row — only shown when at least one bid has imputations */}
                {Array.from(adjustedTotals.values()).some((v) => v.imputationCount > 0) && (
                  <tr className="bg-muted/15 text-amber-300/90">
                    <td className="px-3 py-2 sticky left-0 bg-muted/15 z-10 text-2xs uppercase tracking-wider">+ Imputed gaps</td>
                    {data.bids.map((b) => {
                      const adj = adjustedTotals.get(b.id);
                      if (!adj || adj.imputationCount === 0) {
                        return <td key={b.id} className="px-3 py-2 text-right tabular-nums text-muted-foreground/40">—</td>;
                      }
                      return (
                        <td key={b.id} className="px-3 py-2 text-right tabular-nums" title={`${adj.imputationCount} excluded/unclear scope item${adj.imputationCount === 1 ? "" : "s"} imputed at median of other bids' amounts`}>
                          + {fc(adj.imputed)}
                          <div className="text-2xs opacity-70">({adj.imputationCount} {adj.imputationCount === 1 ? "gap" : "gaps"})</div>
                        </td>
                      );
                    })}
                  </tr>
                )}
                {/* Adjusted total — apples-to-apples winner */}
                <tr className="border-t border-border/40 bg-primary/10 text-primary font-bold">
                  <td className="px-3 py-2 sticky left-0 bg-primary/10 z-10">Adjusted Total</td>
                  {data.bids.map((b) => {
                    const adj = adjustedTotals.get(b.id);
                    if (!adj || adj.adjusted === 0) {
                      return <td key={b.id} className="px-3 py-2 text-right tabular-nums text-muted-foreground/40">—</td>;
                    }
                    const isLowest = lowestAdjusted !== null && Math.abs(adj.adjusted - lowestAdjusted) < 1;
                    const delta = lowestAdjusted !== null ? adj.adjusted - lowestAdjusted : 0;
                    return (
                      <td key={b.id} className="px-3 py-2 text-right tabular-nums">
                        {fc(adj.adjusted)}
                        {!isLowest && lowestAdjusted !== null && delta > 0 && (
                          <div className="text-2xs font-normal text-muted-foreground">+{fc(delta)} vs low</div>
                        )}
                        {isLowest && (
                          <div className="text-2xs font-normal text-emerald-400">⊙ apples-to-apples low</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  );
}

// ─── Division group rendering ───────────────────────────────────────────────

function DivisionGroup({
  division,
  items,
  bids,
  cellMap,
  editingCellId,
  cellDraft,
  onCellStatusCycle,
  onCellEdit,
  onCellCommit,
  onCellDraftChange,
}: {
  division: string;
  items: ScopeItem[];
  bids: Bid[];
  cellMap: Map<string, BidItem>;
  editingCellId: string | null;
  cellDraft: { amount: string; qualifier_note: string };
  onCellStatusCycle: (item: BidItem) => void;
  onCellEdit: (item: BidItem | undefined) => void;
  onCellCommit: (item: BidItem) => void;
  onCellDraftChange: (draft: { amount: string; qualifier_note: string }) => void;
}) {
  return (
    <>
      <tr className="bg-muted/15 border-t border-border/30">
        <td colSpan={1 + bids.length} className="px-3 py-1.5 text-2xs uppercase tracking-wider text-muted-foreground font-medium">
          {division}
        </td>
      </tr>
      {items.map((s) => (
        <tr key={s.id} className="border-t border-border/20 hover:bg-muted/10">
          <td className="px-3 py-2 sticky left-0 bg-card z-10">
            <div className="font-medium">{s.scope}</div>
            {s.notes && <div className="text-2xs text-muted-foreground mt-0.5">{s.notes}</div>}
          </td>
          {bids.map((b) => {
            const item = cellMap.get(`${b.id}::${s.id}`);
            if (!item) {
              return (
                <td key={b.id} className="px-3 py-2 text-right text-muted-foreground/30 text-2xs">
                  —
                </td>
              );
            }
            const cfg = STATUS_CFG[item.status];
            const isEditing = editingCellId === item.id;
            return (
              <td key={b.id} className="px-3 py-2 text-right">
                {isEditing ? (
                  <div className="flex flex-col gap-1">
                    <input
                      autoFocus
                      type="number"
                      className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-2xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                      value={cellDraft.amount}
                      onChange={(e) => onCellDraftChange({ ...cellDraft, amount: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCellCommit(item);
                        if (e.key === "Escape") onCellEdit(undefined);
                      }}
                      onBlur={() => onCellCommit(item)}
                    />
                    <input
                      type="text"
                      className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-2xs focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="qualifier (optional)"
                      value={cellDraft.qualifier_note}
                      onChange={(e) => onCellDraftChange({ ...cellDraft, qualifier_note: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCellCommit(item);
                        if (e.key === "Escape") onCellEdit(undefined);
                      }}
                      onBlur={() => onCellCommit(item)}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-1.5 group">
                    <button
                      onClick={() => onCellStatusCycle(item)}
                      className={cn("text-xs font-bold cursor-pointer hover:opacity-70", cfg.tone)}
                      title={`Status: ${item.status}. Click to cycle.`}
                    >
                      {cfg.label}
                    </button>
                    <button
                      onClick={() => onCellEdit(item)}
                      className="tabular-nums hover:text-primary"
                      title={item.qualifier_note || "Click to edit"}
                    >
                      {fc(item.amount)}
                    </button>
                    {item.qualifier_note && (
                      <span className="text-amber-400" title={item.qualifier_note}>
                        <AlertTriangle className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
