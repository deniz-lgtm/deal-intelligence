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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

  // Add-bid dialog
  const [bidDialogOpen, setBidDialogOpen] = useState(false);
  const [bidForm, setBidForm] = useState({
    contractor_name: "",
    contractor_company: "",
    contractor_email: "",
    bid_date: "",
    total_amount: "",
    raw_text: "",
    notes: "",
  });
  const [bidFile, setBidFile] = useState<File | null>(null);
  const [uploadingBid, setUploadingBid] = useState(false);

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

  const submitNewBid = async () => {
    if (!bidForm.contractor_name.trim()) return;
    setUploadingBid(true);
    try {
      if (bidFile) {
        // Multipart path: PDF gets stored in R2 and text-extracted server-side.
        const fd = new FormData();
        fd.append("file", bidFile);
        fd.append("contractor_name", bidForm.contractor_name);
        if (bidForm.contractor_company) fd.append("contractor_company", bidForm.contractor_company);
        if (bidForm.contractor_email) fd.append("contractor_email", bidForm.contractor_email);
        if (bidForm.bid_date) fd.append("bid_date", bidForm.bid_date);
        if (bidForm.total_amount !== "") fd.append("total_amount", String(bidForm.total_amount));
        if (bidForm.raw_text) fd.append("raw_text", bidForm.raw_text);
        if (bidForm.notes) fd.append("notes", bidForm.notes);
        await fetch(`/api/deals/${dealId}/gc-bids/upload`, { method: "POST", body: fd });
      } else {
        const payload = {
          ...bidForm,
          total_amount: bidForm.total_amount === "" ? null : Number(bidForm.total_amount),
        };
        await fetch(`/api/deals/${dealId}/gc-bids`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setBidDialogOpen(false);
      setBidForm({
        contractor_name: "", contractor_company: "", contractor_email: "",
        bid_date: "", total_amount: "", raw_text: "", notes: "",
      });
      setBidFile(null);
      load();
    } finally {
      setUploadingBid(false);
    }
  };

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
          <Button size="sm" variant="outline" onClick={() => setBidDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Bid
          </Button>
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
          <Button size="sm" variant="outline" onClick={() => setBidDialogOpen(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add First Bid
          </Button>
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
                {/* Totals row */}
                <tr className="border-t-2 border-border/40 bg-muted/30 font-medium">
                  <td className="px-3 py-2 sticky left-0 bg-muted/30 z-10">Total Bid</td>
                  {data.bids.map((b) => (
                    <td key={b.id} className="px-3 py-2 text-right tabular-nums">
                      {fc(b.total_amount)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Add bid dialog ─────────────────────────────────────────────────── */}
      <Dialog open={bidDialogOpen} onOpenChange={setBidDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Contractor Bid</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contractor *</label>
                <input
                  autoFocus
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={bidForm.contractor_name}
                  onChange={(e) => setBidForm({ ...bidForm, contractor_name: e.target.value })}
                  placeholder="Project manager / lead estimator"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Company</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={bidForm.contractor_company}
                  onChange={(e) => setBidForm({ ...bidForm, contractor_company: e.target.value })}
                  placeholder="Turner Construction"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                <input
                  type="email"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={bidForm.contractor_email}
                  onChange={(e) => setBidForm({ ...bidForm, contractor_email: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Bid Date</label>
                <input
                  type="date"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={bidForm.bid_date}
                  onChange={(e) => setBidForm({ ...bidForm, bid_date: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Total Amount ($)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={bidForm.total_amount}
                  onChange={(e) => setBidForm({ ...bidForm, total_amount: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Bid PDF
                <span className="text-muted-foreground/60 ml-1 normal-case">— upload the contractor's bid (PDF preferred). Text gets extracted automatically and fed to AI leveling.</span>
              </label>
              <input
                type="file"
                accept=".pdf,.txt"
                className="w-full text-xs file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-primary/15 file:text-primary file:cursor-pointer"
                onChange={(e) => setBidFile(e.target.files?.[0] ?? null)}
              />
              {bidFile && (
                <div className="text-2xs text-muted-foreground mt-1">
                  Selected: {bidFile.name} ({(bidFile.size / 1024 / 1024).toFixed(1)} MB)
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Raw Bid Content (optional if PDF uploaded)
                <span className="text-muted-foreground/60 ml-1 normal-case">— paste cover letter / SOV / exclusions; appended to PDF text.</span>
              </label>
              <textarea
                rows={6}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                value={bidForm.raw_text}
                onChange={(e) => setBidForm({ ...bidForm, raw_text: e.target.value })}
                placeholder="Optional. Useful when the bid arrives as an email or you want to add scope clarifications the AI leveler should consider."
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Internal Notes</label>
              <textarea
                rows={2}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                value={bidForm.notes}
                onChange={(e) => setBidForm({ ...bidForm, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setBidDialogOpen(false)} disabled={uploadingBid}>Cancel</Button>
              <Button size="sm" onClick={submitNewBid} disabled={uploadingBid}>
                {uploadingBid ? "Uploading…" : "Add Bid"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
