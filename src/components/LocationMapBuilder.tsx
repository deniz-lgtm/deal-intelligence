"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Camera,
  Layers,
  Loader2,
  Pencil,
  Tag,
  Tags,
} from "lucide-react";
import { getTileConfig, hasMapbox, MAP_STYLE_OPTIONS } from "@/lib/map-config";
import type { MapStyle } from "@/lib/map-config";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ── Marker icons by category ─────────────────────────────────────────────────

function createPin(color: string, size: [number, number] = [18, 24]): L.DivIcon {
  return L.divIcon({
    className: "location-map-marker",
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size[0]}" height="${size[1]}" fill="${color}" stroke="white" stroke-width="2">
      <path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z"/>
      <circle cx="12" cy="9" r="3" fill="white"/>
    </svg>`,
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1]],
    popupAnchor: [0, -size[1] + 4],
  });
}

const SUBJECT_ICON = L.divIcon({
  className: "location-map-subject",
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="46" fill="#10b981" stroke="white" stroke-width="2.5">
    <path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z"/>
    <circle cx="12" cy="9" r="3.5" fill="white"/>
  </svg>`,
  iconSize: [36, 46],
  iconAnchor: [18, 46],
  popupAnchor: [0, -42],
});

const LAYER_CONFIG = {
  amenities: { color: "#f59e0b", label: "Amenities", icon: createPin("#f59e0b") },
  employers: { color: "#6366f1", label: "Employers", icon: createPin("#6366f1") },
  schools: { color: "#06b6d4", label: "Schools", icon: createPin("#06b6d4") },
  commute: { color: "#ec4899", label: "Commute", icon: createPin("#ec4899", [20, 28]) },
  comps_sale: { color: "#eab308", label: "Sale Comps", icon: createPin("#eab308") },
  comps_rent: { color: "#3b82f6", label: "Rent Comps", icon: createPin("#3b82f6") },
} as const;

type LayerKey = keyof typeof LAYER_CONFIG;

// ── Types ────────────────────────────────────────────────────────────────────

interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  category: string;
  layer: LayerKey;
  detail?: string;
  rating?: number | null;
}

export interface MapBuilderProps {
  dealId: string;
  subject: { lat: number; lng: number; name?: string; address?: string } | null;
  radiusMiles: number | null;
  // Data points from location intelligence
  amenities?: Array<{ name: string; category: string; lat: number; lng: number; distance_mi: number; rating?: number | null }>;
  employers?: Array<{ name: string; type: string; lat: number; lng: number; distance_mi: number }>;
  schools?: Array<{ name: string; lat: number; lng: number; distance_mi: number | null; rating?: number | null }>;
  commuteDestinations?: Array<{ name: string; type: string; lat: number; lng: number; drive_text?: string | null }>;
  comps?: Array<{ id: string; name: string | null; lat: number; lng: number; comp_type: "sale" | "rent"; sale_price?: number | null; cap_rate?: number | null; rent_per_unit?: number | null }>;
  height?: number;
  onSnapshotCaptured?: (dataUrl: string) => void;
}

// ── FitBounds helper ─────────────────────────────────────────────────────────

const METERS_PER_MILE = 1609.344;

function FitBounds({
  points,
  subject,
  radiusMiles,
}: {
  points: MapPoint[];
  subject: MapBuilderProps["subject"];
  radiusMiles: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    const coords: Array<[number, number]> = points.map((p) => [p.lat, p.lng]);
    if (subject) coords.push([subject.lat, subject.lng]);
    if (coords.length === 0) return;

    let bounds = L.latLngBounds(coords);
    if (subject && radiusMiles != null && radiusMiles > 0) {
      const meters = radiusMiles * METERS_PER_MILE;
      const ringBounds = L.latLng(subject.lat, subject.lng).toBounds(meters * 2);
      bounds = bounds.extend(ringBounds);
    }
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [map, points, subject, radiusMiles]);
  return null;
}

// ── Tile layer updater (react-leaflet MapContainer doesn't re-render tiles) ──

function TileUpdater({ url, attribution, tileSize, zoomOffset }: { url: string; attribution: string; tileSize?: number; zoomOffset?: number }) {
  const map = useMap();
  useEffect(() => {
    // Remove existing tile layers and add the new one
    map.eachLayer((layer) => {
      if ((layer as L.TileLayer).getTileUrl) {
        map.removeLayer(layer);
      }
    });
    const newLayer = L.tileLayer(url, {
      attribution,
      ...(tileSize ? { tileSize } : {}),
      ...(zoomOffset != null ? { zoomOffset } : {}),
    });
    newLayer.addTo(map);
  }, [map, url, attribution, tileSize, zoomOffset]);
  return null;
}

// ── Labeled marker icon ──────────────────────────────────────────────────────

function createLabeledPin(color: string, label: string, size: [number, number] = [18, 24]): L.DivIcon {
  return L.divIcon({
    className: "location-map-labeled-marker",
    html: `<div style="position:relative;display:inline-block">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size[0]}" height="${size[1]}" fill="${color}" stroke="white" stroke-width="2">
        <path d="M12 0C7 0 3 4 3 9c0 7 9 15 9 15s9-8 9-15c0-5-4-9-9-9z"/>
        <circle cx="12" cy="9" r="3" fill="white"/>
      </svg>
      <div style="position:absolute;top:${size[1] + 2}px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:9px;font-weight:600;color:${color};text-shadow:0 0 3px rgba(0,0,0,0.8),0 0 6px rgba(0,0,0,0.6);pointer-events:none">${label}</div>
    </div>`,
    iconSize: [size[0], size[1] + 14],
    iconAnchor: [size[0] / 2, size[1]],
    popupAnchor: [0, -size[1] + 4],
  });
}

// ── Map ref for snapshot ─────────────────────────────────────────────────────

function MapRefCapture({ onMapRef }: { onMapRef: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onMapRef(map); }, [map, onMapRef]);
  return null;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function LocationMapBuilder({
  dealId,
  subject,
  radiusMiles,
  amenities = [],
  employers = [],
  schools = [],
  commuteDestinations = [],
  comps = [],
  height = 600,
  onSnapshotCaptured,
}: MapBuilderProps) {
  const [visibleLayers, setVisibleLayers] = useState<Set<LayerKey>>(
    () => new Set(["amenities", "employers", "schools", "commute", "comps_sale", "comps_rent"] as LayerKey[])
  );
  const [capturing, setCapturing] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyle>("dark");
  const [mapTitle, setMapTitle] = useState("Location Map");
  const [editingTitle, setEditingTitle] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const tiles = getTileConfig(mapStyle);
  const handleMapRef = useCallback((map: L.Map) => { mapRef.current = map; }, []);

  // Build all map points
  const allPoints = useMemo(() => {
    const points: MapPoint[] = [];

    if (visibleLayers.has("amenities")) {
      for (const a of amenities.slice(0, 50)) {
        if (a.lat && a.lng) {
          points.push({
            id: `a-${a.name}-${a.lat}`,
            lat: a.lat,
            lng: a.lng,
            name: a.name,
            category: a.category,
            layer: "amenities",
            rating: a.rating,
            detail: a.category,
          });
        }
      }
    }

    if (visibleLayers.has("employers")) {
      for (const e of employers.slice(0, 30)) {
        if (e.lat && e.lng) {
          points.push({
            id: `e-${e.name}-${e.lat}`,
            lat: e.lat,
            lng: e.lng,
            name: e.name,
            category: e.type,
            layer: "employers",
            detail: e.type,
          });
        }
      }
    }

    if (visibleLayers.has("schools")) {
      for (const s of schools.slice(0, 25)) {
        if (s.lat && s.lng) {
          points.push({
            id: `s-${s.name}-${s.lat}`,
            lat: s.lat,
            lng: s.lng,
            name: s.name,
            category: "School",
            layer: "schools",
            rating: s.rating,
          });
        }
      }
    }

    if (visibleLayers.has("commute")) {
      for (const d of commuteDestinations) {
        if (d.lat && d.lng) {
          points.push({
            id: `c-${d.name}-${d.lat}`,
            lat: d.lat,
            lng: d.lng,
            name: d.name,
            category: d.type,
            layer: "commute",
            detail: d.drive_text || undefined,
          });
        }
      }
    }

    for (const c of comps) {
      if (!c.lat || !c.lng) continue;
      const layer: LayerKey = c.comp_type === "sale" ? "comps_sale" : "comps_rent";
      if (!visibleLayers.has(layer)) continue;
      points.push({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        name: c.name || "Unnamed",
        category: c.comp_type,
        layer,
        detail: c.comp_type === "sale"
          ? c.sale_price ? `$${Math.round(c.sale_price).toLocaleString()}` : undefined
          : c.rent_per_unit ? `$${Math.round(c.rent_per_unit).toLocaleString()}/mo` : undefined,
      });
    }

    return points;
  }, [amenities, employers, schools, commuteDestinations, comps, visibleLayers]);

  function toggleLayer(key: LayerKey) {
    setVisibleLayers((prev) => {
      const next = new Set(Array.from(prev)) as Set<LayerKey>;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Capture map as PNG
  async function captureSnapshot() {
    if (!containerRef.current) return;
    setCapturing(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(containerRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        filter: (node) => {
          // Exclude layer controls from the snapshot
          if (node instanceof HTMLElement && node.dataset.excludeSnapshot === "true") return false;
          return true;
        },
      });
      if (onSnapshotCaptured) {
        onSnapshotCaptured(dataUrl);
      }
      // Also download locally
      const link = document.createElement("a");
      link.download = `location-map-${dealId}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Map snapshot saved");
    } catch (err) {
      console.error("Map snapshot error:", err);
      toast.error("Failed to capture map. Try adjusting zoom level.");
    } finally {
      setCapturing(false);
    }
  }

  const defaultCenter: [number, number] = subject
    ? [subject.lat, subject.lng]
    : [39.8283, -98.5795];

  // Count points per layer for the legend
  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allPoints) counts[p.layer] = (counts[p.layer] || 0) + 1;
    return counts;
  }, [allPoints]);

  return (
    <div className="space-y-3">
      {/* ── Title + Style + Controls ─────────────────────────────── */}
      <div className="space-y-2" data-exclude-snapshot="true">
        {/* Row 1: Title + Style + Export */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {editingTitle ? (
              <input
                autoFocus
                value={mapTitle}
                onChange={(e) => setMapTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => { if (e.key === "Enter") setEditingTitle(false); }}
                className="text-sm font-semibold bg-muted/20 border border-border/40 rounded px-2 py-0.5 outline-none focus:border-primary/40 w-48"
              />
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="text-sm font-semibold text-foreground/90 hover:text-foreground flex items-center gap-1.5"
              >
                {mapTitle}
                <Pencil className="h-3 w-3 text-muted-foreground/50" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Style selector */}
            {hasMapbox() && (
              <div className="inline-flex items-center rounded-lg border border-border/40 bg-muted/20 p-0.5">
                {MAP_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setMapStyle(opt.value)}
                    className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
                      mapStyle === opt.value
                        ? "bg-primary/15 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Label toggle */}
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border transition-colors ${
                showLabels
                  ? "border-primary/30 text-primary bg-primary/5"
                  : "border-border/40 text-muted-foreground"
              }`}
              title={showLabels ? "Hide marker labels" : "Show marker labels"}
            >
              {showLabels ? <Tag className="h-3 w-3" /> : <Tags className="h-3 w-3" />}
              Labels
            </button>

            <Button
              size="sm"
              variant="outline"
              onClick={captureSnapshot}
              disabled={capturing}
            >
              {capturing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Camera className="h-3.5 w-3.5 mr-1.5" />
              )}
              Export Map
            </Button>
          </div>
        </div>

        {/* Row 2: Layer toggles */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Layers className="h-3.5 w-3.5 text-muted-foreground mr-1" />
          {(Object.entries(LAYER_CONFIG) as Array<[LayerKey, typeof LAYER_CONFIG[LayerKey]]>).map(([key, cfg]) => {
            const active = visibleLayers.has(key);
            const count = layerCounts[key] || 0;
            return (
              <button
                key={key}
                onClick={() => toggleLayer(key)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-full border transition-all ${
                  active
                    ? "border-border/60 bg-card text-foreground"
                    : "border-transparent bg-muted/20 text-muted-foreground/50"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: active ? cfg.color : "transparent", border: active ? "none" : `1px solid ${cfg.color}40` }}
                />
                {cfg.label}
                {count > 0 && <span className="text-[9px] text-muted-foreground">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Map ──────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="border border-border/40 rounded-xl overflow-hidden bg-card relative"
        style={{ height }}
      >
        {/* Title overlay on the map (included in snapshot) */}
        <div className="absolute top-3 left-3 z-[1000] bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-lg">
          <div className="text-sm font-semibold text-white">{mapTitle}</div>
        </div>
        <MapContainer
          center={defaultCenter}
          zoom={subject ? 13 : 4}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution={tiles.attribution}
            url={tiles.url}
            {...(tiles.subdomains ? { subdomains: tiles.subdomains } : {})}
            {...(tiles.tileSize ? { tileSize: tiles.tileSize } : {})}
            {...(tiles.zoomOffset != null ? { zoomOffset: tiles.zoomOffset } : {})}
          />
          <TileUpdater url={tiles.url} attribution={tiles.attribution} tileSize={tiles.tileSize} zoomOffset={tiles.zoomOffset} />

          {/* Radius ring */}
          {subject && radiusMiles != null && radiusMiles > 0 && (
            <Circle
              center={[subject.lat, subject.lng]}
              radius={radiusMiles * METERS_PER_MILE}
              pathOptions={{
                color: "#10b981",
                weight: 1.5,
                fillColor: "#10b981",
                fillOpacity: 0.05,
                dashArray: "4 4",
              }}
            />
          )}

          {/* Data points */}
          {allPoints.map((p) => (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={showLabels
                ? createLabeledPin(LAYER_CONFIG[p.layer].color, p.name.length > 20 ? p.name.slice(0, 18) + "…" : p.name)
                : LAYER_CONFIG[p.layer].icon}
            >
              <Popup>
                <div className="space-y-1 text-xs" style={{ minWidth: 160 }}>
                  <div className="font-semibold text-[13px]">{p.name}</div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${LAYER_CONFIG[p.layer].color}20`,
                        color: LAYER_CONFIG[p.layer].color,
                      }}
                    >
                      {p.category}
                    </span>
                    {p.rating != null && (
                      <span className="text-amber-400 text-[10px]">
                        {p.rating}{typeof p.rating === "number" && p.rating <= 5 ? "★" : "/10"}
                      </span>
                    )}
                  </div>
                  {p.detail && (
                    <div className="text-muted-foreground text-[10px]">{p.detail}</div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Subject pin (always on top) */}
          {subject && (
            <Marker position={[subject.lat, subject.lng]} icon={SUBJECT_ICON}>
              <Popup>
                <div className="space-y-1 text-xs" style={{ minWidth: 180 }}>
                  <div className="font-semibold text-[13px]">
                    {subject.name || "Subject Property"}
                  </div>
                  {subject.address && (
                    <div className="text-muted-foreground">{subject.address}</div>
                  )}
                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                    subject
                  </span>
                </div>
              </Popup>
            </Marker>
          )}

          <FitBounds
            points={allPoints}
            subject={subject}
            radiusMiles={radiusMiles}
          />
          <MapRefCapture onMapRef={handleMapRef} />
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-1" data-exclude-snapshot="true">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Subject
        </span>
        {(Object.entries(LAYER_CONFIG) as Array<[LayerKey, typeof LAYER_CONFIG[LayerKey]]>).map(([key, cfg]) => {
          if (!visibleLayers.has(key) || !layerCounts[key]) return null;
          return (
            <span key={key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
              {cfg.label} ({layerCounts[key]})
            </span>
          );
        })}
      </div>
    </div>
  );
}
