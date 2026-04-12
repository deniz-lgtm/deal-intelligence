"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Calendar,
  GanttChart,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  TrendingUp,
  Settings as SettingsIcon,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DEV_PHASE_STATUS_CONFIG,
  PREDEV_COST_STATUS_CONFIG,
  PREDEV_CATEGORIES,
  DEFAULT_PREDEV_THRESHOLDS,
} from "@/lib/types";
import type {
  DevPhase,
  DevPhaseStatus,
  PreDevCost,
  PreDevCostStatus,
  PreDevSettings,
} from "@/lib/types";

interface Props {
  dealId: string;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function DevelopmentSchedule({ dealId }: Props) {
  const [phases, setPhases] = useState<DevPhase[]>([]);
  const [costs, setCosts] = useState<PreDevCost[]>([]);
  const [settings, setSettings] = useState<PreDevSettings>({
    total_budget: null,
    thresholds: DEFAULT_PREDEV_THRESHOLDS,
  });
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const [scheduleExpanded, setScheduleExpanded] = useState(true);
  const [budgetExpanded, setBudgetExpanded] = useState(true);

  // Phase dialog
  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [editingPhase, setEditingPhase] = useState<DevPhase | null>(null);
  const [phaseForm, setPhaseForm] = useState({
    label: "",
    duration_days: 30,
    predecessor_id: "",
    lag_days: 0,
    start_date: "",
    pct_complete: 0,
    status: "not_started" as DevPhaseStatus,
    notes: "",
  });

  // Cost dialog
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<PreDevCost | null>(null);
  const [costForm, setCostForm] = useState({
    category: PREDEV_CATEGORIES[0] as string,
    description: "",
    vendor: "",
    amount: 0,
    status: "estimated" as PreDevCostStatus,
    incurred_date: "",
    notes: "",
  });

  // Settings dialog
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<PreDevSettings>({
    total_budget: null,
    thresholds: DEFAULT_PREDEV_THRESHOLDS,
  });

  const loadAll = useCallback(async () => {
    try {
      const [phasesRes, costsRes, settingsRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/dev-schedule`),
        fetch(`/api/deals/${dealId}/predev-costs`),
        fetch(`/api/deals/${dealId}/predev-settings`),
      ]);
      const [pj, cj, sj] = await Promise.all([phasesRes.json(), costsRes.json(), settingsRes.json()]);
      setPhases(pj.data || []);
      setCosts(cj.data || []);
      if (sj.data) {
        setSettings({
          total_budget: sj.data.total_budget ?? null,
          thresholds: sj.data.thresholds || DEFAULT_PREDEV_THRESHOLDS,
        });
      }
    } catch (err) {
      console.error("Failed to load dev schedule:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Seed default phases ──
  const handleSeedPhases = async () => {
    setSeeding(true);
    try {
      await fetch(`/api/deals/${dealId}/dev-schedule/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: new Date().toISOString().split("T")[0] }),
      });
      await loadAll();
    } catch (err) {
      console.error("Failed to seed phases:", err);
    } finally {
      setSeeding(false);
    }
  };

  // ── Phase CRUD ──
  const resetPhaseForm = () => {
    setPhaseForm({ label: "", duration_days: 30, predecessor_id: "", lag_days: 0, start_date: "", pct_complete: 0, status: "not_started", notes: "" });
  };

  const openCreatePhase = () => {
    setEditingPhase(null);
    resetPhaseForm();
    setPhaseDialogOpen(true);
  };

  const openEditPhase = (p: DevPhase) => {
    setEditingPhase(p);
    setPhaseForm({
      label: p.label,
      duration_days: p.duration_days ?? 30,
      predecessor_id: p.predecessor_id || "",
      lag_days: p.lag_days ?? 0,
      start_date: p.start_date || "",
      pct_complete: p.pct_complete,
      status: p.status,
      notes: p.notes || "",
    });
    setPhaseDialogOpen(true);
  };

  const handleSavePhase = async () => {
    if (!phaseForm.label.trim()) return;
    // If phase has a predecessor, server will compute start_date — clear the manual one
    const hasPredecessor = !!phaseForm.predecessor_id;
    const payload = {
      label: phaseForm.label,
      duration_days: phaseForm.duration_days,
      predecessor_id: phaseForm.predecessor_id || null,
      lag_days: phaseForm.lag_days,
      start_date: hasPredecessor ? null : (phaseForm.start_date || null),
      pct_complete: phaseForm.pct_complete,
      status: phaseForm.status,
      notes: phaseForm.notes,
    };
    try {
      let res;
      if (editingPhase) {
        res = await fetch(`/api/deals/${dealId}/dev-schedule/${editingPhase.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/deals/${dealId}/dev-schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, sort_order: phases.length }),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to save phase");
        return;
      }
      setPhaseDialogOpen(false);
      setEditingPhase(null);
      resetPhaseForm();
      loadAll();
    } catch (err) {
      console.error("Failed to save phase:", err);
    }
  };

  const handleDeletePhase = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/dev-schedule/${id}`, { method: "DELETE" });
      loadAll();
    } catch (err) {
      console.error("Failed to delete phase:", err);
    }
  };

  // ── Cost CRUD ──
  const resetCostForm = () => {
    setCostForm({
      category: PREDEV_CATEGORIES[0] as string,
      description: "",
      vendor: "",
      amount: 0,
      status: "estimated",
      incurred_date: "",
      notes: "",
    });
  };

  const openCreateCost = () => {
    setEditingCost(null);
    resetCostForm();
    setCostDialogOpen(true);
  };

  const openEditCost = (c: PreDevCost) => {
    setEditingCost(c);
    setCostForm({
      category: c.category,
      description: c.description,
      vendor: c.vendor || "",
      amount: Number(c.amount),
      status: c.status,
      incurred_date: c.incurred_date || "",
      notes: c.notes || "",
    });
    setCostDialogOpen(true);
  };

  const handleSaveCost = async () => {
    if (!costForm.description.trim()) return;
    try {
      if (editingCost) {
        await fetch(`/api/deals/${dealId}/predev-costs/${editingCost.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(costForm),
        });
      } else {
        await fetch(`/api/deals/${dealId}/predev-costs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(costForm),
        });
      }
      setCostDialogOpen(false);
      setEditingCost(null);
      resetCostForm();
      loadAll();
    } catch (err) {
      console.error("Failed to save cost:", err);
    }
  };

  const handleDeleteCost = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/predev-costs/${id}`, { method: "DELETE" });
      loadAll();
    } catch (err) {
      console.error("Failed to delete cost:", err);
    }
  };

  // ── Settings ──
  const openSettings = () => {
    setSettingsForm(settings);
    setSettingsDialogOpen(true);
  };

  const handleSaveSettings = async () => {
    try {
      await fetch(`/api/deals/${dealId}/predev-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm),
      });
      setSettings(settingsForm);
      setSettingsDialogOpen(false);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  // ── Calculations ──
  const totalCommittedOrSpent = costs
    .filter((c) => c.status === "committed" || c.status === "incurred" || c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const totalEstimated = costs.reduce((sum, c) => sum + Number(c.amount), 0);
  const totalPaid = costs
    .filter((c) => c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount), 0);

  // Group costs by category
  const costsByCategory = costs.reduce<Record<string, PreDevCost[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  // Approval threshold logic
  const sortedThresholds = [...settings.thresholds].sort((a, b) => a.amount - b.amount);
  const nextThreshold = sortedThresholds.find((t) => t.amount > totalCommittedOrSpent);
  const passedThresholds = sortedThresholds.filter((t) => t.amount <= totalCommittedOrSpent);
  const headroomToNext = nextThreshold ? nextThreshold.amount - totalCommittedOrSpent : 0;

  // ── Timeline calculations ──
  const allDates = phases
    .flatMap((p) => [p.start_date, p.end_date])
    .filter((d): d is string => !!d)
    .sort();
  const minDate = allDates[0];
  const maxDate = allDates[allDates.length - 1];
  const timelineRangeMs = minDate && maxDate
    ? new Date(maxDate).getTime() - new Date(minDate).getTime()
    : 0;

  const getBarStyle = (start: string | null, end: string | null) => {
    if (!start || !end || !minDate || timelineRangeMs === 0) return { left: "0%", width: "0%" };
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const baseMs = new Date(minDate).getTime();
    const left = ((startMs - baseMs) / timelineRangeMs) * 100;
    const width = ((endMs - startMs) / timelineRangeMs) * 100;
    return { left: `${left}%`, width: `${Math.max(width, 1)}%` };
  };

  // ── Today marker position ──
  const todayMs = Date.now();
  const todayPct = minDate && maxDate && timelineRangeMs > 0
    ? ((todayMs - new Date(minDate).getTime()) / timelineRangeMs) * 100
    : null;
  const showToday = todayPct !== null && todayPct >= 0 && todayPct <= 100;

  // ── Critical path detection ──
  // A phase is on the critical path if it has no slack: it's either an anchor
  // or its predecessor is also critical, and it's not yet complete.
  // Simple heuristic: phases that are in_progress or delayed with successor chains.
  const criticalPhaseIds = new Set<string>();
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  // Find the longest dependency chain (critical path heuristic)
  const getChainEnd = (id: string): string | null => {
    const successors = phases.filter((p) => p.predecessor_id === id);
    if (successors.length === 0) return id;
    // Pick the successor that ends latest
    let latestEnd = "";
    let latestId = id;
    for (const s of successors) {
      const chainEnd = getChainEnd(s.id);
      const endPhase = chainEnd ? phaseById.get(chainEnd) : null;
      if (endPhase?.end_date && endPhase.end_date > latestEnd) {
        latestEnd = endPhase.end_date;
        latestId = chainEnd!;
      }
    }
    return latestId;
  };
  // Mark phases on the longest path that are not yet complete
  if (phases.length > 0) {
    // Find anchor phases (no predecessor)
    const anchors = phases.filter((p) => !p.predecessor_id);
    for (const anchor of anchors) {
      // Walk the chain
      let current: string | undefined = anchor.id;
      while (current) {
        const phase = phaseById.get(current);
        if (phase && phase.status !== "complete") {
          criticalPhaseIds.add(current);
        }
        const successors = phases.filter((p) => p.predecessor_id === current);
        // Follow the successor that ends latest (critical path)
        if (successors.length === 0) break;
        let latest = successors[0];
        for (const s of successors) {
          if ((s.end_date || "") > (latest.end_date || "")) latest = s;
        }
        current = latest.id;
      }
    }
  }

  const isDelayed = (p: DevPhase) => {
    if (p.status === "delayed") return true;
    if (p.end_date && p.status !== "complete" && new Date(p.end_date).getTime() < todayMs) return true;
    return false;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground text-sm">Loading development schedule...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Development Schedule (Phases) ── */}
      <section className="border border-border/50 rounded-lg bg-card/50">
        <button
          onClick={() => setScheduleExpanded(!scheduleExpanded)}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        >
          {scheduleExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <GanttChart className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Development Schedule</span>
          <Badge variant="secondary" className="ml-auto text-2xs">
            {phases.filter((p) => p.status === "complete").length}/{phases.length} phases
          </Badge>
        </button>

        {scheduleExpanded && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={openCreatePhase}>
                <Plus className="h-3 w-3 mr-1" /> Add Phase
              </Button>
              {phases.length === 0 && (
                <Button size="sm" variant="outline" className="text-xs" onClick={handleSeedPhases} disabled={seeding}>
                  {seeding ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Calendar className="h-3 w-3 mr-1" />}
                  Seed Default Phases
                </Button>
              )}
            </div>

            {phases.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No phases yet. Click &quot;Seed Default Phases&quot; to start with a typical CRE timeline.
              </p>
            ) : (
              <>
                {/* Timeline range header */}
                {minDate && maxDate && (
                  <div className="flex justify-between text-2xs text-muted-foreground border-b border-border/30 pb-1 relative">
                    <span>{new Date(minDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                    {showToday && (
                      <span className="absolute text-[9px] text-red-400 font-medium" style={{ left: `calc(25% + ${todayPct! * 0.583}%)`, transform: "translateX(-50%)" }}>
                        Today
                      </span>
                    )}
                    <span>{new Date(maxDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                  </div>
                )}

                {/* Legend */}
                {criticalPhaseIds.size > 0 && (
                  <div className="flex items-center gap-4 text-2xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500/60" />
                      Critical path
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500/60" />
                      Delayed
                    </span>
                  </div>
                )}

                {/* Gantt rows */}
                <div className="space-y-1.5">
                  {phases.map((p) => {
                    const cfg = DEV_PHASE_STATUS_CONFIG[p.status];
                    const barStyle = getBarStyle(p.start_date, p.end_date);
                    const predLabel = p.predecessor_id
                      ? phases.find((x) => x.id === p.predecessor_id)?.label
                      : null;
                    const isCritical = criticalPhaseIds.has(p.id);
                    const delayed = isDelayed(p);
                    return (
                      <div key={p.id} className="group">
                        <div className="grid grid-cols-12 gap-2 items-center">
                          {/* Label */}
                          <button
                            onClick={() => openEditPhase(p)}
                            className={cn(
                              "col-span-3 text-left text-xs hover:text-primary truncate flex items-center gap-1",
                              delayed && "text-red-400"
                            )}
                          >
                            {isCritical && (
                              <span title="Critical path"><AlertTriangle className="h-2.5 w-2.5 text-red-400 flex-shrink-0" /></span>
                            )}
                            {!isCritical && !p.predecessor_id && (
                              <span className="text-2xs text-amber-400" title="Anchor phase">⚓</span>
                            )}
                            <span className="truncate">{p.label}</span>
                            {p.duration_days && (
                              <span className="text-2xs text-muted-foreground flex-shrink-0">{p.duration_days}d</span>
                            )}
                          </button>
                          {/* Bar */}
                          <div className="col-span-7 relative h-5 bg-muted/30 rounded">
                            {/* Today marker */}
                            {showToday && (
                              <div
                                className="absolute top-0 h-full w-px bg-red-500/50 z-10"
                                style={{ left: `${todayPct}%` }}
                              />
                            )}
                            <div
                              className={cn(
                                "absolute top-0 h-full rounded",
                                delayed ? "bg-red-500/30 ring-1 ring-red-500/40" :
                                isCritical ? "ring-1 ring-red-500/30 " + cfg.bg :
                                cfg.bg
                              )}
                              style={barStyle}
                              title={`${p.label}: ${p.start_date || "?"} → ${p.end_date || "?"} (${p.pct_complete}%)${predLabel ? ` | After: ${predLabel}` : ""}${isCritical ? " [CRITICAL PATH]" : ""}${delayed ? " [DELAYED]" : ""}`}
                            >
                              {p.pct_complete > 0 && (
                                <div
                                  className="absolute top-0 left-0 h-full bg-emerald-500/40 rounded"
                                  style={{ width: `${p.pct_complete}%` }}
                                />
                              )}
                            </div>
                          </div>
                          {/* Status + actions */}
                          <div className="col-span-2 flex items-center justify-end gap-1">
                            <Badge variant="secondary" className={cn("text-2xs", delayed ? "text-red-400 bg-red-500/10" : cfg.color)}>
                              {p.pct_complete}%
                            </Badge>
                            <button
                              onClick={() => handleDeletePhase(p.id)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-2xs text-muted-foreground pt-1">
                  ⚓ = anchor phase (manually set start date) · linked phases auto-shift when their predecessor moves
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Pre-Development Budget Tracker ── */}
      <section className="border border-border/50 rounded-lg bg-card/50">
        <button
          onClick={() => setBudgetExpanded(!budgetExpanded)}
          className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        >
          {budgetExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Wallet className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Pre-Development Budget</span>
          <Badge variant="secondary" className="ml-auto text-2xs">
            {fc(totalCommittedOrSpent)} committed
          </Badge>
        </button>

        {budgetExpanded && (
          <div className="px-4 pb-4 space-y-4">
            {/* ── Approval Threshold Tracker ── */}
            <div className="border border-border/30 rounded-md p-3 bg-background/40">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium">Approval Status</span>
                </div>
                <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={openSettings}>
                  <SettingsIcon className="h-3 w-3 mr-1" /> Configure
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <div className="text-2xs text-muted-foreground">Committed/Spent</div>
                  <div className="text-base font-bold">{fc(totalCommittedOrSpent)}</div>
                </div>
                <div>
                  <div className="text-2xs text-muted-foreground">Total Estimated</div>
                  <div className="text-base font-bold">{fc(totalEstimated)}</div>
                </div>
                <div>
                  <div className="text-2xs text-muted-foreground">Paid</div>
                  <div className="text-base font-bold text-emerald-400">{fc(totalPaid)}</div>
                </div>
              </div>

              {/* Next threshold callout */}
              {nextThreshold ? (
                <div className={cn(
                  "rounded-md p-2 mb-2 border",
                  headroomToNext < nextThreshold.amount * 0.1
                    ? "bg-red-500/10 border-red-500/30"
                    : headroomToNext < nextThreshold.amount * 0.25
                    ? "bg-amber-500/10 border-amber-500/30"
                    : "bg-blue-500/10 border-blue-500/30"
                )}>
                  <div className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="font-medium">
                      {fc(headroomToNext)} until next approval gate:
                    </span>
                    <span className="text-muted-foreground">
                      {nextThreshold.label} ({fc(nextThreshold.amount)})
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-md p-2 mb-2 bg-emerald-500/10 border border-emerald-500/30">
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>All approval gates passed.</span>
                  </div>
                </div>
              )}

              {/* Threshold ladder */}
              <div className="space-y-1">
                {sortedThresholds.map((t) => {
                  const passed = totalCommittedOrSpent >= t.amount;
                  const pctOfThreshold = Math.min(100, (totalCommittedOrSpent / t.amount) * 100);
                  return (
                    <div key={t.amount} className="space-y-0.5">
                      <div className="flex items-center justify-between text-2xs">
                        <span className={cn("flex items-center gap-1", passed ? "text-emerald-400" : "text-muted-foreground")}>
                          {passed ? <CheckCircle2 className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />}
                          {t.label}
                        </span>
                        <span className={passed ? "text-emerald-400" : "text-muted-foreground"}>{fc(t.amount)}</span>
                      </div>
                      <Progress value={pctOfThreshold} className="h-1" />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Add Cost Button ── */}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={openCreateCost}>
                <Plus className="h-3 w-3 mr-1" /> Add Line Item
              </Button>
            </div>

            {/* ── Costs grouped by category ── */}
            {costs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No pre-development costs yet. Add line items as you commit spend.
              </p>
            ) : (
              <div className="space-y-3">
                {Object.entries(costsByCategory).map(([cat, items]) => {
                  const catTotal = items.reduce((s, c) => s + Number(c.amount), 0);
                  return (
                    <div key={cat} className="border border-border/30 rounded-md overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-b border-border/30">
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-3 w-3 text-primary" />
                          <span className="text-xs font-medium">{cat}</span>
                          <Badge variant="secondary" className="text-2xs">{items.length}</Badge>
                        </div>
                        <span className="text-xs font-bold">{fc(catTotal)}</span>
                      </div>
                      <div className="divide-y divide-border/20">
                        {items.map((c) => {
                          const cfg = PREDEV_COST_STATUS_CONFIG[c.status];
                          return (
                            <div key={c.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-muted/20">
                              <button
                                onClick={() => openEditCost(c)}
                                className="flex-1 min-w-0 text-left text-xs hover:text-primary truncate"
                              >
                                {c.description}
                                {c.vendor && <span className="text-muted-foreground"> · {c.vendor}</span>}
                              </button>
                              <Badge variant="secondary" className={cn("text-2xs flex-shrink-0", cfg.color)}>
                                {cfg.label}
                              </Badge>
                              <span className="text-xs font-medium tabular-nums w-20 text-right">{fc(Number(c.amount))}</span>
                              <button
                                onClick={() => handleDeleteCost(c.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Phase Dialog ── */}
      <Dialog open={phaseDialogOpen} onOpenChange={(open) => {
        setPhaseDialogOpen(open);
        if (!open) { setEditingPhase(null); resetPhaseForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPhase ? "Edit Phase" : "New Phase"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Phase Name</label>
              <input
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={phaseForm.label}
                onChange={(e) => setPhaseForm({ ...phaseForm, label: e.target.value })}
                placeholder="e.g., Construction"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Duration (days)</label>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={phaseForm.duration_days}
                  onChange={(e) => setPhaseForm({ ...phaseForm, duration_days: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Lag (days after predecessor)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                  value={phaseForm.lag_days}
                  disabled={!phaseForm.predecessor_id}
                  onChange={(e) => setPhaseForm({ ...phaseForm, lag_days: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Predecessor (Finish-to-Start)</label>
              <select
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={phaseForm.predecessor_id}
                onChange={(e) => setPhaseForm({ ...phaseForm, predecessor_id: e.target.value })}
              >
                <option value="">— None (anchor phase) —</option>
                {phases
                  .filter((p) => !editingPhase || p.id !== editingPhase.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
              </select>
              <p className="text-2xs text-muted-foreground mt-1">
                {phaseForm.predecessor_id
                  ? "Start date will be auto-computed from predecessor's end date + lag."
                  : "Anchor phase — set its start date manually below."}
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Start Date {phaseForm.predecessor_id && <span className="text-muted-foreground/70">(computed)</span>}
              </label>
              <input
                type="date"
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                value={phaseForm.start_date}
                disabled={!!phaseForm.predecessor_id}
                onChange={(e) => setPhaseForm({ ...phaseForm, start_date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">% Complete</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={phaseForm.pct_complete}
                  onChange={(e) => setPhaseForm({ ...phaseForm, pct_complete: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <select
                  className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={phaseForm.status}
                  onChange={(e) => setPhaseForm({ ...phaseForm, status: e.target.value as DevPhaseStatus })}
                >
                  {Object.entries(DEV_PHASE_STATUS_CONFIG).map(([k, cfg]) => (
                    <option key={k} value={k}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <textarea
                rows={2}
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                value={phaseForm.notes}
                onChange={(e) => setPhaseForm({ ...phaseForm, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => { setPhaseDialogOpen(false); setEditingPhase(null); resetPhaseForm(); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSavePhase}>{editingPhase ? "Save" : "Create"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Cost Dialog ── */}
      <Dialog open={costDialogOpen} onOpenChange={(open) => {
        setCostDialogOpen(open);
        if (!open) { setEditingCost(null); resetCostForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCost ? "Edit Line Item" : "New Pre-Dev Cost"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <select
                  className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={costForm.category}
                  onChange={(e) => setCostForm({ ...costForm, category: e.target.value })}
                >
                  {PREDEV_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <select
                  className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={costForm.status}
                  onChange={(e) => setCostForm({ ...costForm, status: e.target.value as PreDevCostStatus })}
                >
                  {Object.entries(PREDEV_COST_STATUS_CONFIG).map(([k, cfg]) => (
                    <option key={k} value={k}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <input
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={costForm.description}
                onChange={(e) => setCostForm({ ...costForm, description: e.target.value })}
                placeholder="e.g., Phase I ESA"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Vendor</label>
                <input
                  className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={costForm.vendor}
                  onChange={(e) => setCostForm({ ...costForm, vendor: e.target.value })}
                  placeholder="e.g., ABC Environmental"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Amount ($)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={costForm.amount}
                  onChange={(e) => setCostForm({ ...costForm, amount: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Incurred Date</label>
              <input
                type="date"
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={costForm.incurred_date}
                onChange={(e) => setCostForm({ ...costForm, incurred_date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <textarea
                rows={2}
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                value={costForm.notes}
                onChange={(e) => setCostForm({ ...costForm, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => { setCostDialogOpen(false); setEditingCost(null); resetCostForm(); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveCost}>{editingCost ? "Save" : "Create"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Settings Dialog ── */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approval Thresholds</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Define cumulative spend levels that require additional approvals. The tracker will warn you as you approach each gate.
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Total Pre-Dev Budget ($, optional)</label>
              <input
                type="number"
                min={0}
                className="w-full bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={settingsForm.total_budget ?? ""}
                onChange={(e) => setSettingsForm({ ...settingsForm, total_budget: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Approval Gates</label>
              <div className="space-y-2">
                {settingsForm.thresholds.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="flex-1 bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Label"
                      value={t.label}
                      onChange={(e) => {
                        const next = [...settingsForm.thresholds];
                        next[i] = { ...t, label: e.target.value };
                        setSettingsForm({ ...settingsForm, thresholds: next });
                      }}
                    />
                    <input
                      type="number"
                      className="w-32 bg-muted/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Amount"
                      value={t.amount}
                      onChange={(e) => {
                        const next = [...settingsForm.thresholds];
                        next[i] = { ...t, amount: Number(e.target.value) };
                        setSettingsForm({ ...settingsForm, thresholds: next });
                      }}
                    />
                    <button
                      onClick={() => {
                        const next = settingsForm.thresholds.filter((_, j) => j !== i);
                        setSettingsForm({ ...settingsForm, thresholds: next });
                      }}
                      className="text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs w-full"
                  onClick={() => setSettingsForm({
                    ...settingsForm,
                    thresholds: [...settingsForm.thresholds, { amount: 0, label: "New Gate" }],
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Threshold
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setSettingsDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveSettings}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
