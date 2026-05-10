"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Plus,
  Trash2,
  Wallet,
  Sparkles,
  Upload,
  Loader2,
  Edit2,
  CheckCircle2,
  GitBranch,
  AlertTriangle,
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
import type { HardCostItem, BudgetVersion, BudgetCostClass } from "@/lib/types";

// SOV-style budget sheet. One table per cost class (hard / soft / contingency)
// with draws as columns. Replaces the legacy "Hard Cost Budget" UI; the IC
// approval-gate machinery is gone since this lives under Construction, where
// owner-side IC sign-off doesn't apply at the line-item level.

interface Draw {
  id: string;
  draw_number: number;
  title: string;
  status: string;
  submitted_date: string | null;
  approved_date: string | null;
  funded_date: string | null;
  amount_requested: number;
  amount_approved: number | null;
  retainage_held: number;
  pct_complete_claimed: number;
  notes: string | null;
}

interface DrawItem {
  id: string;
  draw_id: string;
  hardcost_item_id: string | null;
  description: string;
  amount_requested: number;
  amount_approved: number | null;
  sort_order: number;
}

const fc = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

const CLASS_TONE: Record<BudgetCostClass, string> = {
  hard: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  soft: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  contingency: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

const CLASS_LABEL: Record<BudgetCostClass, string> = {
  hard: "Hard Costs",
  soft: "Soft Costs",
  contingency: "Contingency",
};

interface Props {
  dealId: string;
}

export default function BudgetSheet({ dealId }: Props) {
  const [items, setItems] = useState<HardCostItem[]>([]);
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [draws, setDraws] = useState<Draw[]>([]);
  const [drawItems, setDrawItems] = useState<DrawItem[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [classFilter, setClassFilter] = useState<BudgetCostClass | "all">("all");
  const [editingCell, setEditingCell] = useState<string | null>(null); // "row:field" or "drawitem:id"
  const [cellDraft, setCellDraft] = useState("");

  // Dialogs
  const [seedOpen, setSeedOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addDrawOpen, setAddDrawOpen] = useState(false);

  const [importTab, setImportTab] = useState<"paste" | "file" | "pdf">("paste");
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  // AI insights panel state
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [generatingNarrative, setGeneratingNarrative] = useState(false);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [paceAnomalies, setPaceAnomalies] = useState<Array<{
    hardcost_item_id: string;
    description: string;
    category: string;
    pct_complete: number;
    project_pct_complete: number;
    delta_pct: number;
    severity: "info" | "warn" | "alert";
    reason: string;
  }>>([]);

  // Approved-CO totals per line, keyed by hardcost_item_id. Used to auto-fill
  // the CO column when the user has linked COs to lines (instead of entering
  // change_order_amount manually). Falls back to the manual field when no
  // linked CO exists.
  const [approvedCoByLine, setApprovedCoByLine] = useState<Record<string, number>>({});

  const [newVersion, setNewVersion] = useState({ label: "", clone_from: "", set_active: true });
  const [newItem, setNewItem] = useState({
    cost_class: "hard" as BudgetCostClass,
    category: "Hard Cost",
    description: "",
    unit: "",
    amount: 0,
    retainage_pct: 0,
  });
  const [newDraw, setNewDraw] = useState({ title: "", submitted_date: "" });

  const load = useCallback(async () => {
    try {
      const [vRes, dRes, diRes, coRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/budget-versions`),
        fetch(`/api/deals/${dealId}/draws`),
        fetch(`/api/deals/${dealId}/draws?with_items=1`),
        fetch(`/api/deals/${dealId}/change-orders/approved-by-line`),
      ]);
      const vJson = await vRes.json();
      const dJson = await dRes.json();
      const diJson = await diRes.json();
      const coJson = await coRes.json().catch(() => ({ data: {} }));
      setApprovedCoByLine((coJson.data || {}) as Record<string, number>);
      const vs = (vJson.data || []) as BudgetVersion[];
      setVersions(vs);
      const active = vs.find((v) => v.is_active) || vs[0] || null;
      const versionId = active?.id || null;
      setActiveVersionId(versionId);

      // Items scoped to active version (or all if no version yet)
      const itemsRes = await fetch(`/api/deals/${dealId}/hardcost-items${versionId ? `?version_id=${versionId}` : ""}`);
      const itemsJson = await itemsRes.json();
      setItems((itemsJson.data || []) as HardCostItem[]);

      setDraws((dJson.data || []) as Draw[]);
      // The /draws endpoint may or may not embed items; gather draw items
      // separately when not embedded.
      const embeddedItems: DrawItem[] = [];
      for (const d of dJson.data || []) {
        if (Array.isArray(d.items)) {
          for (const di of d.items) embeddedItems.push({ ...di, draw_id: d.id });
        }
      }
      if (embeddedItems.length > 0) {
        setDrawItems(embeddedItems);
      } else {
        // Fall back to fetching items per draw — only used on first load before
        // the embedded shape is wired up. Cheap because the draw count is small.
        const allItems: DrawItem[] = [];
        for (const d of dJson.data || []) {
          try {
            const r = await fetch(`/api/deals/${dealId}/draws/${d.id}/items`);
            const j = await r.json();
            for (const di of j.data || []) allItems.push(di);
          } catch {
            /* swallow — draw_items endpoint optional */
          }
        }
        setDrawItems(allItems);
      }
    } catch (err) {
      console.error("Failed to load budget", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Inline edit helpers ───────────────────────────────────────────────
  const startEdit = (key: string, value: string) => {
    setEditingCell(key);
    setCellDraft(value);
  };

  const commitItemField = async (item: HardCostItem, field: "amount" | "change_order_amount" | "retainage_pct" | "category" | "description" | "unit") => {
    const value = field === "category" || field === "description" || field === "unit"
      ? cellDraft.trim()
      : Number(cellDraft.replace(/[$,%\s]/g, ""));
    setEditingCell(null);
    await fetch(`/api/deals/${dealId}/hardcost-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    load();
  };

  const commitDrawItemAmount = async (drawId: string, hardcostItemId: string, existing?: DrawItem) => {
    const amount = Number(cellDraft.replace(/[$,\s]/g, "")) || 0;
    setEditingCell(null);
    if (existing) {
      await fetch(`/api/deals/${dealId}/draws/${drawId}/items/${existing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_approved: amount, amount_requested: amount }),
      });
    } else {
      const item = items.find((i) => i.id === hardcostItemId);
      await fetch(`/api/deals/${dealId}/draws/${drawId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hardcost_item_id: hardcostItemId,
          description: item?.description || "",
          amount_requested: amount,
          amount_approved: amount,
        }),
      });
    }
    load();
  };

  // ── Derived ──────────────────────────────────────────────────────────
  const sortedDraws = useMemo(() => [...draws].sort((a, b) => a.draw_number - b.draw_number), [draws]);

  // For each (item, draw) lookup the approved amount.
  const drawAmountMap = useMemo(() => {
    const m = new Map<string, DrawItem>();
    for (const di of drawItems) {
      if (di.hardcost_item_id) m.set(`${di.hardcost_item_id}::${di.draw_id}`, di);
    }
    return m;
  }, [drawItems]);

  const computeRow = (item: HardCostItem) => {
    const original = Number(item.amount) || 0;
    // Prefer approved-CO totals from the change-order tracker when this line
    // has linked COs; fall back to the manual change_order_amount field
    // (which is still editable for lines without a linked CO).
    const linkedCo = approvedCoByLine[item.id];
    const co = linkedCo !== undefined && linkedCo !== 0
      ? Number(linkedCo)
      : Number(item.change_order_amount) || 0;
    const current = original + co;
    let totalCompleted = 0;
    for (const d of sortedDraws) {
      const di = drawAmountMap.get(`${item.id}::${d.id}`);
      const v = di?.amount_approved ?? di?.amount_requested ?? 0;
      totalCompleted += Number(v);
    }
    const pct = current > 0 ? (totalCompleted / current) * 100 : 0;
    const balance = current - totalCompleted;
    const retainage = totalCompleted * (Number(item.retainage_pct) || 0) / 100;
    return { original, co, current, totalCompleted, pct, balance, retainage };
  };

  const grouped = useMemo(() => {
    const m: Record<BudgetCostClass, HardCostItem[]> = { hard: [], soft: [], contingency: [] };
    for (const it of items) {
      const c = (it.cost_class || "hard") as BudgetCostClass;
      m[c].push(it);
    }
    for (const c of Object.keys(m) as BudgetCostClass[]) {
      m[c].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return m;
  }, [items]);

  const grandTotals = useMemo(() => {
    const out = { original: 0, co: 0, current: 0, totalCompleted: 0, balance: 0, retainage: 0 };
    for (const it of items) {
      const r = computeRow(it);
      out.original += r.original;
      out.co += r.co;
      out.current += r.current;
      out.totalCompleted += r.totalCompleted;
      out.balance += r.balance;
      out.retainage += r.retainage;
    }
    return out;
  }, [items, sortedDraws, drawAmountMap]);

  // ── Actions ──────────────────────────────────────────────────────────
  const seedTemplate = async (template: "standard_sov" | "csi", replace: boolean) => {
    setImporting(true);
    try {
      await fetch(`/api/deals/${dealId}/budget/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, replace, version_id: activeVersionId }),
      });
      setSeedOpen(false);
      load();
    } finally {
      setImporting(false);
    }
  };

  const submitPaste = async () => {
    // Parse TSV/CSV. Heuristic: split rows by newline, columns by tab. If no
    // tabs present anywhere, fall back to comma. First non-empty row is treated
    // as the header — same column-name normalization as the server.
    const lines = pasteText.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      alert("Paste at least a header row and one data row.");
      return;
    }
    const sep = lines[0].includes("\t") ? "\t" : ",";
    const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(sep);
      const r: Record<string, string> = {};
      headers.forEach((h, i) => { r[h] = (cells[i] ?? "").trim(); });
      return {
        cost_class: r.costclass || r.class || r.type || (((r.category || "").toLowerCase()).includes("soft") ? "soft" : ((r.category || "").toLowerCase()).includes("contingency") ? "contingency" : "hard"),
        category: r.category || r.section || "",
        description: r.description || r.item || r.scope || "",
        csi_code: r.csi || r.csicode || r.code || null,
        unit: r.unit || null,
        amount: r.originalscheduledvalue || r.scheduledvalue || r.budget || r.amount || 0,
        retainage_pct: r.retainagepct || r.retainage || 0,
      };
    });
    setImporting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/budget/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, version_id: activeVersionId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Import failed");
      } else {
        setImportOpen(false);
        setPasteText("");
        load();
      }
    } finally {
      setImporting(false);
    }
  };

  const submitPdf = async () => {
    const f = pdfRef.current?.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    if (activeVersionId) fd.append("version_id", activeVersionId);
    setImporting(true);
    setImportMessage(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/budget/extract-pdf`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) {
        setImportMessage(j.error || "Extraction failed");
      } else {
        setImportOpen(false);
        if (pdfRef.current) pdfRef.current.value = "";
        setImportMessage(null);
        load();
      }
    } finally {
      setImporting(false);
    }
  };

  const generateNarrative = async () => {
    setGeneratingNarrative(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/budget/variance-narrative`, { method: "POST" });
      const j = await res.json();
      setNarrative(j.data?.narrative ?? null);
    } finally {
      setGeneratingNarrative(false);
    }
  };

  // Refresh anomalies whenever the dataset changes. Cheap heuristic call;
  // doesn't hit Claude.
  useEffect(() => {
    if (items.length === 0 || draws.length === 0) {
      setPaceAnomalies([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/budget/pace-anomalies`);
        const j = await res.json();
        if (!cancelled) setPaceAnomalies(j.data?.anomalies ?? []);
      } catch {
        /* swallow — non-critical */
      }
    })();
    return () => { cancelled = true; };
  }, [dealId, items, draws]);

  const submitFile = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    if (activeVersionId) fd.append("version_id", activeVersionId);
    setImporting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/budget/import`, { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Import failed");
      } else {
        setImportOpen(false);
        if (fileRef.current) fileRef.current.value = "";
        load();
      }
    } finally {
      setImporting(false);
    }
  };

  const submitNewVersion = async () => {
    if (!newVersion.label.trim()) return;
    await fetch(`/api/deals/${dealId}/budget-versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: newVersion.label.trim(),
        cloned_from_version_id: newVersion.clone_from || null,
        set_active: newVersion.set_active,
      }),
    });
    setVersionOpen(false);
    setNewVersion({ label: "", clone_from: "", set_active: true });
    load();
  };

  const setActiveVersion = async (id: string) => {
    await fetch(`/api/deals/${dealId}/budget-versions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ set_active: true }),
    });
    load();
  };

  const submitNewItem = async () => {
    if (!newItem.description.trim()) return;
    await fetch(`/api/deals/${dealId}/hardcost-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newItem,
        budget_version_id: activeVersionId,
      }),
    });
    setAddItemOpen(false);
    setNewItem({ cost_class: "hard", category: "Hard Cost", description: "", unit: "", amount: 0, retainage_pct: 0 });
    load();
  };

  const submitNewDraw = async () => {
    const next = sortedDraws.length > 0 ? Math.max(...sortedDraws.map((d) => d.draw_number)) + 1 : 1;
    await fetch(`/api/deals/${dealId}/draws`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draw_number: next,
        title: newDraw.title || `Draw #${next}`,
        submitted_date: newDraw.submitted_date || null,
      }),
    });
    setAddDrawOpen(false);
    setNewDraw({ title: "", submitted_date: "" });
    load();
  };

  const deleteItem = async (id: string) => {
    if (!confirm("Delete this budget line?")) return;
    await fetch(`/api/deals/${dealId}/hardcost-items/${id}`, { method: "DELETE" });
    load();
  };

  if (loading) return <div className="text-xs text-muted-foreground py-8">Loading budget…</div>;

  const visibleClasses: BudgetCostClass[] = classFilter === "all" ? ["hard", "soft", "contingency"] : [classFilter];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {/* Version selector */}
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={activeVersionId ?? ""}
            onChange={(e) => setActiveVersion(e.target.value)}
            className="bg-background border border-border rounded-md px-2 py-1 text-xs"
          >
            {versions.length === 0 && <option value="">No versions yet</option>}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}{v.is_active ? " (active)" : ""}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" className="h-7 text-2xs" onClick={() => setVersionOpen(true)}>
            <Plus className="h-3 w-3 mr-1" /> Version
          </Button>
        </div>

        <div className="w-px h-5 bg-border/40 mx-1" />

        {/* Class filter */}
        {(["all", "hard", "soft", "contingency"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setClassFilter(c)}
            className={cn(
              "px-2.5 py-1 rounded-md border tabular-nums",
              classFilter === c ? "bg-primary/15 border-primary/40 text-primary" : "border-border/40 text-muted-foreground hover:bg-muted/30"
            )}
          >
            {c === "all" ? "All" : CLASS_LABEL[c]}
          </button>
        ))}

        <div className="w-px h-5 bg-border/40 mx-1" />

        <Button size="sm" variant="outline" className="h-7 text-2xs" onClick={() => setAddItemOpen(true)}>
          <Plus className="h-3 w-3 mr-1" /> Line
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-2xs" onClick={() => setAddDrawOpen(true)}>
          <Plus className="h-3 w-3 mr-1" /> Draw
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-2xs" onClick={() => setImportOpen(true)}>
          <Upload className="h-3 w-3 mr-1" /> Import
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-2xs" onClick={() => setSeedOpen(true)}>
          <Sparkles className="h-3 w-3 mr-1" /> Seed Template
        </Button>
      </div>

      {/* AI insights — pace anomalies + variance narrative */}
      {items.length > 0 && (paceAnomalies.length > 0 || draws.length > 0) && (
        <section className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
          <header className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-muted/10">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">AI Insights</span>
              {paceAnomalies.length > 0 && (
                <span className="text-2xs text-muted-foreground">
                  {paceAnomalies.filter((a) => a.severity === "alert").length} alert·{paceAnomalies.filter((a) => a.severity === "warn").length} warn
                </span>
              )}
            </div>
            <button
              onClick={() => setInsightsOpen((v) => !v)}
              className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              {insightsOpen ? <><ChevronDown className="h-3 w-3" /> Hide</> : <><ChevronRight className="h-3 w-3" /> Show</>}
            </button>
          </header>
          {insightsOpen && (
            <div className="px-4 py-3 space-y-3">
              {paceAnomalies.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-2xs uppercase tracking-wider text-muted-foreground">Billing-pace anomalies</div>
                  {paceAnomalies.slice(0, 6).map((a) => (
                    <div
                      key={a.hardcost_item_id}
                      className={cn(
                        "rounded border px-2.5 py-1.5 text-xs flex items-start gap-2",
                        a.severity === "alert" && "border-red-500/30 bg-red-500/5",
                        a.severity === "warn" && "border-amber-500/30 bg-amber-500/5",
                        a.severity === "info" && "border-border/40",
                      )}
                    >
                      <AlertTriangle className={cn(
                        "h-3 w-3 shrink-0 mt-0.5",
                        a.severity === "alert" ? "text-red-400" : a.severity === "warn" ? "text-amber-300" : "text-muted-foreground",
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{a.description}</div>
                        <div className="text-2xs text-muted-foreground mt-0.5">{a.reason}</div>
                      </div>
                    </div>
                  ))}
                  {paceAnomalies.length > 6 && (
                    <div className="text-2xs text-muted-foreground">+ {paceAnomalies.length - 6} more anomalies</div>
                  )}
                </div>
              )}
              <div className="space-y-1.5 pt-1 border-t border-border/20">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-2xs uppercase tracking-wider text-muted-foreground">Variance narrative</div>
                  <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={generateNarrative} disabled={generatingNarrative}>
                    {generatingNarrative ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Drafting</> : <><Sparkles className="h-3 w-3 mr-1" /> Draft</>}
                  </Button>
                </div>
                {narrative ? (
                  <p className="text-xs whitespace-pre-wrap leading-relaxed">{narrative}</p>
                ) : (
                  <p className="text-2xs text-muted-foreground italic">
                    Click Draft to have Claude write a 3–5 sentence narrative explaining your variance against the original budget.
                    Pulls in approved COs, top variance lines, and open RFIs.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 bg-card/30 p-12 text-center">
          <Wallet className="h-6 w-6 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground mb-3">
            No budget lines yet. Seed a standard SOV, paste from a spreadsheet, or upload an XLSX.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setSeedOpen(true)}>
              <Sparkles className="h-3 w-3 mr-1" /> Seed Template
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-3 w-3 mr-1" /> Import
            </Button>
            <Button size="sm" onClick={() => setAddItemOpen(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add Line
            </Button>
          </div>
        </div>
      ) : (
        // Main SOV table — single horizontal scroll for the whole sheet.
        <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-2xs uppercase tracking-wider bg-muted/20 border-b border-border/30">
                <tr>
                  <th className="px-2 py-2 text-left sticky left-0 bg-muted/30 z-20 min-w-[40px]">#</th>
                  <th className="px-2 py-2 text-left min-w-[80px]">Unit</th>
                  <th className="px-2 py-2 text-left min-w-[110px]">Category</th>
                  <th className="px-2 py-2 text-left min-w-[200px]">Item</th>
                  <th className="px-2 py-2 text-right min-w-[110px]">Original</th>
                  <th className="px-2 py-2 text-right min-w-[100px]">CO</th>
                  <th className="px-2 py-2 text-right min-w-[110px]">Current</th>
                  <th className="px-2 py-2 text-right min-w-[110px]">Prev. Paid</th>
                  <th className="px-2 py-2 text-right min-w-[110px]">This Period</th>
                  <th className="px-2 py-2 text-right min-w-[110px]">Total Compl.</th>
                  <th className="px-2 py-2 text-right min-w-[60px]">%</th>
                  <th className="px-2 py-2 text-right min-w-[110px]">Balance</th>
                  <th className="px-2 py-2 text-right min-w-[100px]">Retainage</th>
                  {sortedDraws.map((d) => (
                    <th key={d.id} className="px-2 py-2 text-right min-w-[110px]" title={d.title}>
                      Draw #{d.draw_number}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right min-w-[110px]">Total</th>
                  <th className="px-2 py-2 sticky right-0 bg-muted/30 min-w-[40px]"></th>
                </tr>
              </thead>
              <tbody>
                {visibleClasses.map((cls) => {
                  const rows = grouped[cls];
                  if (rows.length === 0) return null;
                  return (
                    <ClassSection
                      key={cls}
                      cls={cls}
                      rows={rows}
                      sortedDraws={sortedDraws}
                      drawAmountMap={drawAmountMap}
                      computeRow={computeRow}
                      currentDrawId={sortedDraws[sortedDraws.length - 1]?.id}
                      editingCell={editingCell}
                      cellDraft={cellDraft}
                      onStartEdit={startEdit}
                      onCommitItem={commitItemField}
                      onCommitDrawItem={commitDrawItemAmount}
                      onCellDraftChange={setCellDraft}
                      onCancelEdit={() => setEditingCell(null)}
                      onDelete={deleteItem}
                    />
                  );
                })}
                {/* Grand totals */}
                <tr className="border-t-2 border-border/40 bg-muted/30 font-bold">
                  <td className="px-2 py-2 sticky left-0 bg-muted/40 z-20" colSpan={4}>Grand Total</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fc(grandTotals.original)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fc(grandTotals.co)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fc(grandTotals.current)}</td>
                  <td className="px-2 py-2 text-right tabular-nums" colSpan={3}>{fc(grandTotals.totalCompleted)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {grandTotals.current > 0 ? `${((grandTotals.totalCompleted / grandTotals.current) * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fc(grandTotals.balance)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fc(grandTotals.retainage)}</td>
                  {sortedDraws.map((d) => {
                    let s = 0;
                    for (const it of items) {
                      const di = drawAmountMap.get(`${it.id}::${d.id}`);
                      s += Number(di?.amount_approved ?? di?.amount_requested ?? 0);
                    }
                    return (
                      <td key={d.id} className="px-2 py-2 text-right tabular-nums">{fc(s)}</td>
                    );
                  })}
                  <td className="px-2 py-2 text-right tabular-nums">{fc(grandTotals.totalCompleted)}</td>
                  <td className="sticky right-0 bg-muted/40"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Seed dialog ─────────────────────────────────────────────────── */}
      <Dialog open={seedOpen} onOpenChange={setSeedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seed Budget Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Pre-populates this version with industry-standard line items at $0. Edit amounts after seeding.
            </p>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="outline" className="justify-start h-auto py-3" onClick={() => seedTemplate("standard_sov", false)} disabled={importing}>
                <div className="text-left">
                  <div className="font-medium">Standard SOV</div>
                  <div className="text-2xs text-muted-foreground">Lender-style hard + soft + contingency (~50 lines)</div>
                </div>
              </Button>
              <Button variant="outline" className="justify-start h-auto py-3" onClick={() => seedTemplate("csi", false)} disabled={importing}>
                <div className="text-left">
                  <div className="font-medium">CSI MasterFormat</div>
                  <div className="text-2xs text-muted-foreground">23 CSI divisions + soft cost stubs + contingency</div>
                </div>
              </Button>
            </div>
            {items.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-2xs text-amber-300">
                Existing lines stay. Choose a button to <em>append</em>; use Import → Replace if you want a fresh start.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import dialog ──────────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Budget</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2 text-xs">
              <button onClick={() => setImportTab("paste")} className={cn("px-3 py-1 rounded-md", importTab === "paste" ? "bg-primary/15 text-primary" : "text-muted-foreground")}>
                Paste from spreadsheet
              </button>
              <button onClick={() => setImportTab("file")} className={cn("px-3 py-1 rounded-md", importTab === "file" ? "bg-primary/15 text-primary" : "text-muted-foreground")}>
                Upload XLSX / CSV
              </button>
              <button onClick={() => setImportTab("pdf")} className={cn("px-3 py-1 rounded-md inline-flex items-center gap-1", importTab === "pdf" ? "bg-primary/15 text-primary" : "text-muted-foreground")}>
                <Sparkles className="h-3 w-3" /> PDF (AI extract)
              </button>
            </div>
            {importMessage && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-2xs text-red-300">{importMessage}</div>
            )}
            {importTab === "paste" ? (
              <>
                <p className="text-2xs text-muted-foreground">
                  Paste tab-separated data (copy from Excel). First row = headers. Required: <code>description</code>.
                  Optional: <code>cost_class</code> (hard / soft / contingency), <code>category</code>, <code>amount</code>, <code>csi_code</code>, <code>unit</code>, <code>retainage_pct</code>, <code>notes</code>.
                </p>
                <textarea
                  rows={10}
                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={`cost_class\tcategory\tdescription\tamount\nhard\tHard Cost\tFoundation\t48000\nhard\tHard Cost\tFraming\t50000`}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setImportOpen(false)}>Cancel</Button>
                  <Button size="sm" onClick={submitPaste} disabled={importing}>
                    {importing ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Importing</> : "Import"}
                  </Button>
                </div>
              </>
            ) : importTab === "file" ? (
              <>
                <p className="text-2xs text-muted-foreground">
                  Upload XLSX or CSV with the same columns as the paste mode. Headers are matched
                  case-insensitively (Description, Cost Class, Amount, etc.). Common SOV column names
                  (Original Scheduled Value, Item, Section) are also recognized.
                </p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="text-xs" />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setImportOpen(false)}>Cancel</Button>
                  <Button size="sm" onClick={submitFile} disabled={importing}>
                    {importing ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Importing</> : "Upload"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-2xs text-muted-foreground">
                  Upload the contractor's SOV PDF. Claude reads it and structures it into budget rows
                  (description, amount, hard/soft/contingency). Most contractor SOVs export as PDF —
                  this avoids manual rekeying. Slower than paste/XLSX (~10–30s).
                </p>
                <input ref={pdfRef} type="file" accept=".pdf" className="text-xs" />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setImportOpen(false)}>Cancel</Button>
                  <Button size="sm" onClick={submitPdf} disabled={importing}>
                    {importing ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Extracting</> : <><Sparkles className="h-3 w-3 mr-1" /> Extract & Import</>}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── New version dialog ──────────────────────────────────────────── */}
      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Budget Version</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Label</label>
              <input
                autoFocus
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={newVersion.label}
                onChange={(e) => setNewVersion({ ...newVersion, label: e.target.value })}
                placeholder="e.g., V2 - Post-VE"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Clone from</label>
              <select
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={newVersion.clone_from}
                onChange={(e) => setNewVersion({ ...newVersion, clone_from: e.target.value })}
              >
                <option value="">Empty (start fresh)</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={newVersion.set_active}
                onChange={(e) => setNewVersion({ ...newVersion, set_active: e.target.checked })}
              />
              Make this version active
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setVersionOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={submitNewVersion}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add line dialog ─────────────────────────────────────────────── */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Budget Line</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Class</label>
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={newItem.cost_class}
                  onChange={(e) => {
                    const cls = e.target.value as BudgetCostClass;
                    setNewItem({
                      ...newItem,
                      cost_class: cls,
                      category: cls === "hard" ? "Hard Cost" : cls === "soft" ? "Soft Cost" : "Contingency",
                    });
                  }}
                >
                  <option value="hard">Hard</option>
                  <option value="soft">Soft</option>
                  <option value="contingency">Contingency</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={newItem.category}
                  onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Unit</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={newItem.unit}
                  onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                  placeholder="optional"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Item</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={newItem.description}
                onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                placeholder="e.g., Foundation"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Original Scheduled Value ($)</label>
                <input
                  type="number"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={newItem.amount}
                  onChange={(e) => setNewItem({ ...newItem, amount: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Retainage %</label>
                <input
                  type="number"
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                  value={newItem.retainage_pct}
                  onChange={(e) => setNewItem({ ...newItem, retainage_pct: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAddItemOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={submitNewItem}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add draw dialog ─────────────────────────────────────────────── */}
      <Dialog open={addDrawOpen} onOpenChange={setAddDrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Draw Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-2xs text-muted-foreground">
              Draws appear as new columns on the budget sheet. Enter per-line approved amounts directly in the cell to bill that period.
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={newDraw.title}
                onChange={(e) => setNewDraw({ ...newDraw, title: e.target.value })}
                placeholder={`e.g., May 2026`}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Submission Date</label>
              <input
                type="date"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                value={newDraw.submitted_date}
                onChange={(e) => setNewDraw({ ...newDraw, submitted_date: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAddDrawOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={submitNewDraw}>Add Draw</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Section per cost class ──────────────────────────────────────────────────

function ClassSection({
  cls,
  rows,
  sortedDraws,
  drawAmountMap,
  computeRow,
  currentDrawId,
  editingCell,
  cellDraft,
  onStartEdit,
  onCommitItem,
  onCommitDrawItem,
  onCellDraftChange,
  onCancelEdit,
  onDelete,
}: {
  cls: BudgetCostClass;
  rows: HardCostItem[];
  sortedDraws: Draw[];
  drawAmountMap: Map<string, DrawItem>;
  computeRow: (item: HardCostItem) => { original: number; co: number; current: number; totalCompleted: number; pct: number; balance: number; retainage: number };
  currentDrawId: string | undefined;
  editingCell: string | null;
  cellDraft: string;
  onStartEdit: (key: string, value: string) => void;
  onCommitItem: (item: HardCostItem, field: "amount" | "change_order_amount" | "retainage_pct" | "category" | "description" | "unit") => void;
  onCommitDrawItem: (drawId: string, hardcostItemId: string, existing?: DrawItem) => void;
  onCellDraftChange: (v: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
}) {
  const totals = rows.reduce(
    (acc, it) => {
      const r = computeRow(it);
      acc.original += r.original;
      acc.co += r.co;
      acc.current += r.current;
      acc.totalCompleted += r.totalCompleted;
      acc.balance += r.balance;
      acc.retainage += r.retainage;
      return acc;
    },
    { original: 0, co: 0, current: 0, totalCompleted: 0, balance: 0, retainage: 0 }
  );
  return (
    <>
      <tr className="bg-muted/15 border-t-2 border-border/40">
        <td colSpan={4 + 9 + sortedDraws.length + 1} className="px-3 py-1.5 sticky left-0 bg-muted/25 z-10">
          <Badge variant="outline" className={cn("text-2xs", CLASS_TONE[cls])}>{CLASS_LABEL[cls]}</Badge>
        </td>
      </tr>
      {rows.map((item, idx) => {
        const r = computeRow(item);
        const code = String(idx + 1).padStart(2, "0") + "0000";
        const previously = sortedDraws
          .filter((d) => d.id !== currentDrawId)
          .reduce((s, d) => {
            const di = drawAmountMap.get(`${item.id}::${d.id}`);
            return s + Number(di?.amount_approved ?? di?.amount_requested ?? 0);
          }, 0);
        const thisPeriodDi = currentDrawId ? drawAmountMap.get(`${item.id}::${currentDrawId}`) : undefined;
        const thisPeriod = Number(thisPeriodDi?.amount_approved ?? thisPeriodDi?.amount_requested ?? 0);
        const editing = (key: string) => editingCell === key;
        return (
          <tr key={item.id} className="group border-t border-border/20 hover:bg-muted/10">
            <td className="px-2 py-1.5 sticky left-0 bg-card z-10 text-2xs text-muted-foreground tabular-nums">{code}</td>
            <CellEditableText
              value={item.unit || ""}
              editing={editing(`${item.id}:unit`)}
              draft={cellDraft}
              onStartEdit={() => onStartEdit(`${item.id}:unit`, item.unit || "")}
              onDraftChange={onCellDraftChange}
              onCommit={() => onCommitItem(item, "unit")}
              onCancel={onCancelEdit}
              placeholder="—"
            />
            <CellEditableText
              value={item.category || ""}
              editing={editing(`${item.id}:category`)}
              draft={cellDraft}
              onStartEdit={() => onStartEdit(`${item.id}:category`, item.category || "")}
              onDraftChange={onCellDraftChange}
              onCommit={() => onCommitItem(item, "category")}
              onCancel={onCancelEdit}
              placeholder="—"
            />
            <CellEditableText
              value={item.description || ""}
              editing={editing(`${item.id}:description`)}
              draft={cellDraft}
              onStartEdit={() => onStartEdit(`${item.id}:description`, item.description || "")}
              onDraftChange={onCellDraftChange}
              onCommit={() => onCommitItem(item, "description")}
              onCancel={onCancelEdit}
              placeholder="—"
              bold
            />
            <CellEditableNumber
              value={r.original}
              editing={editing(`${item.id}:amount`)}
              draft={cellDraft}
              onStartEdit={() => onStartEdit(`${item.id}:amount`, String(r.original || ""))}
              onDraftChange={onCellDraftChange}
              onCommit={() => onCommitItem(item, "amount")}
              onCancel={onCancelEdit}
            />
            <CellEditableNumber
              value={r.co}
              editing={editing(`${item.id}:co`)}
              draft={cellDraft}
              onStartEdit={() => onStartEdit(`${item.id}:co`, String(r.co || ""))}
              onDraftChange={onCellDraftChange}
              onCommit={() => onCommitItem(item, "change_order_amount")}
              onCancel={onCancelEdit}
            />
            <td className="px-2 py-1.5 text-right tabular-nums">{fc(r.current)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{fc(previously)}</td>
            <CellEditableNumber
              value={thisPeriod}
              editing={editing(`thispd:${item.id}`)}
              draft={cellDraft}
              onStartEdit={() => onStartEdit(`thispd:${item.id}`, String(thisPeriod || ""))}
              onDraftChange={onCellDraftChange}
              onCommit={() => currentDrawId && onCommitDrawItem(currentDrawId, item.id, thisPeriodDi)}
              onCancel={onCancelEdit}
              disabled={!currentDrawId}
            />
            <td className="px-2 py-1.5 text-right tabular-nums">{fc(r.totalCompleted)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              <span className={cn(
                r.pct >= 100 ? "text-emerald-400" : r.pct >= 50 ? "text-amber-300" : "text-muted-foreground"
              )}>
                {r.current > 0 ? `${r.pct.toFixed(0)}%` : "—"}
              </span>
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fc(r.balance)}</td>
            <CellEditableNumber
              value={Number(item.retainage_pct) || 0}
              editing={editing(`${item.id}:retain`)}
              draft={cellDraft}
              onStartEdit={() => onStartEdit(`${item.id}:retain`, String(item.retainage_pct || ""))}
              onDraftChange={onCellDraftChange}
              onCommit={() => onCommitItem(item, "retainage_pct")}
              onCancel={onCancelEdit}
              suffix="%"
              precision={1}
            />
            {sortedDraws.map((d) => {
              const di = drawAmountMap.get(`${item.id}::${d.id}`);
              const v = Number(di?.amount_approved ?? di?.amount_requested ?? 0);
              const key = `draw:${item.id}:${d.id}`;
              return (
                <CellEditableNumber
                  key={d.id}
                  value={v}
                  editing={editing(key)}
                  draft={cellDraft}
                  onStartEdit={() => onStartEdit(key, String(v || ""))}
                  onDraftChange={onCellDraftChange}
                  onCommit={() => onCommitDrawItem(d.id, item.id, di)}
                  onCancel={onCancelEdit}
                  muted={v === 0}
                />
              );
            })}
            <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fc(r.totalCompleted)}</td>
            <td className="px-1 sticky right-0 bg-card opacity-0 group-hover:opacity-100">
              <button onClick={() => onDelete(item.id)} className="text-muted-foreground hover:text-red-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </td>
          </tr>
        );
      })}
      {/* Section subtotal */}
      <tr className="bg-muted/10 border-t border-border/30 font-medium">
        <td className="sticky left-0 bg-muted/20 z-10" colSpan={4}>
          <span className="px-2 py-1 inline-block text-2xs uppercase tracking-wider text-muted-foreground">Subtotal — {CLASS_LABEL[cls]}</span>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fc(totals.original)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fc(totals.co)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fc(totals.current)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums" colSpan={3}>{fc(totals.totalCompleted)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">
          {totals.current > 0 ? `${((totals.totalCompleted / totals.current) * 100).toFixed(0)}%` : "—"}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fc(totals.balance)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fc(totals.retainage)}</td>
        {sortedDraws.map((d) => {
          let s = 0;
          for (const it of rows) {
            const di = drawAmountMap.get(`${it.id}::${d.id}`);
            s += Number(di?.amount_approved ?? di?.amount_requested ?? 0);
          }
          return <td key={d.id} className="px-2 py-1.5 text-right tabular-nums">{fc(s)}</td>;
        })}
        <td className="px-2 py-1.5 text-right tabular-nums">{fc(totals.totalCompleted)}</td>
        <td className="sticky right-0 bg-muted/20"></td>
      </tr>
    </>
  );
}

// ─── Editable cell helpers ──────────────────────────────────────────────────

function CellEditableNumber({
  value,
  editing,
  draft,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
  disabled,
  muted,
  suffix,
  precision,
}: {
  value: number;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  disabled?: boolean;
  muted?: boolean;
  suffix?: string;
  precision?: number;
}) {
  const display = suffix === "%"
    ? value === 0 ? "—" : `${value.toFixed(precision ?? 0)}%`
    : value === 0 && muted ? "—" : fc(value);
  return (
    <td className="px-2 py-1.5 text-right tabular-nums">
      {editing ? (
        <input
          autoFocus
          type="number"
          className="w-full bg-background border border-primary/50 rounded px-1 py-0.5 text-xs text-right tabular-nums focus:outline-none"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancel();
          }}
        />
      ) : (
        <button
          disabled={disabled}
          onClick={onStartEdit}
          className={cn(
            "w-full text-right hover:text-primary",
            (muted || value === 0) && "text-muted-foreground/40",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          {display}
        </button>
      )}
    </td>
  );
}

function CellEditableText({
  value,
  editing,
  draft,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
  placeholder,
  bold,
}: {
  value: string;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  placeholder?: string;
  bold?: boolean;
}) {
  return (
    <td className="px-2 py-1.5 text-left">
      {editing ? (
        <input
          autoFocus
          type="text"
          className="w-full bg-background border border-primary/50 rounded px-1 py-0.5 text-xs focus:outline-none"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
            if (e.key === "Escape") onCancel();
          }}
        />
      ) : (
        <button
          onClick={onStartEdit}
          className={cn("w-full text-left hover:text-primary truncate", bold && "font-medium", !value && "text-muted-foreground/40")}
        >
          {value || placeholder || ""}
        </button>
      )}
    </td>
  );
}
