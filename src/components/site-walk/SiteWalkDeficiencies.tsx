"use client";

import { useState, useMemo } from "react";
import { Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type {
  SiteWalkDeficiency,
  SiteWalkPhoto,
  SiteWalkAreaTag,
  DeficiencySeverity,
  DeficiencyStatus,
} from "@/lib/types";
import {
  SITE_WALK_AREA_LABELS,
  DEFICIENCY_SEVERITY_LABELS,
  DEFICIENCY_STATUS_LABELS,
} from "@/lib/types";

interface Props {
  dealId: string;
  walkId: string;
  deficiencies: SiteWalkDeficiency[];
  photos: SiteWalkPhoto[];
  onChanged: () => void;
}

const AREA_OPTIONS = Object.keys(SITE_WALK_AREA_LABELS) as SiteWalkAreaTag[];
const SEVERITY_OPTIONS: DeficiencySeverity[] = ["minor", "moderate", "major", "critical"];
const STATUS_OPTIONS: DeficiencyStatus[] = ["open", "in_progress", "resolved", "deferred"];

const SEVERITY_COLORS: Record<DeficiencySeverity, string> = {
  minor: "bg-zinc-500/20 text-zinc-300",
  moderate: "bg-amber-500/20 text-amber-300",
  major: "bg-orange-500/20 text-orange-300",
  critical: "bg-red-500/20 text-red-300",
};

const STATUS_COLORS: Record<DeficiencyStatus, string> = {
  open: "bg-red-500/20 text-red-300",
  in_progress: "bg-amber-500/20 text-amber-300",
  resolved: "bg-emerald-500/20 text-emerald-300",
  deferred: "bg-zinc-500/20 text-zinc-300",
};

const CATEGORY_OPTIONS = [
  "exterior",
  "interior",
  "mechanical",
  "electrical",
  "plumbing",
  "roofing",
  "structural",
  "life_safety",
  "cosmetic",
  "ada",
  "other",
];

export default function SiteWalkDeficiencies({ dealId, walkId, deficiencies, photos, onChanged }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [areaTag, setAreaTag] = useState<SiteWalkAreaTag>("exterior");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<DeficiencySeverity>("minor");
  const [category, setCategory] = useState("other");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [photoId, setPhotoId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const stats = useMemo(() => {
    const total = deficiencies.length;
    const open = deficiencies.filter((d) => d.status === "open").length;
    const totalCost = deficiencies.reduce(
      (sum, d) => sum + (typeof d.estimated_cost === "number" ? d.estimated_cost : Number(d.estimated_cost) || 0),
      0
    );
    return { total, open, totalCost };
  }, [deficiencies]);

  const addDeficiency = async () => {
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/site-walks/${walkId}/deficiencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area_tag: areaTag,
          description: description.trim(),
          severity,
          category,
          estimated_cost: estimatedCost ? Number(estimatedCost) : null,
          photo_id: photoId || null,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to add deficiency");
        return;
      }
      toast.success("Deficiency added");
      setDescription("");
      setEstimatedCost("");
      setPhotoId("");
      setShowForm(false);
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to add");
    } finally {
      setSaving(false);
    }
  };

  const updateField = async (id: string, updates: Record<string, unknown>) => {
    try {
      await fetch(`/api/deals/${dealId}/site-walks/${walkId}/deficiencies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to update");
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this deficiency?")) return;
    try {
      await fetch(`/api/deals/${dealId}/site-walks/${walkId}/deficiencies/${id}`, {
        method: "DELETE",
      });
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-xs">
          <span className="text-muted-foreground">
            Total: <span className="text-foreground font-medium">{stats.total}</span>
          </span>
          <span className="text-muted-foreground">
            Open: <span className="text-red-400 font-medium">{stats.open}</span>
          </span>
          {stats.totalCost > 0 && (
            <span className="text-muted-foreground">
              Est. Cost: <span className="text-foreground font-medium">${stats.totalCost.toLocaleString()}</span>
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Area</label>
              <select
                value={areaTag}
                onChange={(e) => setAreaTag(e.target.value as SiteWalkAreaTag)}
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background text-foreground mt-0.5"
              >
                {AREA_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {SITE_WALK_AREA_LABELS[a]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as DeficiencySeverity)}
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background text-foreground mt-0.5"
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {DEFICIENCY_SEVERITY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background text-foreground mt-0.5"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground">Est. Cost ($)</label>
              <input
                type="number"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                placeholder="0"
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background text-foreground mt-0.5"
              />
            </div>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the deficiency..."
            rows={2}
            className="w-full text-xs border rounded px-2 py-1 bg-background resize-none"
          />
          {photos.length > 0 && (
            <select
              value={photoId}
              onChange={(e) => setPhotoId(e.target.value)}
              className="w-full text-xs border rounded px-2 py-1 bg-background"
            >
              <option value="">(No linked photo)</option>
              {photos.map((p) => (
                <option key={p.id} value={p.id}>
                  {SITE_WALK_AREA_LABELS[p.area_tag]}
                  {p.unit_label ? ` — ${p.unit_label}` : ""} — {p.original_name}
                </option>
              ))}
            </select>
          )}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={addDeficiency} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      )}

      {deficiencies.length === 0 ? (
        <div className="text-center py-6">
          <AlertTriangle className="h-6 w-6 mx-auto text-muted-foreground/40 mb-1.5" />
          <p className="text-xs text-muted-foreground">No deficiencies logged.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {deficiencies.map((d) => (
            <div
              key={d.id}
              className="rounded-lg border border-border/60 bg-card/40 p-3 space-y-1.5"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-400/10 text-teal-400 font-medium">
                      {SITE_WALK_AREA_LABELS[d.area_tag]}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${SEVERITY_COLORS[d.severity]}`}
                    >
                      {DEFICIENCY_SEVERITY_LABELS[d.severity]}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{d.category}</span>
                    {d.estimated_cost != null && (
                      <span className="text-[10px] text-muted-foreground">
                        ${Number(d.estimated_cost).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs">{d.description}</p>
                  {d.notes && (
                    <p className="text-[11px] text-muted-foreground italic mt-1">{d.notes}</p>
                  )}
                </div>
                <button onClick={() => remove(d.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex gap-1">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateField(d.id, { status: s })}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                      d.status === s
                        ? STATUS_COLORS[s]
                        : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {DEFICIENCY_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
