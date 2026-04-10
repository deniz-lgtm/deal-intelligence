"use client";

import { useState, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Loader2, Trash2, X, Edit2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { SiteWalkPhoto, SiteWalkAreaTag } from "@/lib/types";
import { SITE_WALK_AREA_LABELS } from "@/lib/types";

interface Props {
  dealId: string;
  walkId: string;
  photos: SiteWalkPhoto[];
  onChanged: () => void;
}

const AREA_OPTIONS = Object.keys(SITE_WALK_AREA_LABELS) as SiteWalkAreaTag[];

export default function SiteWalkPhotos({ dealId, walkId, photos, onChanged }: Props) {
  const [uploading, setUploading] = useState(false);
  const [areaTag, setAreaTag] = useState<SiteWalkAreaTag>("exterior");
  const [unitLabel, setUnitLabel] = useState("");
  const [filterArea, setFilterArea] = useState<SiteWalkAreaTag | "all">("all");
  const [lightbox, setLightbox] = useState<SiteWalkPhoto | null>(null);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState("");

  const availableAreas = useMemo(() => {
    const set = new Set<SiteWalkAreaTag>();
    photos.forEach((p) => set.add(p.area_tag));
    return AREA_OPTIONS.filter((a) => set.has(a));
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    if (filterArea === "all") return photos;
    return photos.filter((p) => p.area_tag === filterArea);
  }, [photos, filterArea]);

  const grouped = useMemo(() => {
    const map = new Map<SiteWalkAreaTag, SiteWalkPhoto[]>();
    for (const p of filteredPhotos) {
      if (!map.has(p.area_tag)) map.set(p.area_tag, []);
      map.get(p.area_tag)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) =>
      SITE_WALK_AREA_LABELS[a[0]].localeCompare(SITE_WALK_AREA_LABELS[b[0]])
    );
  }, [filteredPhotos]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [] },
    onDrop: async (files) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("area_tag", areaTag);
        if (unitLabel.trim()) formData.append("unit_label", unitLabel.trim());
        files.forEach((f) => formData.append("files", f));
        const res = await fetch(
          `/api/deals/${dealId}/site-walks/${walkId}/photos`,
          { method: "POST", body: formData }
        );
        if (!res.ok) {
          toast.error("Upload failed");
          return;
        }
        const json = await res.json();
        toast.success(`${json.data.length} photo${json.data.length !== 1 ? "s" : ""} uploaded`);
        onChanged();
      } catch (err) {
        console.error(err);
        toast.error("Upload failed");
      } finally {
        setUploading(false);
      }
    },
  });

  const deletePhoto = async (id: string) => {
    if (!confirm("Delete this photo?")) return;
    try {
      await fetch(`/api/deals/${dealId}/site-walks/${walkId}/photos/${id}`, {
        method: "DELETE",
      });
      onChanged();
      if (lightbox?.id === id) setLightbox(null);
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete");
    }
  };

  const saveCaption = async (id: string) => {
    try {
      await fetch(`/api/deals/${dealId}/site-walks/${walkId}/photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: captionValue }),
      });
      setEditingCaption(null);
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save caption");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Area</label>
          <select
            value={areaTag}
            onChange={(e) => setAreaTag(e.target.value as SiteWalkAreaTag)}
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background mt-1"
          >
            {AREA_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {SITE_WALK_AREA_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-[11px] font-medium text-muted-foreground">Unit label (optional)</label>
          <input
            type="text"
            value={unitLabel}
            onChange={(e) => setUnitLabel(e.target.value)}
            placeholder="e.g., Unit 204, Building A"
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background mt-1"
          />
        </div>
      </div>

      <div
        {...getRootProps()}
        className={`rounded-lg border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${
          isDragActive ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/20"
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        ) : (
          <>
            <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1.5" />
            <p className="text-xs font-medium">
              Drop photos — tagged as{" "}
              <span className="text-primary">{SITE_WALK_AREA_LABELS[areaTag]}</span>
              {unitLabel && <span className="text-primary"> · {unitLabel}</span>}
            </p>
          </>
        )}
      </div>

      {availableAreas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilterArea("all")}
            className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
              filterArea === "all"
                ? "bg-primary/20 border-primary/40 text-primary"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({photos.length})
          </button>
          {availableAreas.map((a) => {
            const count = photos.filter((p) => p.area_tag === a).length;
            return (
              <button
                key={a}
                onClick={() => setFilterArea(a)}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  filterArea === a
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {SITE_WALK_AREA_LABELS[a]} ({count})
              </button>
            );
          })}
        </div>
      )}

      {grouped.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No photos yet.</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([area, items]) => (
            <div key={area}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {SITE_WALK_AREA_LABELS[area]}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {items.map((photo) => (
                  <div
                    key={photo.id}
                    className="relative group rounded-md overflow-hidden border border-border/60 bg-card/40"
                  >
                    <button
                      onClick={() => setLightbox(photo)}
                      className="block w-full aspect-square bg-muted/20"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/deals/${dealId}/site-walks/${walkId}/photos/${photo.id}?binary=1`}
                        alt={photo.caption || photo.original_name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                    <button
                      onClick={() => deletePhoto(photo.id)}
                      className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    {photo.unit_label && (
                      <p className="text-[10px] px-1.5 py-0.5 bg-black/60 text-white absolute bottom-8 left-1 rounded">
                        {photo.unit_label}
                      </p>
                    )}
                    <div className="p-1.5">
                      {editingCaption === photo.id ? (
                        <div className="flex gap-1">
                          <input
                            value={captionValue}
                            onChange={(e) => setCaptionValue(e.target.value)}
                            className="flex-1 text-[10px] border rounded px-1 py-0.5 bg-background"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveCaption(photo.id);
                              if (e.key === "Escape") setEditingCaption(null);
                            }}
                          />
                          <button onClick={() => saveCaption(photo.id)}>
                            <Check className="h-3 w-3 text-emerald-400" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingCaption(photo.id);
                            setCaptionValue(photo.caption ?? "");
                          }}
                          className="w-full text-left text-[10px] text-muted-foreground truncate flex items-center gap-1 hover:text-foreground"
                        >
                          <Edit2 className="h-2.5 w-2.5 shrink-0" />
                          {photo.caption || "Add caption"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white hover:text-muted-foreground"
            onClick={() => setLightbox(null)}
          >
            <X className="h-6 w-6" />
          </button>
          <div className="max-w-4xl max-h-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/deals/${dealId}/site-walks/${walkId}/photos/${lightbox.id}?binary=1`}
              alt={lightbox.caption || lightbox.original_name}
              className="max-w-full max-h-[80vh] object-contain"
            />
            <div className="text-center text-white mt-3">
              <p className="text-sm font-medium">
                {SITE_WALK_AREA_LABELS[lightbox.area_tag]}
                {lightbox.unit_label && ` — ${lightbox.unit_label}`}
              </p>
              {lightbox.caption && <p className="text-xs text-muted-foreground mt-1">{lightbox.caption}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
