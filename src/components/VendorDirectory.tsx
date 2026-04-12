"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Users,
  Loader2,
  Edit2,
  Phone,
  Mail,
  Building2,
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
  VENDOR_STATUS_CONFIG,
  VENDOR_ROLES,
} from "@/lib/types";
import type { Vendor, VendorStatus } from "@/lib/types";

interface Props {
  dealId: string;
}

export default function VendorDirectory({ dealId }: Props) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [filterRole, setFilterRole] = useState<string>("all");
  const [form, setForm] = useState({
    name: "",
    role: VENDOR_ROLES[0] as string,
    company: "",
    email: "",
    phone: "",
    status: "prospective" as VendorStatus,
    engagement_date: "",
    notes: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${dealId}/vendors`);
      const json = await res.json();
      setVendors(json.data ?? []);
    } catch (err) {
      console.error("Failed to load vendors:", err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({
      name: "",
      role: VENDOR_ROLES[0] as string,
      company: "",
      email: "",
      phone: "",
      status: "prospective",
      engagement_date: "",
      notes: "",
    });
    setEditing(null);
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (v: Vendor) => {
    setEditing(v);
    setForm({
      name: v.name,
      role: v.role,
      company: v.company || "",
      email: v.email || "",
      phone: v.phone || "",
      status: v.status,
      engagement_date: v.engagement_date?.slice(0, 10) || "",
      notes: v.notes || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      if (editing) {
        const res = await fetch(`/api/deals/${dealId}/vendors/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        setVendors((prev) =>
          prev.map((v) => (v.id === editing.id ? json.data : v))
        );
      } else {
        const res = await fetch(`/api/deals/${dealId}/vendors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const json = await res.json();
        setVendors((prev) => [...prev, json.data]);
      }
      setDialogOpen(false);
      resetForm();
    } catch (err) {
      console.error("Failed to save vendor:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/vendors/${id}`, { method: "DELETE" });
      setVendors((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      console.error("Failed to delete vendor:", err);
    }
  };

  const filtered = filterRole === "all"
    ? vendors
    : vendors.filter((v) => v.role === filterRole);

  const roles = Array.from(new Set(vendors.map((v) => v.role)));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading vendors...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{vendors.length} vendor{vendors.length !== 1 ? "s" : ""}</span>
          {roles.length > 1 && (
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="bg-card border border-border/40 rounded-md text-xs px-2 py-1 text-muted-foreground"
            >
              <option value="all">All roles</option>
              {roles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Vendor
        </Button>
      </div>

      {/* Vendor List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No vendors yet. Add your first vendor to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((v) => {
            const statusConfig = VENDOR_STATUS_CONFIG[v.status];
            return (
              <div
                key={v.id}
                className="rounded-lg border border-border/40 bg-card/50 p-4 flex items-start gap-4"
              >
                <div className="h-9 w-9 rounded-lg bg-muted/20 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm text-foreground">{v.name}</span>
                    <span
                      className={cn(
                        "text-2xs px-1.5 py-0.5 rounded-full font-medium",
                        statusConfig?.color ?? "bg-muted text-muted-foreground"
                      )}
                    >
                      {statusConfig?.label ?? v.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-2xs text-muted-foreground mb-1">
                    <span className="font-medium">{v.role}</span>
                    {v.company && <span>{v.company}</span>}
                  </div>
                  <div className="flex items-center gap-4 text-2xs text-muted-foreground">
                    {v.email && (
                      <a href={`mailto:${v.email}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                        <Mail className="h-3 w-3" />
                        {v.email}
                      </a>
                    )}
                    {v.phone && (
                      <a href={`tel:${v.phone}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                        <Phone className="h-3 w-3" />
                        {v.phone}
                      </a>
                    )}
                    {v.engagement_date && (
                      <span>Engaged: {new Date(v.engagement_date).toLocaleDateString()}</span>
                    )}
                  </div>
                  {v.notes && (
                    <p className="text-2xs text-muted-foreground/60 mt-1 line-clamp-1">{v.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openEdit(v)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Vendor" : "Add Vendor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                placeholder="Vendor name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                >
                  {VENDOR_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Company</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                  placeholder="Company name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as VendorStatus })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                >
                  {(Object.keys(VENDOR_STATUS_CONFIG) as VendorStatus[]).map((s) => (
                    <option key={s} value={s}>{VENDOR_STATUS_CONFIG[s].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Engagement Date</label>
                <input
                  type="date"
                  value={form.engagement_date}
                  onChange={(e) => setForm({ ...form, engagement_date: e.target.value })}
                  className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full bg-card border border-border/40 rounded-md px-3 py-2 text-sm h-20 resize-none"
                placeholder="Additional notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim()}>
              {editing ? "Save Changes" : "Add Vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
