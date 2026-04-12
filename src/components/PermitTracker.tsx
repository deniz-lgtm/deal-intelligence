"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  FileCheck,
  AlertTriangle,
  Loader2,
  Edit2,
  Calendar,
  Clock,
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
import {
  PERMIT_STATUS_CONFIG,
  PERMIT_TYPES,
} from "@/lib/types";
import type { Permit, PermitStatus } from "@/lib/types";

interface Props {
  dealId: string;
}

const fc = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const STATUS_ORDER: PermitStatus[] = [
  "not_submitted",
  "submitted",
  "in_review",
  "approved",
  "denied",
  "expired",
];

const emptyForm = {
  permit_type: PERMIT_TYPES[0] as string,
  jurisdiction: "",
  description: "",
  submitted_date: "",
  expected_date: "",
  actual_date: "",
  fee: 0,
  status: "not_submitted" as PermitStatus,
  notes: "",
};

function isOverdue(p: Permit): boolean {
  if (!p.expected_date) return false;
  if (p.status === "approved" || p.status === "denied") return false;
  return new Date(p.expected_date) < new Date();
}

function fmtDate(d: string | null): string {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PermitTracker({ dealId }: Props) {
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Permit | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const loadPermits = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/permits`);
      const json = await res.json();
      setPermits(json.data || []);
    } catch (err) {
      console.error("Failed to load permits:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadPermits();
  }, [loadPermits]);

  // ── CRUD helpers ──

  const resetForm = () => setForm({ ...emptyForm });

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (p: Permit) => {
    setEditing(p);
    setForm({
      permit_type: p.permit_type,
      jurisdiction: p.jurisdiction,
      description: p.description,
      submitted_date: p.submitted_date || "",
      expected_date: p.expected_date || "",
      actual_date: p.actual_date || "",
      fee: Number(p.fee) || 0,
      status: p.status,
      notes: p.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.permit_type.trim()) return;
    const payload = {
      permit_type: form.permit_type,
      jurisdiction: form.jurisdiction,
      description: form.description,
      submitted_date: form.submitted_date || null,
      expected_date: form.expected_date || null,
      actual_date: form.actual_date || null,
      fee: form.fee,
      status: form.status,
      notes: form.notes || null,
    };
    try {
      let res;
      if (editing) {
        res = await fetch(`/api/deals/${dealId}/permits/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/deals/${dealId}/permits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, sort_order: permits.length }),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to save permit");
        return;
      }
      setDialogOpen(false);
      setEditing(null);
      resetForm();
      loadPermits();
    } catch (err) {
      console.error("Failed to save permit:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/permits/${id}`, { method: "DELETE" });
      loadPermits();
    } catch (err) {
      console.error("Failed to delete permit:", err);
    }
  };

  // ── Computed values ──

  const totalFees = permits.reduce((sum, p) => sum + Number(p.fee), 0);
  const approvedCount = permits.filter((p) => p.status === "approved").length;
  const pendingCount = permits.filter(
    (p) => p.status === "submitted" || p.status === "in_review"
  ).length;
  const overdueCount = permits.filter(isOverdue).length;

  // Timeline: permits sorted by expected_date (those with dates first)
  const timelinePermits = [...permits]
    .filter((p) => p.expected_date)
    .sort(
      (a, b) =>
        new Date(a.expected_date!).getTime() -
        new Date(b.expected_date!).getTime()
    );
  const allDates = timelinePermits
    .flatMap((p) => [p.submitted_date, p.expected_date])
    .filter((d): d is string => !!d)
    .sort();
  const minDate = allDates[0];
  const maxDate = allDates[allDates.length - 1];
  const timelineRangeMs =
    minDate && maxDate
      ? new Date(maxDate).getTime() - new Date(minDate).getTime()
      : 0;

  const getBarStyle = (start: string | null, end: string | null) => {
    if (!start || !end || !minDate || timelineRangeMs === 0)
      return { left: "0%", width: "0%" };
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const baseMs = new Date(minDate).getTime();
    const left = ((startMs - baseMs) / timelineRangeMs) * 100;
    const width = ((endMs - startMs) / timelineRangeMs) * 100;
    return { left: `${left}%`, width: `${Math.max(width, 2)}%` };
  };

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse text-muted-foreground text-sm">
          Loading permits...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-border/40 rounded-lg bg-card/50 p-3">
          <div className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">
            Total Permits
          </div>
          <div className="text-lg font-semibold">{permits.length}</div>
        </div>
        <div className="border border-border/40 rounded-lg bg-card/50 p-3">
          <div className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">
            Approved
          </div>
          <div className="text-lg font-semibold text-emerald-400">
            {approvedCount}
          </div>
        </div>
        <div className="border border-border/40 rounded-lg bg-card/50 p-3">
          <div className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">
            Pending
          </div>
          <div className="text-lg font-semibold text-amber-400">
            {pendingCount}
          </div>
        </div>
        <div className="border border-border/40 rounded-lg bg-card/50 p-3">
          <div className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">
            Total Fees
          </div>
          <div className="text-lg font-semibold">{fc(totalFees)}</div>
        </div>
      </div>

      {/* ── Overdue alert ── */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>
            {overdueCount} permit{overdueCount > 1 ? "s" : ""} past expected
            approval date
          </span>
        </div>
      )}

      {/* ── Permit Table ── */}
      <section className="border border-border/50 rounded-lg bg-card/50">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Permits</span>
            <Badge variant="secondary" className="text-2xs">
              {approvedCount}/{permits.length}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={openCreate}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Permit
          </Button>
        </div>

        <div className="px-4 pb-4 pt-2">
          {permits.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No permits tracked yet. Click &quot;Add Permit&quot; to get
              started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium">Type</th>
                    <th className="text-left py-2 pr-3 font-medium">
                      Jurisdiction
                    </th>
                    <th className="text-left py-2 pr-3 font-medium">
                      Description
                    </th>
                    <th className="text-left py-2 pr-3 font-medium">
                      Submitted
                    </th>
                    <th className="text-left py-2 pr-3 font-medium">
                      Expected
                    </th>
                    <th className="text-left py-2 pr-3 font-medium">
                      Actual
                    </th>
                    <th className="text-right py-2 pr-3 font-medium">Fee</th>
                    <th className="text-left py-2 pr-3 font-medium">
                      Status
                    </th>
                    <th className="text-right py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map((p) => {
                    const cfg = PERMIT_STATUS_CONFIG[p.status];
                    const overdue = isOverdue(p);
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          "group border-b border-border/20 last:border-0",
                          overdue && "bg-red-500/5"
                        )}
                      >
                        <td className="py-2 pr-3 whitespace-nowrap font-medium">
                          {overdue && (
                            <AlertTriangle className="h-3 w-3 text-red-400 inline mr-1" />
                          )}
                          {p.permit_type}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {p.jurisdiction || "\u2014"}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground max-w-[180px] truncate">
                          {p.description || "\u2014"}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                          {fmtDate(p.submitted_date)}
                        </td>
                        <td
                          className={cn(
                            "py-2 pr-3 whitespace-nowrap",
                            overdue
                              ? "text-red-400 font-medium"
                              : "text-muted-foreground"
                          )}
                        >
                          {fmtDate(p.expected_date)}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                          {fmtDate(p.actual_date)}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">
                          {Number(p.fee) > 0 ? fc(Number(p.fee)) : "\u2014"}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant="secondary"
                            className={cn("text-2xs", cfg.color)}
                          >
                            {cfg.label}
                          </Badge>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(p)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all p-0.5"
                              title="Edit"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleDelete(p.id)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all p-0.5"
                              title="Delete"
                            >
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
      </section>

      {/* ── Timeline / Calendar Section ── */}
      {timelinePermits.length > 0 && (
        <section className="border border-border/50 rounded-lg bg-card/50">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
            <Calendar className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Approval Timeline</span>
          </div>

          <div className="px-4 pb-4 pt-3 space-y-3">
            {/* Range header */}
            {minDate && maxDate && (
              <div className="flex justify-between text-2xs text-muted-foreground border-b border-border/30 pb-1">
                <span>
                  {new Date(minDate + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span>
                  {new Date(maxDate + "T00:00:00").toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            )}

            {/* Bars */}
            <div className="space-y-1.5">
              {timelinePermits.map((p) => {
                const cfg = PERMIT_STATUS_CONFIG[p.status];
                const overdue = isOverdue(p);
                const barStart = p.submitted_date || p.expected_date;
                const barEnd = p.actual_date || p.expected_date;
                const barStyle = getBarStyle(barStart, barEnd);

                // Determine bar color
                let barColor = "bg-blue-500/50";
                if (p.status === "approved") barColor = "bg-emerald-500/50";
                else if (p.status === "denied") barColor = "bg-red-500/50";
                else if (p.status === "expired") barColor = "bg-orange-500/50";
                else if (overdue) barColor = "bg-red-500/60";
                else if (p.status === "in_review") barColor = "bg-amber-500/50";

                return (
                  <div key={p.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3 text-xs truncate flex items-center gap-1">
                      {overdue && (
                        <AlertTriangle className="h-3 w-3 text-red-400 flex-shrink-0" />
                      )}
                      <span className="truncate">{p.permit_type}</span>
                    </div>
                    <div className="col-span-7 relative h-5 bg-muted/30 rounded">
                      <div
                        className={cn("absolute top-0 h-full rounded", barColor)}
                        style={barStyle}
                        title={`${p.permit_type}: ${fmtDate(p.submitted_date)} \u2192 ${fmtDate(p.expected_date)}${p.actual_date ? ` (actual: ${fmtDate(p.actual_date)})` : ""}`}
                      />
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      <Badge
                        variant="secondary"
                        className={cn("text-2xs", cfg.color)}
                      >
                        {cfg.label}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Today marker legend */}
            <div className="flex items-center gap-3 text-2xs text-muted-foreground pt-1 border-t border-border/30">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Expected dates shown
              </span>
              {overdueCount > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <AlertTriangle className="h-3 w-3" /> {overdueCount} overdue
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Add / Edit Dialog ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            resetForm();
          }
          setDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Permit" : "Add Permit"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {/* Permit Type */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Permit Type
              </label>
              <select
                className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm"
                value={form.permit_type}
                onChange={(e) =>
                  setForm({ ...form, permit_type: e.target.value })
                }
              >
                {PERMIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Jurisdiction */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Jurisdiction
              </label>
              <input
                className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm"
                placeholder="e.g. City of Austin"
                value={form.jurisdiction}
                onChange={(e) =>
                  setForm({ ...form, jurisdiction: e.target.value })
                }
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Description
              </label>
              <input
                className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm"
                placeholder="Brief description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>

            {/* Dates row */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Submitted
                </label>
                <input
                  type="date"
                  className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm"
                  value={form.submitted_date}
                  onChange={(e) =>
                    setForm({ ...form, submitted_date: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Expected
                </label>
                <input
                  type="date"
                  className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm"
                  value={form.expected_date}
                  onChange={(e) =>
                    setForm({ ...form, expected_date: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Actual
                </label>
                <input
                  type="date"
                  className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm"
                  value={form.actual_date}
                  onChange={(e) =>
                    setForm({ ...form, actual_date: e.target.value })
                  }
                />
              </div>
            </div>

            {/* Fee + Status row */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Fee ($)
                </label>
                <input
                  type="number"
                  className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm"
                  value={form.fee}
                  onChange={(e) =>
                    setForm({ ...form, fee: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Status
                </label>
                <select
                  className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as PermitStatus,
                    })
                  }
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {PERMIT_STATUS_CONFIG[s].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Notes
              </label>
              <textarea
                className="w-full bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 text-sm min-h-[60px]"
                placeholder="Additional notes..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDialogOpen(false);
                  setEditing(null);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                {editing ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
