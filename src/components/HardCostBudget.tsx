"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Wallet,
  Settings as SettingsIcon,
  Loader2,
  Edit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  HARDCOST_STATUS_CONFIG,
  HARDCOST_CATEGORIES,
  DEFAULT_HARDCOST_THRESHOLDS,
} from "@/lib/types";
import type {
  HardCostItem,
  HardCostStatus,
  HardCostSettings,
} from "@/lib/types";

interface Props {
  dealId: string;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const STATUS_ORDER: HardCostStatus[] = ["estimated", "committed", "incurred", "paid"];

export default function HardCostBudget({ dealId }: Props) {
  const [items, setItems] = useState<HardCostItem[]>([]);
  const [settings, setSettings] = useState<HardCostSettings>({
    total_budget: null,
    thresholds: DEFAULT_HARDCOST_THRESHOLDS,
  });
  const [loading, setLoading] = useState(true);

  // Item dialog
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<HardCostItem | null>(null);
  const [itemForm, setItemForm] = useState({
    category: HARDCOST_CATEGORIES[0] as string,
    description: "",
    vendor: "",
    amount: 0,
    status: "estimated" as HardCostStatus,
    incurred_date: "",
    notes: "",
  });

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Settings dialog
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<HardCostSettings>({
    total_budget: null,
    thresholds: DEFAULT_HARDCOST_THRESHOLDS,
  });

  const loadAll = useCallback(async () => {
    try {
      const [itemsRes, settingsRes] = await Promise.all([
        fetch(`/api/deals/${dealId}/hardcost-items`),
        fetch(`/api/deals/${dealId}/hardcost-settings`),
      ]);
      const [ij, sj] = await Promise.all([itemsRes.json(), settingsRes.json()]);
      setItems(ij.data || []);
      if (sj.data) {
        setSettings({
          total_budget: sj.data.total_budget ?? null,
          thresholds: sj.data.thresholds || DEFAULT_HARDCOST_THRESHOLDS,
        });
      }
    } catch (err) {
      console.error("Failed to load hard cost budget:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Item CRUD ──
  const resetItemForm = () => {
    setItemForm({
      category: HARDCOST_CATEGORIES[0] as string,
      description: "",
      vendor: "",
      amount: 0,
      status: "estimated",
      incurred_date: "",
      notes: "",
    });
  };

  const openCreateItem = () => {
    setEditingItem(null);
    resetItemForm();
    setItemDialogOpen(true);
  };

  const openEditItem = (item: HardCostItem) => {
    setEditingItem(item);
    setItemForm({
      category: item.category,
      description: item.description,
      vendor: item.vendor || "",
      amount: Number(item.amount),
      status: item.status,
      incurred_date: item.incurred_date || "",
      notes: item.notes || "",
    });
    setItemDialogOpen(true);
  };

  const handleSaveItem = async () => {
    if (!itemForm.description.trim()) return;
    try {
      if (editingItem) {
        await fetch(`/api/deals/${dealId}/hardcost-items/${editingItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(itemForm),
        });
      } else {
        await fetch(`/api/deals/${dealId}/hardcost-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(itemForm),
        });
      }
      setItemDialogOpen(false);
      setEditingItem(null);
      resetItemForm();
      loadAll();
    } catch (err) {
      console.error("Failed to save item:", err);
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/hardcost-items/${id}`, { method: "DELETE" });
      setDeleteConfirmId(null);
      loadAll();
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  const handleCycleStatus = async (item: HardCostItem) => {
    const idx = STATUS_ORDER.indexOf(item.status);
    const nextStatus = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    try {
      await fetch(`/api/deals/${dealId}/hardcost-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      loadAll();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  // ── Settings ──
  const openSettings = () => {
    setSettingsForm(settings);
    setSettingsDialogOpen(true);
  };

  const handleSaveSettings = async () => {
    try {
      await fetch(`/api/deals/${dealId}/hardcost-settings`, {
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
  const totalEstimated = items.reduce((sum, c) => sum + Number(c.amount), 0);
  const totalCommittedOrSpent = items
    .filter((c) => c.status === "committed" || c.status === "incurred" || c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const totalIncurred = items
    .filter((c) => c.status === "incurred" || c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount), 0);
  const totalPaid = items
    .filter((c) => c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount), 0);

  // Group items by category
  const itemsByCategory = items.reduce<Record<string, HardCostItem[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  // Contingency tracking
  const contingencyItems = items.filter((c) => c.category === "Contingency");
  const contingencyTotal = contingencyItems.reduce((sum, c) => sum + Number(c.amount), 0);
  const contingencyConsumed = contingencyItems
    .filter((c) => c.status === "committed" || c.status === "incurred" || c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount), 0);

  // Budget progress
  const budgetTotal = settings.total_budget ?? totalEstimated;
  const budgetPct = budgetTotal > 0 ? Math.min(100, (totalCommittedOrSpent / budgetTotal) * 100) : 0;

  // Approval threshold logic
  const sortedThresholds = [...settings.thresholds].sort((a, b) => a.amount - b.amount);
  const nextThreshold = sortedThresholds.find((t) => t.amount > totalCommittedOrSpent);
  const headroomToNext = nextThreshold ? nextThreshold.amount - totalCommittedOrSpent : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground text-sm">Loading hard cost budget...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Section ── */}
      <section className="border border-border/50 rounded-lg bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Budget Summary</span>
          </div>
          <Button size="sm" variant="ghost" className="h-6 text-2xs" onClick={openSettings}>
            <SettingsIcon className="h-3 w-3 mr-1" /> Configure
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-3">
          <div>
            <div className="text-2xs text-muted-foreground">Total Budget</div>
            <div className="text-base font-bold">{fc(budgetTotal)}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground">Committed</div>
            <div className="text-base font-bold text-blue-400">{fc(totalCommittedOrSpent)}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground">Incurred</div>
            <div className="text-base font-bold text-amber-400">{fc(totalIncurred)}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground">Paid</div>
            <div className="text-base font-bold text-emerald-400">{fc(totalPaid)}</div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-2xs text-muted-foreground">
            <span>Budget Utilization</span>
            <span>{budgetPct.toFixed(0)}%</span>
          </div>
          <Progress value={budgetPct} className="h-2" />
        </div>
      </section>

      {/* ── Contingency Callout ── */}
      {contingencyItems.length > 0 && (
        <section className="border border-border/50 rounded-lg bg-card/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="font-medium text-sm">Contingency</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div>
              <div className="text-2xs text-muted-foreground">Total Contingency</div>
              <div className="text-base font-bold">{fc(contingencyTotal)}</div>
            </div>
            <div>
              <div className="text-2xs text-muted-foreground">Consumed</div>
              <div className="text-base font-bold text-amber-400">{fc(contingencyConsumed)}</div>
            </div>
            <div>
              <div className="text-2xs text-muted-foreground">Remaining</div>
              <div className="text-base font-bold text-emerald-400">{fc(contingencyTotal - contingencyConsumed)}</div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-2xs text-muted-foreground">
              <span>Contingency Used</span>
              <span>{contingencyTotal > 0 ? ((contingencyConsumed / contingencyTotal) * 100).toFixed(0) : 0}%</span>
            </div>
            <Progress
              value={contingencyTotal > 0 ? Math.min(100, (contingencyConsumed / contingencyTotal) * 100) : 0}
              className="h-1.5"
            />
          </div>
        </section>
      )}

      {/* ── Approval Threshold Tracker ── */}
      <section className="border border-border/50 rounded-lg bg-card/50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Approval Status</span>
        </div>

        {/* Next threshold callout */}
        {nextThreshold ? (
          <div className={cn(
            "rounded-md p-2 mb-3 border",
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
          <div className="rounded-md p-2 mb-3 bg-emerald-500/10 border border-emerald-500/30">
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
      </section>

      {/* ── Line Items by Category ── */}
      <section className="border border-border/50 rounded-lg bg-card/50">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Line Items</span>
            <Badge variant="secondary" className="text-2xs">
              {items.length} items
            </Badge>
          </div>
          <Button size="sm" variant="outline" className="text-xs" onClick={openCreateItem}>
            <Plus className="h-3 w-3 mr-1" /> Add Line Item
          </Button>
        </div>

        <div className="px-4 pb-4 pt-3 space-y-3">
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No hard cost items yet. Add line items to track construction spend by category.
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(itemsByCategory).map(([cat, catItems]) => {
                const catTotal = catItems.reduce((s, c) => s + Number(c.amount), 0);
                return (
                  <div key={cat} className="border border-border/30 rounded-md overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-b border-border/30">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-3 w-3 text-primary" />
                        <span className="text-xs font-medium">{cat}</span>
                        <Badge variant="secondary" className="text-2xs">{catItems.length}</Badge>
                      </div>
                      <span className="text-xs font-bold">{fc(catTotal)}</span>
                    </div>
                    <div className="divide-y divide-border/20">
                      {catItems.map((c) => {
                        const cfg = HARDCOST_STATUS_CONFIG[c.status];
                        return (
                          <div key={c.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-muted/20">
                            <button
                              onClick={() => openEditItem(c)}
                              className="flex-1 min-w-0 text-left text-xs hover:text-primary truncate"
                            >
                              {c.description}
                              {c.vendor && <span className="text-muted-foreground"> &middot; {c.vendor}</span>}
                              {c.incurred_date && (
                                <span className="text-muted-foreground text-2xs ml-1">
                                  ({new Date(c.incurred_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })})
                                </span>
                              )}
                            </button>
                            <button
                              onClick={() => handleCycleStatus(c)}
                              title={`Click to advance status: ${c.status}`}
                            >
                              <Badge variant="secondary" className={cn("text-2xs flex-shrink-0 cursor-pointer hover:opacity-80", cfg.color)}>
                                {cfg.label}
                              </Badge>
                            </button>
                            <span className="text-xs font-medium tabular-nums w-24 text-right">{fc(Number(c.amount))}</span>
                            <button
                              onClick={() => openEditItem(c)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                            {deleteConfirmId === c.id ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-5 text-2xs px-1.5"
                                  onClick={() => handleDeleteItem(c.id)}
                                >
                                  Confirm
                                </Button>
                                <button
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="text-muted-foreground hover:text-foreground text-2xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmId(c.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
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
      </section>

      {/* ── Item Dialog ── */}
      <Dialog open={itemDialogOpen} onOpenChange={(open) => {
        setItemDialogOpen(open);
        if (!open) { setEditingItem(null); resetItemForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Line Item" : "New Hard Cost Item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={itemForm.category}
                  onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                >
                  {HARDCOST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <select
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={itemForm.status}
                  onChange={(e) => setItemForm({ ...itemForm, status: e.target.value as HardCostStatus })}
                >
                  {Object.entries(HARDCOST_STATUS_CONFIG).map(([k, cfg]) => (
                    <option key={k} value={k}>{cfg.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={itemForm.description}
                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                placeholder="e.g., Steel framing package"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Vendor</label>
                <input
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={itemForm.vendor}
                  onChange={(e) => setItemForm({ ...itemForm, vendor: e.target.value })}
                  placeholder="e.g., Turner Construction"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Amount ($)</label>
                <input
                  type="number"
                  min={0}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={itemForm.amount}
                  onChange={(e) => setItemForm({ ...itemForm, amount: Number(e.target.value) })}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Incurred Date</label>
              <input
                type="date"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={itemForm.incurred_date}
                onChange={(e) => setItemForm({ ...itemForm, incurred_date: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <textarea
                rows={2}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                value={itemForm.notes}
                onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => { setItemDialogOpen(false); setEditingItem(null); resetItemForm(); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveItem}>{editingItem ? "Save" : "Create"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Settings Dialog ── */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hard Cost Budget Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Define cumulative spend levels that require additional approvals. The tracker will warn you as you approach each gate.
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Total Hard Cost Budget ($, optional)</label>
              <input
                type="number"
                min={0}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
                      className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
                      className="w-32 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
