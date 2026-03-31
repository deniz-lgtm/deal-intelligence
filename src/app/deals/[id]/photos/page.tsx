"use client";

import { useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  Trash2,
  Loader2,
  Image as ImageIcon,
  MapPin,
  ExternalLink,
  X,
  Edit2,
  Check,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { toast } from "sonner";
import type { Photo } from "@/lib/types";

export default function PhotosPage({ params }: { params: { id: string } }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionValue, setCaptionValue] = useState("");
  const [deal, setDeal] = useState<{ address: string; city: string; state: string; zip: string } | null>(null);
  const [captioning, setCaptioning] = useState<string | null>(null);
  const [captioningAll, setCaptioningAll] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/deals/${params.id}`).then((r) => r.json()),
      fetch(`/api/deals/${params.id}/photos`).then((r) => r.json()),
    ]).then(([dealRes, photosRes]) => {
      setDeal(dealRes.data);
      setPhotos(photosRes.data || []);
      setLoading(false);
    });
  }, [params.id]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [] },
    onDrop: async (files) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("deal_id", params.id);
        files.forEach((f) => formData.append("files", f));
        const res = await fetch("/api/photos/upload", { method: "POST", body: formData });
        const json = await res.json();
        if (json.data) {
          setPhotos((prev) => [...prev, ...json.data]);
          toast.success(`${json.data.length} photo${json.data.length !== 1 ? "s" : ""} uploaded`);
        } else {
          toast.error("Upload failed");
        }
      } catch {
        toast.error("Upload failed");
      } finally {
        setUploading(false);
      }
    },
  });

  const deletePhoto = async (id: string) => {
    if (!confirm("Delete this photo?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/photos/${id}`, { method: "DELETE" });
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      if (lightbox?.id === id) setLightbox(null);
      toast.success("Photo deleted");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(null);
    }
  };

  const saveCaption = async (id: string) => {
    try {
      await fetch(`/api/photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: captionValue }),
      });
      setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, caption: captionValue } : p));
      setEditingCaption(null);
      toast.success("Caption saved");
    } catch {
      toast.error("Failed to save caption");
    }
  };

  const autoCaptionPhoto = async (id: string) => {
    setCaptioning(id);
    try {
      const res = await fetch(`/api/photos/${id}/caption`, { method: "POST" });
      const json = await res.json();
      if (res.ok && json.data) {
        setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, caption: json.data.caption } : p));
        toast.success("Caption generated");
      } else { toast.error(json.error || "Caption failed"); }
    } catch { toast.error("Caption failed"); }
    finally { setCaptioning(null); }
  };

  const autoCaptionAll = async () => {
    const uncaptioned = photos.filter((p) => !p.caption);
    if (uncaptioned.length === 0) { toast.info("All photos already have captions"); return; }
    setCaptioningAll(true);
    let count = 0;
    for (const photo of uncaptioned) {
      try {
        const res = await fetch(`/api/photos/${photo.id}/caption`, { method: "POST" });
        const json = await res.json();
        if (res.ok && json.data) {
          setPhotos((prev) => prev.map((p) => p.id === photo.id ? { ...p, caption: json.data.caption } : p));
          count++;
        }
      } catch { /* continue */ }
    }
    toast.success(`${count} photo${count !== 1 ? "s" : ""} captioned`);
    setCaptioningAll(false);
  };

  const googleMapsUrl = deal
    ? `https://maps.google.com/maps?q=${encodeURIComponent([deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", "))}&output=embed`
    : null;

  const streetViewUrl = deal
    ? `https://www.google.com/maps?layer=c&q=${encodeURIComponent([deal.address, deal.city, deal.state].filter(Boolean).join(", "))}`
    : null;

  return (
    <div className="space-y-6">
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={`/api/photos/${lightbox.id}`}
            alt={lightbox.caption || lightbox.original_name}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          {lightbox.caption && (
            <p className="absolute bottom-6 left-0 right-0 text-center text-white/80 text-sm px-8">
              {lightbox.caption}
            </p>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Photos</h2>
          <p className="text-sm text-muted-foreground">
            {photos.length} photo{photos.length !== 1 ? "s" : ""} — property images & street view
          </p>
        </div>
        {photos.length > 0 && (
          <Button variant="outline" size="sm" onClick={autoCaptionAll} disabled={captioningAll}>
            {captioningAll ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Auto-Caption All
          </Button>
        )}
      </div>

      {/* Map + Street View */}
      {deal && (deal.address || deal.city) && (
        <div className="border rounded-xl overflow-hidden bg-card">
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <MapPin className="h-4 w-4 text-red-500" />
              Property Location
            </div>
            <div className="flex gap-2">
              {streetViewUrl && (
                <a href={streetViewUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="text-xs gap-1">
                    <ExternalLink className="h-3 w-3" />
                    Street View
                  </Button>
                </a>
              )}
              {deal.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([deal.address, deal.city, deal.state].filter(Boolean).join(", "))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" size="sm" className="text-xs gap-1">
                    <ExternalLink className="h-3 w-3" />
                    Open Maps
                  </Button>
                </a>
              )}
            </div>
          </div>
          {googleMapsUrl && (
            <iframe
              src={googleMapsUrl}
              width="100%"
              height="280"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Property location"
            />
          )}
        </div>
      )}

      {/* Upload area */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 hover:border-primary/50 hover:bg-accent/20"
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Uploading photos...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground/50" />
            <p className="font-medium text-sm">
              {isDragActive ? "Drop photos here" : "Drag & drop photos or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">JPG, PNG, HEIC, WebP supported</p>
          </div>
        )}
      </div>

      {/* Photos grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ImageIcon className="h-12 w-12 mx-auto opacity-20 mb-3" />
          <p>No photos yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="group relative border rounded-xl overflow-hidden bg-card hover:shadow-md transition-all"
            >
              <div
                className="aspect-video bg-muted cursor-pointer overflow-hidden"
                onClick={() => setLightbox(photo)}
              >
                <img
                  src={`/api/photos/${photo.id}`}
                  alt={photo.caption || photo.original_name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="p-2">
                {editingCaption === photo.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={captionValue}
                      onChange={(e) => setCaptionValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveCaption(photo.id); if (e.key === "Escape") setEditingCaption(null); }}
                      className="flex-1 text-xs border rounded px-1.5 py-1 bg-background focus:outline-none"
                      placeholder="Add caption..."
                    />
                    <button onClick={() => saveCaption(photo.id)} className="text-green-600 hover:text-green-700">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-1">
                    <p
                      className="text-xs text-muted-foreground truncate flex-1 cursor-pointer hover:text-foreground"
                      onClick={() => { setEditingCaption(photo.id); setCaptionValue(photo.caption || ""); }}
                    >
                      {photo.caption || <span className="opacity-50">Add caption...</span>}
                    </p>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => autoCaptionPhoto(photo.id)}
                        disabled={captioning === photo.id}
                        className="text-muted-foreground hover:text-primary"
                        title="AI Caption"
                      >
                        {captioning === photo.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => { setEditingCaption(photo.id); setCaptionValue(photo.caption || ""); }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => deletePhoto(photo.id)}
                        disabled={deleting === photo.id}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        {deleting === photo.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{formatBytes(photo.file_size)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
