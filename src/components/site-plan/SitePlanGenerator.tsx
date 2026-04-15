"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SitePlanGenerator — to-scale satellite drawing surface for tracing the
// parcel boundary, the building footprint, and a setback envelope.
//
// Phase 1: map + drawing/snapping (this file).
// Phase 2 will add the setback inset layer + metrics sidebar. The map surface
// is kept self-contained so the sidebar can live beside it without recouping
// Leaflet state.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  CircleMarker,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  MousePointer2, Hexagon, Building2, Undo2, Trash2, Check, X,
} from "lucide-react";
import type { SitePlan, SitePlanPoint } from "@/lib/types";
import { getTileConfig, hasMapbox } from "@/lib/map-config";
import {
  polygonAreaSf,
  segmentLengthFt,
  snapRightAngle,
  snapToNearestVertex,
  snapToGrid,
  distanceFt,
  insetPolygon,
} from "./site-plan-utils";

// ── Props ────────────────────────────────────────────────────────────────────

export interface SitePlanSetbacks {
  front: number | null;
  side: number | null;
  rear: number | null;
  corner?: number | null;
}

export interface SitePlanGeneratorProps {
  value: SitePlan;
  onChange: (next: SitePlan) => void;
  // Setback values from zoning (live — inset updates as these change).
  // The inset uses the max of the provided values as a conservative
  // buildable envelope (a single-polygon shrink cannot represent per-side
  // setbacks without edge labeling; the sidebar breaks out each value).
  setbacks?: SitePlanSetbacks;
  // Optional fallback center when site_plan has no saved center yet
  fallbackCenter?: { lat: number; lng: number } | null;
  // Optional height
  height?: number;
}

type Tool = "pan" | "parcel" | "building";

// ── Leaflet tile style keeper ────────────────────────────────────────────────

function TileUpdater({ style }: { style: SitePlan["map_style"] }) {
  const map = useMap();
  useEffect(() => {
    // Map our SitePlan.map_style values onto the shared tile config.
    // Satellite is the primary use-case; the other options mirror the rest
    // of the app's map components for consistency.
    const cfg = getTileConfig(style);
    map.eachLayer((layer) => {
      if ((layer as L.TileLayer).getTileUrl) map.removeLayer(layer);
    });
    const layer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      ...(cfg.subdomains ? { subdomains: cfg.subdomains } : {}),
      ...(cfg.tileSize ? { tileSize: cfg.tileSize } : {}),
      ...(cfg.zoomOffset != null ? { zoomOffset: cfg.zoomOffset } : {}),
      maxZoom: 22,
    });
    layer.addTo(map);
  }, [map, style]);
  return null;
}

// ── Cursor style per tool ────────────────────────────────────────────────────

function CursorStyler({ tool }: { tool: Tool }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.style.cursor = tool === "pan" ? "" : "crosshair";
    return () => { el.style.cursor = ""; };
  }, [map, tool]);
  return null;
}

// ── Capture the map ref so the host component can read the center/zoom ──────

function MapRefCapture({ onReady }: { onReady: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onReady(map); }, [map, onReady]);
  return null;
}

// ── Drawing surface: listens for map clicks and cursor moves ─────────────────

interface DrawingSurfaceProps {
  tool: Tool;
  draft: SitePlanPoint[];
  setDraft: React.Dispatch<React.SetStateAction<SitePlanPoint[]>>;
  cursor: SitePlanPoint | null;
  setCursor: (p: SitePlanPoint | null) => void;
  snapRightAngleOn: boolean;
  snapVertexOn: boolean;
  snapGridFt: number;
  existingVertices: SitePlanPoint[];
  onFinish: () => void;
}

function DrawingSurface({
  tool, draft, setDraft, setCursor,
  snapRightAngleOn, snapVertexOn, snapGridFt, existingVertices, onFinish,
}: DrawingSurfaceProps) {
  const map = useMap();

  // Keep a stable reference to `draft` in the closure without triggering
  // useMapEvents reregistration on every vertex added.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Snap a raw click/move point to the best hint available.
  const applySnap = useCallback(
    (raw: SitePlanPoint): SitePlanPoint => {
      let p = raw;
      const d = draftRef.current;

      // Vertex snap — prefer existing draft first vertex (close hint) or
      // the other polygon's vertices.
      if (snapVertexOn) {
        const radiusFt = Math.max(6, 40 / Math.pow(2, map.getZoom() - 18)); // tighter at high zoom
        const candidates = [...existingVertices, ...(d.length ? [d[0]] : [])];
        const v = snapToNearestVertex(p, candidates, radiusFt);
        if (v) p = v;
      }
      // Right-angle snap relative to the prior edge(s) in the current draft.
      if (snapRightAngleOn && d.length >= 1) {
        const prev = d[d.length - 1];
        const prevPrev = d.length >= 2 ? d[d.length - 2] : null;
        p = snapRightAngle(prevPrev, prev, p);
      }
      // Grid snap is last so it wins.
      if (snapGridFt > 0 && d.length >= 1) {
        p = snapToGrid(p, d[0], snapGridFt);
      }
      return p;
    },
    [map, snapVertexOn, snapRightAngleOn, snapGridFt, existingVertices]
  );

  useMapEvents({
    click(e) {
      if (tool === "pan") return;
      const raw: SitePlanPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
      const snapped = applySnap(raw);
      const d = draftRef.current;

      // If clicking near first vertex with ≥3 existing vertices → close.
      if (d.length >= 3 && distanceFt(snapped, d[0]) < 8) {
        onFinish();
        return;
      }
      setDraft((prev) => [...prev, snapped]);
    },
    mousemove(e) {
      if (tool === "pan") {
        setCursor(null);
        return;
      }
      const raw: SitePlanPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
      setCursor(applySnap(raw));
    },
    mouseout() {
      setCursor(null);
    },
    dblclick(e) {
      // Swallow the auto-zoom double-click while drawing, and use it to close
      // the polygon instead.
      if (tool === "pan") return;
      L.DomEvent.stop(e.originalEvent as unknown as Event);
      if (draftRef.current.length >= 3) onFinish();
    },
  });
  return null;
}

// ── Small helper: latlng → leaflet-ready tuple ───────────────────────────────
const toLatLng = (p: SitePlanPoint): [number, number] => [p.lat, p.lng];

// ── The full component ──────────────────────────────────────────────────────

export default function SitePlanGenerator({
  value, onChange, setbacks, fallbackCenter, height = 560,
}: SitePlanGeneratorProps) {
  const [tool, setTool] = useState<Tool>("pan");
  const [draft, setDraft] = useState<SitePlanPoint[]>([]);
  const [cursor, setCursor] = useState<SitePlanPoint | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Derive map center/zoom. Prefer the saved site_plan center, else the deal
  // lat/lng, else a sensible default (middle of the US) — the user will pan
  // immediately anyway if we haven't geocoded the address yet.
  const initialCenter: [number, number] = useMemo(() => {
    if (value.center_lat != null && value.center_lng != null) {
      return [value.center_lat, value.center_lng];
    }
    if (fallbackCenter?.lat && fallbackCenter?.lng) {
      return [fallbackCenter.lat, fallbackCenter.lng];
    }
    return [39.5, -98.35];
  }, [value.center_lat, value.center_lng, fallbackCenter]);

  const initialZoom = value.zoom || (fallbackCenter ? 19 : 4);

  // When user picks a different tool, clear the in-progress draft (unless
  // they're resuming drawing on the same layer). Simplest rule: switching
  // tool aborts the draft.
  const switchTool = (t: Tool) => {
    setTool(t);
    setDraft([]);
    setCursor(null);
  };

  // Commit the draft into either parcel or building polygon.
  const finish = useCallback(() => {
    const points = draft;
    if (points.length < 3) {
      setDraft([]);
      return;
    }
    if (tool === "parcel") {
      const area = polygonAreaSf(points);
      onChange({
        ...value,
        parcel_points: points,
        parcel_area_sf: Math.round(area),
        updated_at: new Date().toISOString(),
      });
    } else if (tool === "building") {
      const area = polygonAreaSf(points);
      onChange({
        ...value,
        building_points: points,
        building_area_sf: Math.round(area),
        updated_at: new Date().toISOString(),
      });
    }
    setDraft([]);
    setTool("pan");
  }, [draft, tool, value, onChange]);

  // Keyboard: Enter to finish, Escape/Backspace to undo last vertex, Esc twice to cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (tool === "pan") return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (draft.length >= 3) finish();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (draft.length > 0) setDraft([]);
        else setTool("pan");
      } else if (e.key === "Backspace" || e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setDraft((prev) => prev.slice(0, -1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, draft, finish]);

  // Existing vertices we can snap to when drawing the other polygon.
  const existingVertices = useMemo(() => {
    if (tool === "parcel") return value.building_points;
    if (tool === "building") return value.parcel_points;
    return [];
  }, [tool, value.parcel_points, value.building_points]);

  // Live ghost polyline from last draft vertex → snapped cursor.
  const ghostLine = useMemo<SitePlanPoint[] | null>(() => {
    if (tool === "pan" || draft.length === 0 || !cursor) return null;
    return [draft[draft.length - 1], cursor];
  }, [tool, draft, cursor]);

  // Live area of the in-progress polygon (if closable).
  const liveArea = useMemo(() => {
    if (tool === "pan" || draft.length < 3) return 0;
    return polygonAreaSf(cursor ? [...draft, cursor] : draft);
  }, [tool, draft, cursor]);

  // Ghost segment dimension label (ft).
  const ghostLenFt = useMemo(() => {
    if (!ghostLine) return 0;
    return segmentLengthFt(ghostLine[0], ghostLine[1]);
  }, [ghostLine]);

  // Save center/zoom back to site_plan after the user pans. We debounce via
  // moveend to avoid spamming onChange.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      // Only update if meaningfully different to avoid render loops.
      if (
        value.center_lat !== c.lat ||
        value.center_lng !== c.lng ||
        value.zoom !== z
      ) {
        onChange({
          ...value,
          center_lat: c.lat,
          center_lng: c.lng,
          zoom: z,
          updated_at: new Date().toISOString(),
        });
      }
    };
    map.on("moveend", handler);
    return () => { map.off("moveend", handler); };
  }, [value, onChange]);

  // Colors — red parcel, blue building, amber setback envelope.
  const PARCEL_COLOR = "#ef4444";
  const BUILDING_COLOR = "#3b82f6";
  const SETBACK_COLOR = "#f59e0b";
  const DRAFT_COLOR = tool === "parcel" ? PARCEL_COLOR : tool === "building" ? BUILDING_COLOR : "#a1a1aa";

  // Setback envelope — inset the parcel by the MAX setback value. We can't
  // know which edge is "Front" without labeling, so we take the most
  // constraining value as a conservative buildable envelope. The metrics
  // sidebar (separate component) still lists each value individually so the
  // analyst can see the underlying requirements.
  const maxSetbackFt = useMemo(() => {
    if (!setbacks) return 0;
    const vals = [setbacks.front, setbacks.side, setbacks.rear, setbacks.corner]
      .map((v) => (v == null ? 0 : Number(v)))
      .filter((v) => v > 0);
    return vals.length ? Math.max(...vals) : 0;
  }, [setbacks]);

  const envelopePolygon = useMemo<SitePlanPoint[]>(() => {
    if (!value.show_setbacks || maxSetbackFt <= 0 || value.parcel_points.length < 3) return [];
    return insetPolygon(value.parcel_points, maxSetbackFt);
  }, [value.show_setbacks, maxSetbackFt, value.parcel_points]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative border border-border/60 rounded-xl overflow-hidden bg-black" style={{ height }}>
      {/* Toolbar (positioned over the map) */}
      <div className="absolute top-3 left-3 z-[500] flex flex-col gap-1.5">
        <div className="bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card p-1 flex items-center gap-1">
          <ToolButton
            active={tool === "pan"}
            onClick={() => switchTool("pan")}
            label="Pan"
            icon={<MousePointer2 className="h-3.5 w-3.5" />}
          />
          <ToolButton
            active={tool === "parcel"}
            onClick={() => switchTool("parcel")}
            label="Parcel"
            icon={<Hexagon className="h-3.5 w-3.5 text-red-400" />}
          />
          <ToolButton
            active={tool === "building"}
            onClick={() => switchTool("building")}
            label="Building"
            icon={<Building2 className="h-3.5 w-3.5 text-blue-400" />}
          />
        </div>

        {tool !== "pan" && (
          <div className="bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card p-1 flex items-center gap-1">
            <button
              onClick={() => setDraft((prev) => prev.slice(0, -1))}
              disabled={draft.length === 0}
              title="Undo last vertex (Backspace)"
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={finish}
              disabled={draft.length < 3}
              title="Finish polygon (Enter / double-click)"
              className="h-7 px-2 flex items-center gap-1 rounded-md text-xs text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="h-3.5 w-3.5" /> Finish
            </button>
            <button
              onClick={() => { setDraft([]); setTool("pan"); }}
              title="Cancel drawing (Esc)"
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Snap toggles */}
        <div className="bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card p-1.5 flex flex-col gap-1 text-[10px]">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value.snap_right_angle}
              onChange={(e) => onChange({ ...value, snap_right_angle: e.target.checked })}
              className="accent-primary h-3 w-3"
            />
            Right-angle snap
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={value.snap_vertex}
              onChange={(e) => onChange({ ...value, snap_vertex: e.target.checked })}
              className="accent-primary h-3 w-3"
            />
            Vertex snap
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            Grid
            <select
              value={value.snap_grid_ft}
              onChange={(e) => onChange({ ...value, snap_grid_ft: parseFloat(e.target.value) || 0 })}
              className="bg-transparent text-[10px] border border-border/60 rounded px-1 py-0.5 outline-none"
            >
              <option value={0}>Off</option>
              <option value={1}>1 ft</option>
              <option value={5}>5 ft</option>
              <option value={10}>10 ft</option>
              <option value={25}>25 ft</option>
            </select>
          </label>
          {maxSetbackFt > 0 && (
            <label className="flex items-center gap-1.5 cursor-pointer pt-1 border-t border-border/40">
              <input
                type="checkbox"
                checked={value.show_setbacks}
                onChange={(e) => onChange({ ...value, show_setbacks: e.target.checked })}
                className="accent-amber-400 h-3 w-3"
              />
              Setback envelope
            </label>
          )}
        </div>
      </div>

      {/* Clear buttons — top right */}
      <div className="absolute top-3 right-3 z-[500] flex flex-col gap-1.5">
        <div className="bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card p-1 flex items-center gap-1">
          <button
            disabled={value.parcel_points.length === 0}
            onClick={() => onChange({ ...value, parcel_points: [], parcel_area_sf: 0, updated_at: new Date().toISOString() })}
            className="h-7 px-2 flex items-center gap-1 rounded-md text-[10px] text-red-300 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear parcel polygon"
          >
            <Trash2 className="h-3 w-3" /> Parcel
          </button>
          <button
            disabled={value.building_points.length === 0}
            onClick={() => onChange({ ...value, building_points: [], building_area_sf: 0, updated_at: new Date().toISOString() })}
            className="h-7 px-2 flex items-center gap-1 rounded-md text-[10px] text-blue-300 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear building polygon"
          >
            <Trash2 className="h-3 w-3" /> Building
          </button>
        </div>

        {/* Tile style picker */}
        <div className="bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card p-1 flex items-center gap-1 text-[10px]">
          {(["satellite", "streets", "light", "dark"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onChange({ ...value, map_style: s })}
              className={`px-2 py-0.5 rounded capitalize ${value.map_style === s ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/60"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Drawing hint */}
      {tool !== "pan" && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="text-foreground font-medium mr-2">
            {tool === "parcel" ? "Tracing parcel" : "Drawing building footprint"}
          </span>
          Click to add vertex · first-vertex / double-click / Enter to close · Backspace to undo · Esc to cancel
          {draft.length >= 3 && (
            <span className="ml-2 text-emerald-300 tabular-nums">
              {Math.round(liveArea).toLocaleString()} SF
            </span>
          )}
        </div>
      )}

      {/* Mapbox token warning */}
      {!hasMapbox() && value.map_style === "satellite" && (
        <div className="absolute bottom-3 right-3 z-[500] bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1 text-[10px] text-amber-300">
          Set NEXT_PUBLIC_MAPBOX_TOKEN for satellite imagery
        </div>
      )}

      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        maxZoom={22}
        scrollWheelZoom
        doubleClickZoom={false}
        style={{ height: "100%", width: "100%", background: "#000" }}
      >
        <TileUpdater style={value.map_style} />
        <CursorStyler tool={tool} />
        <MapRefCapture onReady={(m) => { mapRef.current = m; }} />
        <DrawingSurface
          tool={tool}
          draft={draft}
          setDraft={setDraft}
          cursor={cursor}
          setCursor={setCursor}
          snapRightAngleOn={value.snap_right_angle}
          snapVertexOn={value.snap_vertex}
          snapGridFt={value.snap_grid_ft}
          existingVertices={existingVertices}
          onFinish={finish}
        />

        {/* ── Parcel polygon ── */}
        {value.parcel_points.length >= 3 && (
          <Polygon
            positions={value.parcel_points.map(toLatLng)}
            pathOptions={{
              color: PARCEL_COLOR,
              weight: 2.5,
              fillColor: PARCEL_COLOR,
              fillOpacity: 0.05,
              dashArray: "6 4",
            }}
          />
        )}
        {/* Parcel vertices */}
        {value.parcel_points.map((p, i) => (
          <CircleMarker
            key={`pv-${i}`}
            center={toLatLng(p)}
            radius={4}
            pathOptions={{ color: PARCEL_COLOR, fillColor: "#fff", fillOpacity: 1, weight: 2 }}
          />
        ))}

        {/* ── Setback envelope (inset of parcel by max setback) ── */}
        {envelopePolygon.length >= 3 && (
          <Polygon
            positions={envelopePolygon.map(toLatLng)}
            pathOptions={{
              color: SETBACK_COLOR,
              weight: 1.5,
              fillColor: SETBACK_COLOR,
              fillOpacity: 0.08,
              dashArray: "4 3",
            }}
          >
            <Tooltip direction="center" className="site-plan-dim-label">
              Buildable envelope · {maxSetbackFt} ft setback
            </Tooltip>
          </Polygon>
        )}

        {/* ── Building polygon ── */}
        {value.building_points.length >= 3 && (
          <Polygon
            positions={value.building_points.map(toLatLng)}
            pathOptions={{
              color: BUILDING_COLOR,
              weight: 2.5,
              fillColor: BUILDING_COLOR,
              fillOpacity: 0.3,
            }}
          />
        )}
        {value.building_points.map((p, i) => (
          <CircleMarker
            key={`bv-${i}`}
            center={toLatLng(p)}
            radius={4}
            pathOptions={{ color: BUILDING_COLOR, fillColor: "#fff", fillOpacity: 1, weight: 2 }}
          />
        ))}

        {/* ── In-progress draft polygon ── */}
        {draft.length >= 2 && (
          <Polyline
            positions={draft.map(toLatLng)}
            pathOptions={{ color: DRAFT_COLOR, weight: 2, dashArray: "4 3" }}
          />
        )}
        {draft.map((p, i) => (
          <CircleMarker
            key={`d-${i}`}
            center={toLatLng(p)}
            radius={4}
            pathOptions={{
              color: DRAFT_COLOR,
              fillColor: i === 0 ? DRAFT_COLOR : "#fff",
              fillOpacity: 1,
              weight: 2,
            }}
          />
        ))}

        {/* ── Ghost segment with dimension label ── */}
        {ghostLine && (
          <>
            <Polyline
              positions={ghostLine.map(toLatLng)}
              pathOptions={{ color: DRAFT_COLOR, weight: 1.5, opacity: 0.6, dashArray: "2 4" }}
            />
            <CircleMarker
              center={toLatLng(ghostLine[1])}
              radius={5}
              pathOptions={{ color: DRAFT_COLOR, fillColor: DRAFT_COLOR, fillOpacity: 0.5, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -8]} className="site-plan-dim-label">
                {Math.round(ghostLenFt)} ft
              </Tooltip>
            </CircleMarker>
          </>
        )}
      </MapContainer>

      {/* Minimal CSS for the dimension tooltip to look lightweight over satellite tiles. */}
      <style jsx global>{`
        .site-plan-dim-label.leaflet-tooltip {
          background: rgba(20, 20, 20, 0.85);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.15);
          padding: 2px 6px;
          font-size: 10px;
          font-weight: 600;
          border-radius: 4px;
          box-shadow: none;
        }
        .site-plan-dim-label.leaflet-tooltip::before { display: none; }
      `}</style>
    </div>
  );
}

// ── Small tool button ────────────────────────────────────────────────────────

function ToolButton({
  active, onClick, label, icon,
}: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-2 flex items-center gap-1 rounded-md text-[11px] transition-colors ${
        active ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
