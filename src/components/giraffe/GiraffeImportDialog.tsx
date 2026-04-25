"use client";

import { useEffect, useState } from "react";
import { Loader2, UploadCloud, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { GiraffeAction, GiraffePreview } from "@/lib/giraffe";

interface Props {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful commit so the caller can refresh any schedule / programming data. */
  onCommitted: () => void;
  /**
   * Optional: a Document whose contents should be pre-loaded as the
   * upload. When set, we fetch the document's content from the
   * documents API and run the preview immediately — skipping the
   * manual file-picker step when the analyst clicked "Import" on a
   * row in the Documents tab.
   */
  seedFromDocumentId?: string | null;
}

/**
 * Two-step Giraffe import dialog mirrored after GcScheduleImportDialog.
 *
 *  1. Upload .geojson (or auto-preload from a classified document
 *     already in the Documents tab).
 *  2. Preview: analyst sees the proposed massing + buildings + zoning
 *     auto-fills, opts rows in/out, and chooses per-field overwrite
 *     for zoning values that already have analyst-entered data.
 *  3. Commit: one POST to /commit persists everything via the
 *     underwriting PUT.
 */
export default function GiraffeImportDialog({
  dealId,
  open,
  onOpenChange,
  onCommitted,
  seedFromDocumentId,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<GiraffePreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState<Record<string, boolean>>({});
  const [massingName, setMassingName] = useState("");
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSelected(new Set());
    setOverwrite({});
    setMassingName("");
  };

  const actionKey = (a: GiraffeAction, idx: number): string => {
    if (a.type === "create_massing") return `massing:${idx}`;
    if (a.type === "seed_programming") return `program:${a.building_label}:${idx}`;
    return `zoning:${a.field}`;
  };

  const hydratePreview = async (rawBody: BodyInit, headers?: Record<string, string>) => {
    setUploading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/giraffe-import`, {
        method: "POST",
        body: rawBody,
        headers,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Import preview failed");
      const p = j.data as GiraffePreview;
      setPreview(p);
      setMassingName(p.massing_name);
      // Pre-select every action — analyst opts out rather than in.
      const next = new Set<string>();
      p.actions.forEach((a, i) => next.add(actionKey(a, i)));
      setSelected(next);
    } catch (err) {
      toast.error((err as Error).message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    await hydratePreview(fd);
  };

  const handleSeedFromDocument = async () => {
    if (!seedFromDocumentId) return;
    setUploading(true);
    try {
      const docRes = await fetch(`/api/documents/${seedFromDocumentId}/view`);
      if (!docRes.ok) throw new Error("Could not load document");
      const text = await docRes.text();
      await hydratePreview(text, { "Content-Type": "application/geo+json" });
    } catch (err) {
      toast.error((err as Error).message || "Could not load document");
      setUploading(false);
    }
  };

  // Auto-trigger preview when the dialog opens with a seeded document —
  // saves the analyst from clicking "Use this file" when they already
  // said "import this Giraffe export" on the banner.
  useEffect(() => {
    if (open && seedFromDocumentId && !preview && !uploading) {
      handleSeedFromDocument();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seedFromDocumentId]);

  const handleCommit = async () => {
    if (!preview) return;
    const approved = preview.actions.filter((a, i) => selected.has(actionKey(a, i)));
    if (approved.length === 0) {
      toast.error("Select at least one action to import.");
      return;
    }
    setCommitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/giraffe-import/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          massing_name: preview.massing_name,
          name_override: massingName,
          actions: approved,
          overwrite,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "commit failed");
      toast.success(
        `Imported: ${approved.filter((a) => a.type === "create_massing").length ? "1 massing" : ""} ${
          approved.filter((a) => a.type === "seed_programming").length
            ? `, ${approved.filter((a) => a.type === "seed_programming").length} buildings programmed`
            : ""
        }${
          approved.filter((a) => a.type === "fill_zoning").length
            ? `, ${approved.filter((a) => a.type === "fill_zoning").length} zoning fields set`
            : ""
        }`.trim()
      );
      onCommitted();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error((err as Error).message || "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  const createMassing = preview?.actions.find((a) => a.type === "create_massing") as
    | Extract<GiraffeAction, { type: "create_massing" }>
    | undefined;
  const programActions = (preview?.actions || []).filter(
    (a): a is Extract<GiraffeAction, { type: "seed_programming" }> => a.type === "seed_programming"
  );
  const zoningActions = (preview?.actions || []).filter(
    (a): a is Extract<GiraffeAction, { type: "fill_zoning" }> => a.type === "fill_zoning"
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from Giraffe</DialogTitle>
          <DialogDescription>
            Turn a Giraffe GeoJSON export into a new Massing, seeded Programming,
            and auto-filled Zoning. Analyst-entered values won&apos;t be
            overwritten unless you check the overwrite box for that field.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4 py-2">
            <label className="block border-2 border-dashed border-border/60 rounded-lg p-8 text-center cursor-pointer hover:border-primary/60 transition-colors">
              <input
                type="file"
                accept=".geojson,application/geo+json,application/json"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <UploadCloud className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">
                {file ? file.name : "Choose a .geojson file"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Giraffe → Export → GeoJSON. We parse the parcel polygon + building
                footprints and the attached properties.
              </p>
            </label>
            {seedFromDocumentId && !file && (
              <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 p-3">
                <span className="text-xs text-muted-foreground">
                  A Giraffe export is already on the deal.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSeedFromDocument}
                  disabled={uploading}
                >
                  {uploading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Use that file
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                {preview.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
            )}

            {/* Massing section */}
            {createMassing && (
              <section className="rounded-md border border-border/60 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={selected.has(
                      actionKey(createMassing, preview.actions.indexOf(createMassing))
                    )}
                    onChange={(e) => {
                      const k = actionKey(
                        createMassing,
                        preview.actions.indexOf(createMassing)
                      );
                      const next = new Set(selected);
                      if (e.target.checked) next.add(k);
                      else next.delete(k);
                      setSelected(next);
                    }}
                  />
                  <span className="text-sm font-medium">Create massing</span>
                  <Badge variant="secondary" className="text-2xs">
                    {createMassing.buildings.length} building
                    {createMassing.buildings.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <input
                  value={massingName}
                  onChange={(e) => setMassingName(e.target.value)}
                  className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm"
                  placeholder="Massing name"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Parcel: {createMassing.parcel_area_sf.toLocaleString()} sf
                  {createMassing.buildings.length > 0 &&
                    ` · Buildings: ${createMassing.buildings
                      .map((b) => `${b.label} (${b.area_sf.toLocaleString()} sf)`)
                      .join(", ")}`}
                </p>
              </section>
            )}

            {/* Programming seeds */}
            {programActions.length > 0 && (
              <section className="rounded-md border border-border/60 p-3 space-y-2">
                <p className="text-sm font-medium">Seed programming</p>
                {programActions.map((pa, i) => {
                  const idx = preview.actions.indexOf(pa);
                  const k = actionKey(pa, idx);
                  return (
                    <label
                      key={k + i}
                      className="flex items-start gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(k)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(k);
                          else next.delete(k);
                          setSelected(next);
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">{pa.building_label}</span>{" "}
                        {pa.floors != null && `· ${pa.floors} floors`}
                        {pa.unit_count != null && ` · ${pa.unit_count} units`}
                        {pa.unit_mix.length > 0 &&
                          ` · mix: ${pa.unit_mix
                            .map((u) => `${u.type_label} ${Math.round(u.allocation_pct)}%`)
                            .join(" / ")}`}
                        {pa.parking_spaces != null &&
                          ` · ${pa.parking_spaces} ${pa.parking_type ?? ""} spaces`}
                      </span>
                    </label>
                  );
                })}
              </section>
            )}

            {/* Zoning fills */}
            {zoningActions.length > 0 && (
              <section className="rounded-md border border-border/60 p-3 space-y-2">
                <p className="text-sm font-medium">Auto-fill zoning</p>
                <p className="text-2xs text-muted-foreground">
                  Only fields that are currently blank get filled. Check
                  &quot;overwrite&quot; to replace an existing analyst-entered
                  value.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {zoningActions.map((za) => {
                    const k = actionKey(za, preview.actions.indexOf(za));
                    return (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={selected.has(k)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(k);
                            else next.delete(k);
                            setSelected(next);
                          }}
                        />
                        <span className="flex-1">
                          <span className="text-muted-foreground">
                            {FIELD_LABELS[za.field]}
                          </span>
                          <span className="ml-2 font-medium">{za.value}</span>
                        </span>
                        <label className="flex items-center gap-1 text-2xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={!!overwrite[za.field]}
                            onChange={(e) =>
                              setOverwrite((o) => ({
                                ...o,
                                [za.field]: e.target.checked,
                              }))
                            }
                          />
                          overwrite
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Unmapped keys — flagged for manual review */}
            {preview.unmapped_keys.length > 0 && (
              <section className="rounded-md border border-border/60 p-3">
                <p className="text-xs font-medium mb-1">Unmapped keys</p>
                <p className="text-2xs text-muted-foreground mb-2">
                  These properties were in the export but didn&apos;t match our
                  schema.{" "}
                  {preview.llm_proposed.length > 0
                    ? "Claude proposed mappings for some — applied above."
                    : "You can set them manually in Site Plan / Programming after import."}
                </p>
                <div className="flex flex-wrap gap-1">
                  {preview.unmapped_keys.map((k) => (
                    <Badge key={k} variant="outline" className="text-2xs font-mono">
                      {k}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            {preview.actions.length === 0 && (
              <div className="rounded-md border border-border/60 p-4 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="h-5 w-5 mx-auto mb-1" />
                Nothing to import from this export.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={handleCommit} disabled={committing}>
              {committing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Commit import
            </Button>
          ) : (
            <Button onClick={handleUpload} disabled={!file || uploading}>
              {uploading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Parse &amp; preview
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_LABELS: Record<string, string> = {
  far: "FAR",
  height_ft: "Height (ft)",
  height_stories: "Height (stories)",
  lot_coverage_pct: "Lot coverage %",
  setback_front: "Setback · front",
  setback_side: "Setback · side",
  setback_rear: "Setback · rear",
  setback_corner: "Setback · corner",
  parking_ratio_residential: "Parking · spaces/unit",
  parking_ratio_commercial: "Parking · spaces/1000sf",
};
