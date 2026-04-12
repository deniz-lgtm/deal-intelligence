"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Edit2,
  FileWarning,
  Calendar,
  Clock,
  DollarSign,
  Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  CHANGE_ORDER_STATUS_CONFIG,
  HARDCOST_CATEGORIES,
} from "@/lib/types";
import type { ChangeOrder, ChangeOrderStatus } from "@/lib/types";

interface Props {
  dealId: string;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const STATUS_OPTIONS: ChangeOrderStatus[] = ["draft", "submitted", "approved", "rejected", "voided"];

const EMPTY_FORM = {
  title: "",
  description: "",
  submitted_by: "",
  cost_impact: 0,
  schedule_impact_days: 0,
  status: "draft" as ChangeOrderStatus,
  submitted_date: "",
  decided_date: "",
  hardcost_category: "",
  notes: "",
};

export default function ChangeOrderTracker({ dealId }: Props) {
  const [orders, setOrders] = useState<ChangeOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ChangeOrder | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/change-orders`);
      const json = await res.json();
      setOrders(json.data || []);
    } catch (err) {
      console.error("Failed to load change orders:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // ── Form helpers ──

  const resetForm = () => setForm({ ...EMPTY_FORM });

  const openCreate = () => {
    setEditingOrder(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (co: ChangeOrder) => {
    setEditingOrder(co);
    setForm({
      title: co.title,
      description: co.description || "",
      submitted_by: co.submitted_by || "",
      cost_impact: Number(co.cost_impact),
      schedule_impact_days: Number(co.schedule_impact_days),
      status: co.status,
      submitted_date: co.submitted_date || "",
      decided_date: co.decided_date || "",
      hardcost_category: co.hardcost_category || "",
      notes: co.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description,
        submitted_by: form.submitted_by || null,
        cost_impact: form.cost_impact,
        schedule_impact_days: form.schedule_impact_days,
        status: form.status,
        submitted_date: form.submitted_date || null,
        decided_date: form.decided_date || null,
        hardcost_category: form.hardcost_category || null,
        notes: form.notes || null,
      };

      if (editingOrder) {
        await fetch(`/api/deals/${dealId}/change-orders/${editingOrder.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`/api/deals/${dealId}/change-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setDialogOpen(false);
      setEditingOrder(null);
      resetForm();
      loadOrders();
    } catch (err) {
      console.error("Failed to save change order:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/change-orders/${id}`, { method: "DELETE" });
      setDeleteConfirmId(null);
      loadOrders();
    } catch (err) {
      console.error("Failed to delete change order:", err);
    }
  };

  // ── Calculations ──

  const totalCOs = orders.length;
  const approvedCostImpact = orders
    .filter((co) => co.status === "approved")
    .reduce((sum, co) => sum + Number(co.cost_impact), 0);
  const pendingCostImpact = orders
    .filter((co) => co.status === "draft" || co.status === "submitted")
    .reduce((sum, co) => sum + Number(co.cost_impact), 0);
  const totalScheduleImpact = orders
    .filter((co) => co.status === "approved")
    .reduce((sum, co) => sum + Number(co.schedule_impact_days), 0);

  const formatCostImpact = (n: number) => {
    const num = Number(n);
    if (num > 0) return { text: `+${fc(num)}`, className: "text-red-400" };
    if (num < 0) return { text: fc(num), className: "text-emerald-400" };
    return { text: fc(0), className: "text-muted-foreground" };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground text-sm">Loading change orders...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Strip ── */}
      <section className="border border-border/50 rounded-lg bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Change Order Summary</span>
          </div>
          <Button size="sm" variant="default" className="h-7 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Change Order
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <div className="text-2xs text-muted-foreground">Total COs</div>
            <div className="text-base font-bold">{totalCOs}</div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground">Approved Cost Impact</div>
            <div className={cn("text-base font-bold", approvedCostImpact > 0 ? "text-red-400" : approvedCostImpact < 0 ? "text-emerald-400" : "")}>
              {fc(approvedCostImpact)}
            </div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground">Pending Cost Impact</div>
            <div className={cn("text-base font-bold", pendingCostImpact > 0 ? "text-amber-400" : pendingCostImpact < 0 ? "text-emerald-400" : "")}>
              {fc(pendingCostImpact)}
            </div>
          </div>
          <div>
            <div className="text-2xs text-muted-foreground">Schedule Impact</div>
            <div className="text-base font-bold">
              {totalScheduleImpact} {totalScheduleImpact === 1 ? "day" : "days"}
            </div>
          </div>
        </div>
      </section>

      {/* ── Table ── */}
      {orders.length === 0 ? (
        <div className="border border-border/50 rounded-lg bg-card/50 p-8 text-center">
          <FileWarning className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No change orders yet.</p>
          <p className="text-2xs text-muted-foreground/60 mt-1">Click &quot;New Change Order&quot; to add one.</p>
        </div>
      ) : (
        <section className="border border-border/50 rounded-lg bg-card/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-card/80">
                  <th className="text-left text-2xs font-medium text-muted-foreground px-3 py-2 w-16">
                    <Hash className="h-3 w-3 inline mr-1" />CO #
                  </th>
                  <th className="text-left text-2xs font-medium text-muted-foreground px-3 py-2">Title</th>
                  <th className="text-left text-2xs font-medium text-muted-foreground px-3 py-2">Submitted By</th>
                  <th className="text-right text-2xs font-medium text-muted-foreground px-3 py-2">
                    <DollarSign className="h-3 w-3 inline mr-1" />Cost Impact
                  </th>
                  <th className="text-right text-2xs font-medium text-muted-foreground px-3 py-2">
                    <Clock className="h-3 w-3 inline mr-1" />Days
                  </th>
                  <th className="text-center text-2xs font-medium text-muted-foreground px-3 py-2">Status</th>
                  <th className="text-left text-2xs font-medium text-muted-foreground px-3 py-2">
                    <Calendar className="h-3 w-3 inline mr-1" />Submitted
                  </th>
                  <th className="text-left text-2xs font-medium text-muted-foreground px-3 py-2">
                    <Calendar className="h-3 w-3 inline mr-1" />Decided
                  </th>
                  <th className="text-right text-2xs font-medium text-muted-foreground px-3 py-2 w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((co) => {
                  const impact = formatCostImpact(Number(co.cost_impact));
                  const statusCfg = CHANGE_ORDER_STATUS_CONFIG[co.status];
                  return (
                    <tr key={co.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{co.co_number}</td>
                      <td className="px-3 py-2 text-xs font-medium">{co.title}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{co.submitted_by || "—"}</td>
                      <td className={cn("px-3 py-2 text-xs font-medium text-right tabular-nums", impact.className)}>
                        {impact.text}
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">
                        {Number(co.schedule_impact_days) || 0}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={cn("text-2xs px-2 py-0.5 rounded-full font-medium", statusCfg.color)}>
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-2xs text-muted-foreground">
                        {co.submitted_date || "—"}
                      </td>
                      <td className="px-3 py-2 text-2xs text-muted-foreground">
                        {co.decided_date || "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(co)}
                            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          {deleteConfirmId === co.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(co.id)}
                                className="text-2xs text-red-400 hover:text-red-300 font-medium"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="text-2xs text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(co.id)}
                              className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Create/Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingOrder ? "Edit Change Order" : "New Change Order"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="CO title"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
              <textarea
                className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary min-h-[60px]"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe the change..."
              />
            </div>

            {/* Submitted By */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Submitted By</label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.submitted_by}
                onChange={(e) => setForm((f) => ({ ...f, submitted_by: e.target.value }))}
                placeholder="Name or company"
              />
            </div>

            {/* Cost Impact + Schedule Impact */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Cost Impact ($)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.cost_impact}
                  onChange={(e) => setForm((f) => ({ ...f, cost_impact: Number(e.target.value) }))}
                  placeholder="Positive = cost, negative = credit"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Schedule Impact (days)</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.schedule_impact_days}
                  onChange={(e) => setForm((f) => ({ ...f, schedule_impact_days: Number(e.target.value) }))}
                  placeholder="Days added"
                />
              </div>
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
              <select
                className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ChangeOrderStatus }))}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {CHANGE_ORDER_STATUS_CONFIG[s].label}
                  </option>
                ))}
              </select>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Submitted Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.submitted_date}
                  onChange={(e) => setForm((f) => ({ ...f, submitted_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Decided Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={form.decided_date}
                  onChange={(e) => setForm((f) => ({ ...f, decided_date: e.target.value }))}
                />
              </div>
            </div>

            {/* Hardcost Category */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Hard Cost Category (optional)</label>
              <select
                className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.hardcost_category}
                onChange={(e) => setForm((f) => ({ ...f, hardcost_category: e.target.value }))}
              >
                <option value="">— None —</option>
                {HARDCOST_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <textarea
                className="w-full px-3 py-2 rounded-md border border-border/50 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary min-h-[48px]"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Additional notes..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!form.title.trim()}>
              {editingOrder ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
