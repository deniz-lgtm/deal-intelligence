"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Wallet,
  ChevronDown,
  ChevronRight,
  Loader2,
  Edit2,
  DollarSign,
  Calendar,
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
import { DRAW_STATUS_CONFIG } from "@/lib/types";
import type { Draw, DrawItem, DrawStatus } from "@/lib/types";

interface Props {
  dealId: string;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const DRAW_STATUSES: DrawStatus[] = [
  "draft",
  "submitted",
  "approved",
  "funded",
  "rejected",
];

// ─── Draw Form ───────────────────────────────────────────────────────────────

interface DrawFormState {
  title: string;
  status: DrawStatus;
  amount_requested: number;
  amount_approved: number;
  retainage_held: number;
  pct_complete_claimed: number;
  submitted_date: string;
  approved_date: string;
  funded_date: string;
  notes: string;
}

const emptyDrawForm: DrawFormState = {
  title: "",
  status: "draft",
  amount_requested: 0,
  amount_approved: 0,
  retainage_held: 0,
  pct_complete_claimed: 0,
  submitted_date: "",
  approved_date: "",
  funded_date: "",
  notes: "",
};

// ─── Item Form ───────────────────────────────────────────────────────────────

interface ItemFormState {
  description: string;
  amount_requested: number;
  amount_approved: number;
}

const emptyItemForm: ItemFormState = {
  description: "",
  amount_requested: 0,
  amount_approved: 0,
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function DrawSchedule({ dealId }: Props) {
  const [draws, setDraws] = useState<Draw[]>([]);
  const [loading, setLoading] = useState(true);

  // Expanded draws & their line items
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [itemsByDraw, setItemsByDraw] = useState<Record<string, DrawItem[]>>({});
  const [itemsLoading, setItemsLoading] = useState<Set<string>>(new Set());

  // Draw dialog
  const [drawDialogOpen, setDrawDialogOpen] = useState(false);
  const [editingDraw, setEditingDraw] = useState<Draw | null>(null);
  const [drawForm, setDrawForm] = useState<DrawFormState>(emptyDrawForm);

  // Item dialog
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DrawItem | null>(null);
  const [itemParentDrawId, setItemParentDrawId] = useState<string>("");
  const [itemForm, setItemForm] = useState<ItemFormState>(emptyItemForm);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "draw" | "item";
    id: string;
    drawId?: string;
    label: string;
  } | null>(null);

  // ── Data fetching ──

  const loadDraws = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/draws`);
      const json = await res.json();
      setDraws(
        ((json.data || []) as Draw[]).sort(
          (a, b) => a.draw_number - b.draw_number
        )
      );
    } catch (err) {
      console.error("Failed to load draws:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadDraws();
  }, [loadDraws]);

  const loadItems = useCallback(
    async (drawId: string) => {
      setItemsLoading((prev) => new Set(prev).add(drawId));
      try {
        const res = await fetch(
          `/api/deals/${dealId}/draws/${drawId}/items`
        );
        const json = await res.json();
        setItemsByDraw((prev) => ({
          ...prev,
          [drawId]: ((json.data || []) as DrawItem[]).sort(
            (a, b) => a.sort_order - b.sort_order
          ),
        }));
      } catch (err) {
        console.error("Failed to load draw items:", err);
      } finally {
        setItemsLoading((prev) => {
          const next = new Set(prev);
          next.delete(drawId);
          return next;
        });
      }
    },
    [dealId]
  );

  // ── Expand / collapse ──

  const toggleExpand = (drawId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(drawId)) {
        next.delete(drawId);
      } else {
        next.add(drawId);
        if (!itemsByDraw[drawId]) loadItems(drawId);
      }
      return next;
    });
  };

  // ── Draw CRUD ──

  const handleNewDraw = async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/draws`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Draw", status: "draft" }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to create draw");
        return;
      }
      await loadDraws();
    } catch (err) {
      console.error("Failed to create draw:", err);
    }
  };

  const openEditDraw = (d: Draw) => {
    setEditingDraw(d);
    setDrawForm({
      title: d.title,
      status: d.status,
      amount_requested: Number(d.amount_requested),
      amount_approved: Number(d.amount_approved ?? 0),
      retainage_held: Number(d.retainage_held),
      pct_complete_claimed: Number(d.pct_complete_claimed),
      submitted_date: d.submitted_date || "",
      approved_date: d.approved_date || "",
      funded_date: d.funded_date || "",
      notes: d.notes || "",
    });
    setDrawDialogOpen(true);
  };

  const handleSaveDraw = async () => {
    if (!editingDraw) return;
    try {
      const res = await fetch(
        `/api/deals/${dealId}/draws/${editingDraw.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: drawForm.title,
            status: drawForm.status,
            amount_requested: drawForm.amount_requested,
            amount_approved: drawForm.amount_approved || null,
            retainage_held: drawForm.retainage_held,
            pct_complete_claimed: drawForm.pct_complete_claimed,
            submitted_date: drawForm.submitted_date || null,
            approved_date: drawForm.approved_date || null,
            funded_date: drawForm.funded_date || null,
            notes: drawForm.notes || null,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to update draw");
        return;
      }
      setDrawDialogOpen(false);
      setEditingDraw(null);
      setDrawForm(emptyDrawForm);
      await loadDraws();
    } catch (err) {
      console.error("Failed to save draw:", err);
    }
  };

  const handleDeleteDraw = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/draws/${id}`, { method: "DELETE" });
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadDraws();
    } catch (err) {
      console.error("Failed to delete draw:", err);
    }
  };

  // ── Item CRUD ──

  const openCreateItem = (drawId: string) => {
    setEditingItem(null);
    setItemParentDrawId(drawId);
    setItemForm(emptyItemForm);
    setItemDialogOpen(true);
  };

  const openEditItem = (item: DrawItem, drawId: string) => {
    setEditingItem(item);
    setItemParentDrawId(drawId);
    setItemForm({
      description: item.description,
      amount_requested: Number(item.amount_requested),
      amount_approved: Number(item.amount_approved ?? 0),
    });
    setItemDialogOpen(true);
  };

  const handleSaveItem = async () => {
    if (!itemForm.description.trim()) return;
    try {
      if (editingItem) {
        const res = await fetch(
          `/api/deals/${dealId}/draws/${itemParentDrawId}/items/${editingItem.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: itemForm.description,
              amount_requested: itemForm.amount_requested,
              amount_approved: itemForm.amount_approved || null,
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || "Failed to update item");
          return;
        }
      } else {
        const existingItems = itemsByDraw[itemParentDrawId] || [];
        const res = await fetch(
          `/api/deals/${dealId}/draws/${itemParentDrawId}/items`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: itemForm.description,
              amount_requested: itemForm.amount_requested,
              amount_approved: itemForm.amount_approved || null,
              sort_order: existingItems.length,
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || "Failed to create item");
          return;
        }
      }
      setItemDialogOpen(false);
      setEditingItem(null);
      setItemForm(emptyItemForm);
      await loadItems(itemParentDrawId);
    } catch (err) {
      console.error("Failed to save item:", err);
    }
  };

  const handleDeleteItem = async (drawId: string, itemId: string) => {
    try {
      await fetch(
        `/api/deals/${dealId}/draws/${drawId}/items/${itemId}`,
        { method: "DELETE" }
      );
      await loadItems(drawId);
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  // ── Confirm delete handler ──

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "draw") {
      await handleDeleteDraw(deleteTarget.id);
    } else if (deleteTarget.drawId) {
      await handleDeleteItem(deleteTarget.drawId, deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  // ── Summary calculations ──

  const totalFunded = draws
    .filter((d) => d.status === "funded")
    .reduce((sum, d) => sum + Number(d.amount_approved ?? d.amount_requested), 0);
  const totalRetainage = draws.reduce(
    (sum, d) => sum + Number(d.retainage_held),
    0
  );

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading draw schedule...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Bar ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-border/40 rounded-lg bg-card/50 p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Wallet className="h-3.5 w-3.5" />
            Total Draws
          </div>
          <div className="text-lg font-semibold">{draws.length}</div>
        </div>
        <div className="border border-border/40 rounded-lg bg-card/50 p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <DollarSign className="h-3.5 w-3.5" />
            Total Funded
          </div>
          <div className="text-lg font-semibold">{fc(totalFunded)}</div>
        </div>
        <div className="border border-border/40 rounded-lg bg-card/50 p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <DollarSign className="h-3.5 w-3.5" />
            Retainage Held
          </div>
          <div className="text-lg font-semibold">{fc(totalRetainage)}</div>
        </div>
        <div className="border border-border/40 rounded-lg bg-card/50 p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Calendar className="h-3.5 w-3.5" />
            Latest Draw
          </div>
          <div className="text-lg font-semibold">
            {draws.length > 0 ? `#${draws[draws.length - 1].draw_number}` : "—"}
          </div>
        </div>
      </div>

      {/* ── New Draw Button ── */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="text-xs" onClick={handleNewDraw}>
          <Plus className="h-3 w-3 mr-1" /> New Draw
        </Button>
      </div>

      {/* ── Draw Cards ── */}
      {draws.length === 0 ? (
        <div className="border border-border/40 rounded-lg bg-card/50 p-8 text-center">
          <Wallet className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">
            No draw requests yet. Click &quot;New Draw&quot; to create the first
            one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {draws.map((draw) => {
            const cfg = DRAW_STATUS_CONFIG[draw.status];
            const isExpanded = expandedIds.has(draw.id);
            const items = itemsByDraw[draw.id] || [];
            const isLoadingItems = itemsLoading.has(draw.id);

            return (
              <div
                key={draw.id}
                className="border border-border/40 rounded-lg bg-card/50 overflow-hidden"
              >
                {/* Card header */}
                <div className="flex items-center gap-3 px-4 py-3 group">
                  <button
                    onClick={() => toggleExpand(draw.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        #{draw.draw_number}
                      </span>
                      <span className="text-sm font-medium truncate">
                        {draw.title}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn("text-2xs", cfg.color)}
                      >
                        {cfg.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span>
                        Requested: {fc(Number(draw.amount_requested))}
                      </span>
                      {draw.amount_approved != null && (
                        <span>
                          Approved: {fc(Number(draw.amount_approved))}
                        </span>
                      )}
                      {draw.pct_complete_claimed > 0 && (
                        <span>{draw.pct_complete_claimed}% complete</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-0.5 text-2xs text-muted-foreground/70">
                      {draw.submitted_date && (
                        <span>Submitted: {draw.submitted_date}</span>
                      )}
                      {draw.approved_date && (
                        <span>Approved: {draw.approved_date}</span>
                      )}
                      {draw.funded_date && (
                        <span>Funded: {draw.funded_date}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditDraw(draw)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all p-1"
                      title="Edit draw"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        setDeleteTarget({
                          type: "draw",
                          id: draw.id,
                          label: `Draw #${draw.draw_number}: ${draw.title}`,
                        })
                      }
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all p-1"
                      title="Delete draw"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded line items */}
                {isExpanded && (
                  <div className="border-t border-border/30 px-4 py-3 bg-background/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Line Items
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-2xs"
                        onClick={() => openCreateItem(draw.id)}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add Item
                      </Button>
                    </div>

                    {isLoadingItems ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : items.length === 0 ? (
                      <p className="text-2xs text-muted-foreground py-3 text-center">
                        No line items. Click &quot;Add Item&quot; to add one.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {/* Header */}
                        <div className="grid grid-cols-12 gap-2 text-2xs text-muted-foreground/60 px-1">
                          <span className="col-span-6">Description</span>
                          <span className="col-span-2 text-right">
                            Requested
                          </span>
                          <span className="col-span-2 text-right">
                            Approved
                          </span>
                          <span className="col-span-2" />
                        </div>
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="grid grid-cols-12 gap-2 items-center text-xs px-1 py-1 rounded hover:bg-muted/20 group/item"
                          >
                            <span className="col-span-6 truncate">
                              {item.description}
                            </span>
                            <span className="col-span-2 text-right text-muted-foreground">
                              {fc(Number(item.amount_requested))}
                            </span>
                            <span className="col-span-2 text-right text-muted-foreground">
                              {item.amount_approved != null
                                ? fc(Number(item.amount_approved))
                                : "—"}
                            </span>
                            <div className="col-span-2 flex items-center justify-end gap-1">
                              <button
                                onClick={() => openEditItem(item, draw.id)}
                                className="opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-primary transition-all"
                                title="Edit item"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() =>
                                  setDeleteTarget({
                                    type: "item",
                                    id: item.id,
                                    drawId: draw.id,
                                    label: item.description,
                                  })
                                }
                                className="opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-red-400 transition-all"
                                title="Delete item"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                        {/* Totals row */}
                        <div className="grid grid-cols-12 gap-2 text-xs font-medium px-1 pt-1 border-t border-border/30">
                          <span className="col-span-6">Total</span>
                          <span className="col-span-2 text-right">
                            {fc(
                              items.reduce(
                                (s, i) => s + Number(i.amount_requested),
                                0
                              )
                            )}
                          </span>
                          <span className="col-span-2 text-right">
                            {fc(
                              items.reduce(
                                (s, i) =>
                                  s + Number(i.amount_approved ?? 0),
                                0
                              )
                            )}
                          </span>
                          <span className="col-span-2" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Edit Draw Dialog ── */}
      <Dialog open={drawDialogOpen} onOpenChange={setDrawDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingDraw
                ? `Edit Draw #${editingDraw.draw_number}`
                : "New Draw"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Title
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={drawForm.title}
                onChange={(e) =>
                  setDrawForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Status
                </label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={drawForm.status}
                  onChange={(e) =>
                    setDrawForm((f) => ({
                      ...f,
                      status: e.target.value as DrawStatus,
                    }))
                  }
                >
                  {DRAW_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {DRAW_STATUS_CONFIG[s].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  % Complete Claimed
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={drawForm.pct_complete_claimed}
                  onChange={(e) =>
                    setDrawForm((f) => ({
                      ...f,
                      pct_complete_claimed: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Amount Requested
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={drawForm.amount_requested}
                  onChange={(e) =>
                    setDrawForm((f) => ({
                      ...f,
                      amount_requested: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Amount Approved
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={drawForm.amount_approved}
                  onChange={(e) =>
                    setDrawForm((f) => ({
                      ...f,
                      amount_approved: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Retainage Held
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={drawForm.retainage_held}
                  onChange={(e) =>
                    setDrawForm((f) => ({
                      ...f,
                      retainage_held: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Submitted Date
                </label>
                <input
                  type="date"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={drawForm.submitted_date}
                  onChange={(e) =>
                    setDrawForm((f) => ({
                      ...f,
                      submitted_date: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Approved Date
                </label>
                <input
                  type="date"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={drawForm.approved_date}
                  onChange={(e) =>
                    setDrawForm((f) => ({
                      ...f,
                      approved_date: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Funded Date
                </label>
                <input
                  type="date"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={drawForm.funded_date}
                  onChange={(e) =>
                    setDrawForm((f) => ({
                      ...f,
                      funded_date: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Notes
              </label>
              <textarea
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm resize-none"
                value={drawForm.notes}
                onChange={(e) =>
                  setDrawForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDrawDialogOpen(false);
                setEditingDraw(null);
                setDrawForm(emptyDrawForm);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveDraw}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Item Dialog ── */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "Edit Line Item" : "Add Line Item"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Description
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={itemForm.description}
                onChange={(e) =>
                  setItemForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Amount Requested
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={itemForm.amount_requested}
                  onChange={(e) =>
                    setItemForm((f) => ({
                      ...f,
                      amount_requested: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Amount Approved
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={itemForm.amount_approved}
                  onChange={(e) =>
                    setItemForm((f) => ({
                      ...f,
                      amount_approved: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setItemDialogOpen(false);
                setEditingItem(null);
                setItemForm(emptyItemForm);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveItem}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete{" "}
            <span className="font-medium text-foreground">
              {deleteTarget?.label}
            </span>
            ? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
