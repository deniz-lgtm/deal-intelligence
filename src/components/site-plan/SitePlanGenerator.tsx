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
  Marker,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  MousePointer2, Hexagon, Building2, Undo2, Trash2, Check, X, Ruler,
} from "lucide-react";
import type { SitePlan, SitePlanPoint, SitePlanBuilding } from "@/lib/types";
import { getTileConfig } from "@/lib/map-config";
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

type Tool = "pan" | "parcel" | "building" | "measure";

// ── Handle icons for the active-building resize handles ──────────────────────
//
// Corner handles (square): drag an existing vertex to move it.
// Edge midpoint handles (circle): drag to insert a new vertex at that
// position, pushing the side in/out.
//
// L.divIcon output is plain HTML so we can style with CSS-in-JS — no
// external sprite needed. We build these once at module load.

const VERTEX_HANDLE_ICON = L.divIcon({
  className: "site-plan-vertex-handle",
  html: `<div style="width:10px;height:10px;background:#fff;border:2px solid #3b82f6;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,0.35);cursor:grab"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const EDGE_HANDLE_ICON = L.divIcon({
  className: "site-plan-edge-handle",
  html: `<div style="width:8px;height:8px;background:#3b82f6;border:1.5px solid #fff;border-radius:9999px;opacity:0.7;cursor:grab"></div>`,
  iconSize: [8, 8],
  iconAnchor: [4, 4],
});

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
  // When `bypass` is true (user held a modifier — Alt / Ctrl / Meta), we
  // skip all snapping so the analyst can place a pixel-precise vertex.
  const applySnap = useCallback(
    (raw: SitePlanPoint, bypass = false): SitePlanPoint => {
      if (bypass) return raw;
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

  // Precision-mode hint is just "is a modifier key held right now?". We
  // can't read it from mousemove on Leaflet reliably because the synthetic
  // event doesn't always carry the OS modifier state, so we track it
  // globally on the window.
  const precisionRef = useRef(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      precisionRef.current = e.altKey || e.ctrlKey || e.metaKey;
    };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
    };
  }, []);

  useMapEvents({
    click(e) {
      if (tool === "pan") return;
      const raw: SitePlanPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
      // The native MouseEvent does reliably carry modifier state on click,
      // prefer it over the window-tracked ref when available.
      const native = e.originalEvent as MouseEvent | undefined;
      const bypass = !!(native && (native.altKey || native.ctrlKey || native.metaKey));
      const snapped = applySnap(raw, bypass);
      const d = draftRef.current;

      // If clicking near first vertex with ≥3 existing vertices → close.
      // Only when NOT bypassing snap: in precision mode the analyst may
      // want to place a vertex near the start without accidentally closing.
      // Measure mode is an open polyline, so skip closing there.
      if (tool !== "measure" && !bypass && d.length >= 3 && distanceFt(snapped, d[0]) < 8) {
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
      const native = e.originalEvent as MouseEvent | undefined;
      const bypass = !!(native && (native.altKey || native.ctrlKey || native.metaKey))
        || precisionRef.current;
      setCursor(applySnap(raw, bypass));
    },
    mouseout() {
      setCursor(null);
    },
    dblclick(e) {
      // Swallow the auto-zoom double-click while drawing, and use it to close
      // the polygon instead. Measure mode uses double-click to finish the
      // measurement chain and clear the draft.
      if (tool === "pan") return;
      L.DomEvent.stop(e.originalEvent as unknown as Event);
      if (tool === "measure") {
        setDraft([]);
        return;
      }
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

  // Zoom 20 is where Mapbox satellite-streets starts rendering building
  // addresses / numbers; we default there when we have a deal location so
  // analysts immediately see enough detail to trace a parcel accurately.
  const initialZoom = value.zoom || (fallbackCenter ? 20 : 4);

  // When user picks a different tool, clear the in-progress draft (unless
  // they're resuming drawing on the same layer). Simplest rule: switching
  // tool aborts the draft.
  const switchTool = (t: Tool) => {
    setTool(t);
    setDraft([]);
    setCursor(null);
  };

  // Commit the draft into either the parcel or a new building entry.
  // ── Resize helpers ─────────────────────────────────────────────────────
  // updateBuildingVertex moves vertex i of the given building to a new
  // lat/lng. During drag (commit=false) we push state fast for a smooth
  // polygon follow; on dragend (commit=true) we stamp updated_at so the
  // dirty-detection in the host page picks it up.
  const updateBuildingVertex = useCallback(
    (buildingId: string, index: number, latlng: SitePlanPoint, commit: boolean) => {
      const buildings = value.buildings || [];
      const next = buildings.map((b) => {
        if (b.id !== buildingId) return b;
        if (index < 0 || index >= b.points.length) return b;
        const newPoints = b.points.slice();
        newPoints[index] = latlng;
        return {
          ...b,
          points: newPoints,
          area_sf: Math.round(polygonAreaSf(newPoints)),
        };
      });
      onChange({
        ...value,
        buildings: next,
        ...(commit ? { updated_at: new Date().toISOString() } : {}),
      });
    },
    [value, onChange]
  );

  // insertBuildingVertex splices a new vertex into a building at `index`
  // (so it's placed between index-1 and index). Used by the edge midpoint
  // handles to push a side in/out.
  const insertBuildingVertex = useCallback(
    (buildingId: string, index: number, latlng: SitePlanPoint) => {
      const buildings = value.buildings || [];
      const next = buildings.map((b) => {
        if (b.id !== buildingId) return b;
        const newPoints = b.points.slice();
        newPoints.splice(index, 0, latlng);
        return {
          ...b,
          points: newPoints,
          area_sf: Math.round(polygonAreaSf(newPoints)),
        };
      });
      onChange({
        ...value,
        buildings: next,
        updated_at: new Date().toISOString(),
      });
    },
    [value, onChange]
  );

  // For buildings we append; multi-building sites are just a list of these.
  // The newly-drawn building becomes active so the sidebar focuses it.
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
      // Auto-generate a label "Building N" where N is the next available
      // integer that isn't already in use. Analysts can rename in sidebar.
      const usedLabels = new Set((value.buildings || []).map(b => b.label));
      let n = (value.buildings || []).length + 1;
      while (usedLabels.has(`Building ${n}`)) n++;
      const newBuilding: SitePlanBuilding = {
        id: crypto.randomUUID?.() || `bld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: `Building ${n}`,
        points,
        area_sf: Math.round(area),
      };
      onChange({
        ...value,
        buildings: [...(value.buildings || []), newBuilding],
        active_building_id: newBuilding.id,
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

  // Vertices the drawing surface may snap to — the other polygons that
  // are already on the map. When drawing the parcel we snap to any
  // already-drawn buildings; when drawing a new building we snap to the
  // parcel and every other building vertex.
  const existingVertices = useMemo<SitePlanPoint[]>(() => {
    const all: SitePlanPoint[] = [];
    if (tool === "parcel") {
      for (const b of value.buildings || []) all.push(...b.points);
    } else if (tool === "building") {
      all.push(...value.parcel_points);
      for (const b of value.buildings || []) all.push(...b.points);
    }
    return all;
  }, [tool, value.parcel_points, value.buildings]);

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

  // Running total distance for the measure tool, including the ghost
  // segment if the cursor is on the map. Zero outside measure mode.
  const measureTotalFt = useMemo(() => {
    if (tool !== "measure" || draft.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < draft.length - 1; i++) {
      total += segmentLengthFt(draft[i], draft[i + 1]);
    }
    if (cursor && draft.length >= 1) {
      total += segmentLengthFt(draft[draft.length - 1], cursor);
    }
    return total;
  }, [tool, draft, cursor]);

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
  const MEASURE_COLOR = "#22d3ee";
  const DRAFT_COLOR =
    tool === "parcel" ? PARCEL_COLOR
    : tool === "building" ? BUILDING_COLOR
    : tool === "measure" ? MEASURE_COLOR
    : "#a1a1aa";

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
          <ToolButton
            active={tool === "measure"}
            onClick={() => switchTool("measure")}
            label="Measure"
            icon={<Ruler className="h-3.5 w-3.5 text-cyan-400" />}
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
              className="bg-background text-foreground text-[10px] border border-border/60 rounded px-1 py-0.5 outline-none"
            >
              <option value={0} className="bg-background text-foreground">Off</option>
              <option value={1} className="bg-background text-foreground">1 ft</option>
              <option value={5} className="bg-background text-foreground">5 ft</option>
              <option value={10} className="bg-background text-foreground">10 ft</option>
              <option value={25} className="bg-background text-foreground">25 ft</option>
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
          {/* "Clear buildings" wipes every drawn building. The sidebar
              surfaces per-building delete + rename for more surgical edits. */}
          <button
            disabled={(value.buildings || []).length === 0}
            onClick={() =>
              onChange({
                ...value,
                buildings: [],
                active_building_id: null,
                updated_at: new Date().toISOString(),
              })
            }
            className="h-7 px-2 flex items-center gap-1 rounded-md text-[10px] text-blue-300 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear all buildings"
          >
            <Trash2 className="h-3 w-3" /> Buildings
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
            {tool === "parcel" ? "Tracing parcel"
              : tool === "building" ? "Drawing building footprint"
              : "Measuring distance"}
          </span>
          {tool === "measure" ? (
            <>Click to add point · double-click to clear · Backspace to undo · Esc to cancel · hold ⌥ / Ctrl for precision (no snap)</>
          ) : (
            <>Click to add vertex · first-vertex / double-click / Enter to close · Backspace to undo · Esc to cancel · hold ⌥ / Ctrl for precision (no snap)</>
          )}
          {tool !== "measure" && draft.length >= 3 && (
            <span className="ml-2 text-emerald-300 tabular-nums">
              {Math.round(liveArea).toLocaleString()} SF
            </span>
          )}
          {tool === "measure" && draft.length >= 1 && (
            <span className="ml-2 text-cyan-300 tabular-nums">
              {Math.round(measureTotalFt).toLocaleString()} ft total
            </span>
          )}
        </div>
      )}

      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        maxZoom={22}
        scrollWheelZoom
        doubleClickZoom={false}
        zoomControl={false}
        style={{ height: "100%", width: "100%", background: "#000" }}
      >
        {/* Zoom control placed in the bottom-left out of the way of the
            top toolbars and the bottom-center drawing hint. */}
        <ZoomControl position="bottomleft" />
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

        {/* ── Buildings (one polygon per drawn structure) ── */}
        {(value.buildings || []).map((b) => {
          const isActive = b.id === value.active_building_id;
          return (
            <Polygon
              key={`b-${b.id}`}
              positions={b.points.map(toLatLng)}
              pathOptions={{
                color: BUILDING_COLOR,
                weight: isActive ? 3 : 2,
                fillColor: BUILDING_COLOR,
                fillOpacity: isActive ? 0.35 : 0.2,
              }}
              eventHandlers={{
                click: () => {
                  // Click a building to select it (only when pan tool is
                  // active — avoids hijacking polygon-draw clicks).
                  if (tool === "pan") {
                    onChange({
                      ...value,
                      active_building_id: b.id,
                      updated_at: new Date().toISOString(),
                    });
                  }
                },
              }}
            >
              <Tooltip direction="center" className="site-plan-dim-label">
                {b.label} · {b.area_sf.toLocaleString()} SF
              </Tooltip>
            </Polygon>
          );
        })}
        {/* ── Building vertices / resize handles ──
            Non-active buildings render as passive CircleMarkers.
            The active building instead gets draggable Marker handles:
              • Corner handles (one per vertex) — drag to move that vertex
              • Edge midpoint handles (between each pair of vertices) — drag
                to insert a new vertex at the drop location, giving the
                "push a side in/out" behaviour analysts expect from CAD. */}
        {(value.buildings || []).flatMap((b) => {
          if (b.id !== value.active_building_id) {
            return b.points.map((p, i) => (
              <CircleMarker
                key={`bv-${b.id}-${i}`}
                center={toLatLng(p)}
                radius={3}
                pathOptions={{
                  color: BUILDING_COLOR,
                  fillColor: "#fff",
                  fillOpacity: 1,
                  weight: 2,
                }}
              />
            ));
          }
          // Active building — draggable handles.
          const nodes: React.ReactElement[] = [];
          b.points.forEach((p, i) => {
            // Corner vertex drag handle
            nodes.push(
              <Marker
                key={`bv-${b.id}-${i}`}
                position={toLatLng(p)}
                draggable
                icon={VERTEX_HANDLE_ICON}
                eventHandlers={{
                  drag: (ev) => {
                    // Live geometry update while dragging so the polygon
                    // follows the cursor smoothly. We skip the onChange
                    // roundtrip on every frame (area recalc is cheap) but
                    // keep the draft polygon in sync via onChange because
                    // react-leaflet's Polygon reads positions from props.
                    const ll = (ev as any).latlng || (ev.target as L.Marker).getLatLng();
                    updateBuildingVertex(b.id, i, { lat: ll.lat, lng: ll.lng }, /*commit*/ false);
                  },
                  dragend: (ev) => {
                    const ll = (ev.target as L.Marker).getLatLng();
                    updateBuildingVertex(b.id, i, { lat: ll.lat, lng: ll.lng }, /*commit*/ true);
                  },
                }}
              />
            );
            // Edge-midpoint insert handle (between i and i+1, wrapping).
            const next = b.points[(i + 1) % b.points.length];
            const mid = { lat: (p.lat + next.lat) / 2, lng: (p.lng + next.lng) / 2 };
            nodes.push(
              <Marker
                key={`be-${b.id}-${i}`}
                position={toLatLng(mid)}
                draggable
                icon={EDGE_HANDLE_ICON}
                eventHandlers={{
                  dragstart: (ev) => {
                    // Capture the insert index so subsequent drag/dragend
                    // know where to place the new vertex.
                    (ev.target as any).__insertIndex = i + 1;
                    (ev.target as any).__buildingId = b.id;
                    (ev.target as any).__inserted = false;
                  },
                  drag: (ev) => {
                    const tgt = ev.target as L.Marker & {
                      __insertIndex?: number;
                      __buildingId?: string;
                      __inserted?: boolean;
                    };
                    const ll = tgt.getLatLng();
                    if (!tgt.__inserted && tgt.__insertIndex != null && tgt.__buildingId) {
                      insertBuildingVertex(
                        tgt.__buildingId,
                        tgt.__insertIndex,
                        { lat: ll.lat, lng: ll.lng }
                      );
                      tgt.__inserted = true;
                    } else if (tgt.__insertIndex != null && tgt.__buildingId) {
                      updateBuildingVertex(
                        tgt.__buildingId,
                        tgt.__insertIndex,
                        { lat: ll.lat, lng: ll.lng },
                        false
                      );
                    }
                  },
                  dragend: (ev) => {
                    const tgt = ev.target as L.Marker & {
                      __insertIndex?: number;
                      __buildingId?: string;
                    };
                    if (tgt.__insertIndex != null && tgt.__buildingId) {
                      const ll = tgt.getLatLng();
                      updateBuildingVertex(
                        tgt.__buildingId,
                        tgt.__insertIndex,
                        { lat: ll.lat, lng: ll.lng },
                        true
                      );
                    }
                  },
                }}
              />
            );
          });
          return nodes;
        })}

        {/* ── In-progress draft polygon / measure chain ── */}
        {draft.length >= 2 && (
          <Polyline
            positions={draft.map(toLatLng)}
            pathOptions={{
              color: DRAFT_COLOR,
              weight: tool === "measure" ? 2.5 : 2,
              dashArray: tool === "measure" ? undefined : "4 3",
            }}
          />
        )}
        {/* In measure mode show a per-segment dimension label on each
            committed segment so the analyst can read off the distances
            without counting clicks. */}
        {tool === "measure" && draft.length >= 2 && draft.slice(0, -1).map((p, i) => {
          const next = draft[i + 1];
          const midLat = (p.lat + next.lat) / 2;
          const midLng = (p.lng + next.lng) / 2;
          const lenFt = segmentLengthFt(p, next);
          return (
            <CircleMarker
              key={`ms-${i}`}
              center={[midLat, midLng]}
              radius={0.1}
              pathOptions={{ color: "transparent", weight: 0, opacity: 0 }}
            >
              <Tooltip permanent direction="top" offset={[0, -4]} className="site-plan-dim-label">
                {Math.round(lenFt)} ft
              </Tooltip>
            </CircleMarker>
          );
        })}
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
