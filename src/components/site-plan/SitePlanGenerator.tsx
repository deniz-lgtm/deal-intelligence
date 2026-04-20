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
  MousePointer2, Hexagon, Building2, Undo2, Trash2, Check, X, Ruler, Scissors,
  Spline as LineIcon, Copy, CopyPlus, Camera, Loader2,
} from "lucide-react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import type { SitePlan, SitePlanPoint, SitePlanBuilding, SitePlanScenario, SitePlanCutout } from "@/lib/types";
import { getTileConfig } from "@/lib/map-config";
import SupplyPipelineLayer, { type PipelineData } from "@/components/site-plan/SupplyPipelineLayer";
import {
  polygonAreaSf,
  polygonPerimeterFt,
  polygonPerimeterFtOpen,
  segmentLengthFt,
  snapRightAngle,
  snapToNearestVertex,
  snapToGrid,
  distanceFt,
  insetPolygon,
  offsetPointsFt,
  nearestEdgeInsertIndex,
  cloneStep,
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
  // Deal ID — required to upload snapshots to the documents store.
  // When omitted, the Snapshot button is hidden.
  dealId?: string;
}

type Tool = "pan" | "parcel" | "building" | "cutout" | "frontage" | "measure";

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
//
// Mapbox tiles can fail to load for a handful of reasons that are
// specific to the viewing user rather than the deploy:
//   • Ad blockers (uBlock Origin, Brave Shields, Pi-hole) block
//     api.mapbox.com by default.
//   • Corporate / VPN firewalls block Mapbox.
//   • Mapbox token URL whitelist doesn't include the user's hostname.
//   • Token is over quota.
//
// When any of these trigger, Mapbox returns 401 / 403 / net-err and
// Leaflet renders a blank map. Below we detect the first tile error
// and swap the whole layer to CARTO (free, no-auth) so users always
// see SOMETHING. The satellite fallback uses CARTO's voyager basemap
// since CARTO doesn't ship a free satellite layer.

const CARTO_FALLBACK: Record<SitePlan["map_style"], { url: string; attribution: string; subdomains: string[] }> = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: ["a", "b", "c", "d"],
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: ["a", "b", "c", "d"],
  },
  streets: {
    url: "https://{s}.basemaps.cartocdn.com/voyager/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: ["a", "b", "c", "d"],
  },
  satellite: {
    // CARTO has no free satellite tiles — fall back to the Esri World
    // Imagery layer, which allows attribution-only usage.
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Tiles &copy; Esri — World Imagery',
    subdomains: [],
  },
};

function TileUpdater({
  style,
  onFallback,
}: {
  style: SitePlan["map_style"];
  onFallback: () => void;
}) {
  const map = useMap();
  useEffect(() => {
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

    // Track tile errors. One stray 404 happens normally at the edge of
    // the world; we only swap the layer if the viewport sees multiple
    // failures in quick succession (typical of a blocked host).
    let errorCount = 0;
    let swapped = false;
    const onTileError = () => {
      errorCount++;
      if (errorCount < 3 || swapped) return;
      swapped = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[site-plan-map] Mapbox tiles failed repeatedly — falling back to CARTO/Esri."
      );
      map.removeLayer(layer);
      const fallback = CARTO_FALLBACK[style] || CARTO_FALLBACK.dark;
      const fallbackLayer = L.tileLayer(fallback.url, {
        attribution: fallback.attribution,
        ...(fallback.subdomains.length > 0 ? { subdomains: fallback.subdomains } : {}),
        maxZoom: 20,
      });
      fallbackLayer.addTo(map);
      onFallback();
    };
    layer.on("tileerror", onTileError);
    layer.addTo(map);
    return () => {
      layer.off("tileerror", onTileError);
    };
  }, [map, style, onFallback]);
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

// ── Whole-polygon translate handler ──────────────────────────────────────────
//
// Reads the parent's translateRef on every mouse event. When a drag is in
// progress it offsets all points of the active building by the distance
// between the cursor and the mousedown anchor, then commits on mouseup.
// Map panning is disabled by the polygon's mousedown so the translate
// doesn't fight the built-in map drag.

interface TranslateHandlerProps {
  translateRef: React.MutableRefObject<{
    buildingId: string;
    startLatLng: L.LatLng;
    origPoints: SitePlanPoint[];
    lastPoints: SitePlanPoint[];
    moved: boolean;
  } | null>;
  onTranslate: (buildingId: string, points: SitePlanPoint[], commit: boolean) => void;
  onEnd: () => void;
}

function TranslateHandler({ translateRef, onTranslate, onEnd }: TranslateHandlerProps) {
  useMapEvents({
    mousemove(e) {
      const t = translateRef.current;
      if (!t) return;
      const dLat = e.latlng.lat - t.startLatLng.lat;
      const dLng = e.latlng.lng - t.startLatLng.lng;
      const newPoints = t.origPoints.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng }));
      t.lastPoints = newPoints;
      t.moved = true;
      onTranslate(t.buildingId, newPoints, false);
    },
    mouseup() {
      const t = translateRef.current;
      if (!t) return;
      if (t.moved) onTranslate(t.buildingId, t.lastPoints, true);
      translateRef.current = null;
      onEnd();
    },
  });
  return null;
}

// ── Drawing surface: listens for map clicks and cursor moves ─────────────────

interface DrawingSurfaceProps {
  tool: Tool;
  draft: SitePlanPoint[];
  setDraft: React.Dispatch<React.SetStateAction<SitePlanPoint[]>>;
  setCursor: (p: SitePlanPoint | null) => void;
  snapRightAngleOn: boolean;
  snapVertexOn: boolean;
  snapGridFt: number;
  existingVertices: SitePlanPoint[];
  onFinish: () => void;
  // When the user holds space mid-draw, this ref flips to true and the
  // surface behaves like pan mode (no vertex placement, no cursor hint).
  // Implemented as a ref so the keydown/keyup listeners don't have to
  // re-register the map event handlers every time the state flips.
  panOverrideRef: React.MutableRefObject<boolean>;
}

function DrawingSurface({
  tool, draft, setDraft, setCursor,
  snapRightAngleOn, snapVertexOn, snapGridFt, existingVertices, onFinish,
  panOverrideRef,
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
      // Space-held "pan while drawing" override — skip vertex placement.
      if (tool === "pan" || panOverrideRef.current) return;
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
      // Frontage is an open polyline and measure doesn't close either —
      // both exit the close-on-first-vertex shortcut so they don't
      // accidentally terminate on a nearby click.
      if (tool !== "measure" && tool !== "frontage" && !bypass && d.length >= 3 && distanceFt(snapped, d[0]) < 8) {
        onFinish();
        return;
      }
      setDraft((prev) => [...prev, snapped]);
    },
    mousemove(e) {
      if (tool === "pan" || panOverrideRef.current) {
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
      // the polygon (or finish the open polyline) instead.
      if (tool === "pan") return;
      L.DomEvent.stop(e.originalEvent as unknown as Event);
      if (tool === "measure") {
        // Measurements are ephemeral — clear on double-click.
        setDraft([]);
        return;
      }
      // Frontage is an open polyline and finishes on ≥2 points.
      const minPoints = tool === "frontage" ? 2 : 3;
      if (draftRef.current.length >= minPoints) onFinish();
    },
  });
  return null;
}

// ── Small helper: latlng → leaflet-ready tuple ───────────────────────────────
const toLatLng = (p: SitePlanPoint): [number, number] => [p.lat, p.lng];

// ── Cursor pub/sub ───────────────────────────────────────────────────────────
// Cursor position (a SitePlanPoint | null) moves on every mousemove. If we
// stored it in useState on SitePlanGenerator, every mousemove would rerender
// the entire map tree (thousands of Leaflet nodes on a built-out plan) and
// cause the click-point jank. Instead the parent owns a ref + listener set;
// the child components that actually need cursor subscribe via this hook
// and are the only things that rerender ~60×/s.
type CursorListenersRef = React.MutableRefObject<Set<(p: SitePlanPoint | null) => void>>;
type CursorRef = React.MutableRefObject<SitePlanPoint | null>;

function useCursorSubscription(listenersRef: CursorListenersRef, cursorRef: CursorRef) {
  const [c, setC] = useState<SitePlanPoint | null>(cursorRef.current);
  useEffect(() => {
    const fn = (p: SitePlanPoint | null) => setC(p);
    const set = listenersRef.current;
    set.add(fn);
    return () => { set.delete(fn); };
  }, [listenersRef]);
  return c;
}

// Ghost polyline from the last committed draft vertex to the snapped cursor
// position, plus a dimension label on the cursor end. Renders inside the
// MapContainer. Self-updates on cursor changes without bubbling to the parent.
function GhostOverlay({
  tool, draft, listenersRef, cursorRef, draftColor,
}: {
  tool: Tool;
  draft: SitePlanPoint[];
  listenersRef: CursorListenersRef;
  cursorRef: CursorRef;
  draftColor: string;
}) {
  const cursor = useCursorSubscription(listenersRef, cursorRef);
  if (tool === "pan" || draft.length === 0 || !cursor) return null;
  const a = draft[draft.length - 1];
  const lenFt = segmentLengthFt(a, cursor);
  return (
    <>
      <Polyline
        positions={[a, cursor].map(toLatLng)}
        pathOptions={{ color: draftColor, weight: 1.5, opacity: 0.6, dashArray: "2 4" }}
      />
      <CircleMarker
        center={toLatLng(cursor)}
        radius={5}
        pathOptions={{ color: draftColor, fillColor: draftColor, fillOpacity: 0.5, weight: 2 }}
      >
        <Tooltip permanent direction="top" offset={[0, -8]} className="site-plan-dim-label">
          {Math.round(lenFt)} ft
        </Tooltip>
      </CircleMarker>
    </>
  );
}

// Live SF / LF / measure-total span in the bottom-center drawing hint.
// Same isolation trick as GhostOverlay — only this tiny span rerenders on
// mousemove.
function LiveMetricsLabel({
  tool, draft, listenersRef, cursorRef,
}: {
  tool: Tool;
  draft: SitePlanPoint[];
  listenersRef: CursorListenersRef;
  cursorRef: CursorRef;
}) {
  const cursor = useCursorSubscription(listenersRef, cursorRef);
  if (tool !== "measure" && tool !== "frontage" && draft.length >= 3) {
    const liveArea = polygonAreaSf(cursor ? [...draft, cursor] : draft);
    return (
      <span className="ml-2 text-emerald-300 tabular-nums">
        {Math.round(liveArea).toLocaleString()} SF
      </span>
    );
  }
  if (tool === "frontage" && draft.length >= 2) {
    let total = 0;
    for (let i = 0; i < draft.length - 1; i++) total += segmentLengthFt(draft[i], draft[i + 1]);
    if (cursor) total += segmentLengthFt(draft[draft.length - 1], cursor);
    return (
      <span className="ml-2 text-amber-300 tabular-nums">
        {Math.round(total).toLocaleString()} LF
      </span>
    );
  }
  if (tool === "measure" && draft.length >= 1) {
    let total = 0;
    for (let i = 0; i < draft.length - 1; i++) total += segmentLengthFt(draft[i], draft[i + 1]);
    if (cursor) total += segmentLengthFt(draft[draft.length - 1], cursor);
    return (
      <span className="ml-2 text-cyan-300 tabular-nums">
        {Math.round(total).toLocaleString()} ft total
      </span>
    );
  }
  return null;
}

// ── The full component ──────────────────────────────────────────────────────

export default function SitePlanGenerator({
  value, onChange, setbacks, fallbackCenter, height = 560, dealId,
}: SitePlanGeneratorProps) {
  const [tool, setTool] = useState<Tool>("pan");
  // Set when Mapbox tiles fail and we auto-fall-back to CARTO/Esri, so
  // we can show an in-map hint to the user.
  const [tilesFallback, setTilesFallback] = useState(false);
  // Supply-pipeline overlay — pulls under-construction / planned projects
  // from every uploaded market report for this deal and plots them on the
  // map so the developer can see competing supply relative to their parcel.
  const [showPipeline, setShowPipeline] = useState(false);
  const [pipelineRadiusMi, setPipelineRadiusMi] = useState(3);
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);
  const [draft, setDraft] = useState<SitePlanPoint[]>([]);
  // Cursor position is tracked via a ref + listener set rather than
  // useState to avoid re-rendering the entire map tree on every
  // mousemove. Only the small overlay children that depend on cursor
  // subscribe to updates. Pre-refactor this was ~thousands of leaflet
  // nodes rebuilt per mousemove — the click-point jank the user saw.
  const cursorRef = useRef<SitePlanPoint | null>(null);
  const cursorListenersRef = useRef<Set<(p: SitePlanPoint | null) => void>>(new Set());
  const setCursor = useCallback((p: SitePlanPoint | null) => {
    cursorRef.current = p;
    for (const fn of cursorListenersRef.current) fn(p);
  }, []);
  const [snapshotting, setSnapshotting] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  // "Hold space to pan" override — a ref the DrawingSurface reads. We
  // mirror it into a piece of state (spaceHeld) only so we can render a
  // small hint in the drawing bar; the ref is what the map-event
  // handlers actually check (state lags behind keydown by a frame).
  const panOverrideRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

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
  //
  // Special-case: switching to Frontage with an existing frontage already
  // saved seeds the draft from those points so the analyst can continue
  // editing (undo vertices, append, then Finish to overwrite). Without
  // this, the Frontage tool only ever *creates* a new frontage and the
  // only way to edit was to redraw from scratch.
  const switchTool = (t: Tool) => {
    setTool(t);
    const scen = (value.scenarios || []).find((s) => s.id === value.active_scenario_id);
    if (t === "frontage" && scen?.frontage_points && scen.frontage_points.length >= 2) {
      setDraft(scen.frontage_points);
    } else {
      setDraft([]);
    }
    setCursor(null);
  };

  // ── Scenario plumbing ──────────────────────────────────────────────────
  // Everything the generator reads and writes lives on the *active*
  // scenario. The map view / snap settings stay at the top level so they
  // survive scenario switches. These derived values keep the rest of the
  // component looking like it's editing a single scenario, hiding the
  // scenarios[] wrapper from each call site.
  const activeScen = (value.scenarios || []).find(
    (s) => s.id === value.active_scenario_id
  ) || null;
  const parcelPoints = activeScen?.parcel_points || [];
  const parcelAreaSf = activeScen?.parcel_area_sf || 0;
  const buildings = activeScen?.buildings || [];
  const activeBuildingId = activeScen?.active_building_id ?? null;

  // Mutate the active scenario. `commit=false` updates without stamping
  // `updated_at` — used during drags so each frame doesn't thrash the
  // dirty-state detection in the host page.
  const updateActiveScenario = useCallback(
    (mutator: (scen: SitePlanScenario) => SitePlanScenario, commit = true) => {
      const scenarios = value.scenarios || [];
      const activeId = value.active_scenario_id;
      if (!activeId) return;
      const nextScenarios = scenarios.map((s) => (s.id === activeId ? mutator(s) : s));
      onChange({
        ...value,
        scenarios: nextScenarios,
        ...(commit ? { updated_at: new Date().toISOString() } : {}),
      });
    },
    [value, onChange]
  );

  // Commit the draft into either the parcel or a new building entry.
  // ── Resize helpers ─────────────────────────────────────────────────────
  // updateBuildingVertex moves vertex i of the given building to a new
  // lat/lng. During drag (commit=false) we push state fast for a smooth
  // polygon follow; on dragend (commit=true) we stamp updated_at so the
  // dirty-detection in the host page picks it up.
  const updateBuildingVertex = useCallback(
    (buildingId: string, index: number, latlng: SitePlanPoint, commit: boolean) => {
      updateActiveScenario((scen) => {
        const nextBuildings = scen.buildings.map((b) => {
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
        return { ...scen, buildings: nextBuildings };
      }, commit);
    },
    [updateActiveScenario]
  );

  // insertBuildingVertex splices a new vertex into a building at `index`
  // (so it's placed between index-1 and index). Used by the edge midpoint
  // handles to push a side in/out.
  const insertBuildingVertex = useCallback(
    (buildingId: string, index: number, latlng: SitePlanPoint) => {
      updateActiveScenario((scen) => {
        const nextBuildings = scen.buildings.map((b) => {
          if (b.id !== buildingId) return b;
          const newPoints = b.points.slice();
          newPoints.splice(index, 0, latlng);
          return {
            ...b,
            points: newPoints,
            area_sf: Math.round(polygonAreaSf(newPoints)),
          };
        });
        return { ...scen, buildings: nextBuildings };
      });
    },
    [updateActiveScenario]
  );

  // Clone a building with its points offset by (dxFt, dyFt) and its
  // cutouts carried along. Generates a fresh id/label. Used by the
  // Cmd+D duplicate shortcut and the array-duplicate helper.
  // Capture the current map view as a PNG and upload it to the deal's
  // Documents store. Uses html-to-image on the MapContainer DOM element
  // so tile layers + vector overlays are both captured. Requires
  // dealId prop to be set (parent page passes params.id).
  const takeSnapshot = useCallback(async () => {
    if (!dealId) return;
    const map = mapRef.current;
    if (!map) { toast.error("Map not ready"); return; }
    const container = map.getContainer();
    setSnapshotting(true);
    try {
      // useCORS on tile images — Mapbox / CARTO / Esri all send the
      // right headers. skipFonts avoids a slow Google Fonts roundtrip
      // that html-to-image tries by default.
      const dataUrl = await toPng(container, {
        cacheBust: true,
        skipFonts: true,
        pixelRatio: 2,
      });
      const blob = await (await fetch(dataUrl)).blob();
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const scen = (value.scenarios || []).find((s) => s.id === value.active_scenario_id);
      const scenName = scen?.name ? scen.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() : "base";
      const file = new File([blob], `site-plan-${scenName}-${ts}.png`, { type: "image/png" });
      const form = new FormData();
      form.append("deal_id", dealId);
      form.append("files", file);
      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Snapshot upload failed");
        return;
      }
      toast.success(`Snapshot saved to Documents — ${file.name}`);
    } catch (err) {
      // Most common cause: a cross-origin tile failed to load into the
      // canvas. We surface the generic error — no way to recover
      // automatically without changing tile CORS.
      console.error("Snapshot error", err);
      toast.error("Snapshot failed — try again or refresh the map");
    } finally {
      setSnapshotting(false);
    }
  }, [dealId, value]);

  const duplicateBuilding = useCallback(
    (buildingId: string, offsetsFt: Array<[number, number]>) => {
      updateActiveScenario((scen) => {
        const src = scen.buildings.find((b) => b.id === buildingId);
        if (!src) return scen;
        const existingLabels = new Set(scen.buildings.map((b) => b.label));
        let n = scen.buildings.length + 1;
        const clones: SitePlanBuilding[] = [];
        for (const [dx, dy] of offsetsFt) {
          const newPoints = offsetPointsFt(src.points, dx, dy);
          while (existingLabels.has(`Building ${n}`)) n++;
          const label = `Building ${n}`;
          existingLabels.add(label);
          n++;
          const genId = () =>
            typeof crypto !== "undefined" && typeof (crypto as { randomUUID?: () => string }).randomUUID === "function"
              ? (crypto as { randomUUID: () => string }).randomUUID()
              : `bld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          clones.push({
            id: genId(),
            label,
            points: newPoints,
            area_sf: Math.round(polygonAreaSf(newPoints)),
            cutouts: src.cutouts?.map((c) => ({
              ...c,
              id: genId(),
              points: offsetPointsFt(c.points, dx, dy),
              area_sf: Math.round(polygonAreaSf(offsetPointsFt(c.points, dx, dy))),
            })),
          });
        }
        return {
          ...scen,
          buildings: [...scen.buildings, ...clones],
          active_building_id: clones[clones.length - 1]?.id ?? scen.active_building_id,
        };
      });
    },
    [updateActiveScenario]
  );

  // deleteBuildingVertex removes a vertex at `index`. Enforces a minimum
  // of 3 vertices (a polygon can't degenerate into a line). Called from
  // the right-click / context-menu handler on a vertex handle.
  const deleteBuildingVertex = useCallback(
    (buildingId: string, index: number) => {
      updateActiveScenario((scen) => {
        const nextBuildings = scen.buildings.map((b) => {
          if (b.id !== buildingId) return b;
          if (b.points.length <= 3) return b;
          if (index < 0 || index >= b.points.length) return b;
          const newPoints = b.points.slice();
          newPoints.splice(index, 1);
          return {
            ...b,
            points: newPoints,
            area_sf: Math.round(polygonAreaSf(newPoints)),
          };
        });
        return { ...scen, buildings: nextBuildings };
      });
    },
    [updateActiveScenario]
  );

  // Rewrite every point of a building at once — used by the whole-polygon
  // translate (drag the footprint body to move it). Area under pure
  // translation is unchanged but we recompute anyway so the value stays
  // authoritative if the caller passes reshaped points for any reason.
  const translateBuilding = useCallback(
    (buildingId: string, newPoints: SitePlanPoint[], commit: boolean) => {
      updateActiveScenario((scen) => {
        const nextBuildings = scen.buildings.map((b) =>
          b.id === buildingId
            ? {
                ...b,
                points: newPoints,
                area_sf: Math.round(polygonAreaSf(newPoints)),
              }
            : b
        );
        return { ...scen, buildings: nextBuildings };
      }, commit);
    },
    [updateActiveScenario]
  );

  // Ref-backed translate state. A ref (not useState) is important so the
  // TranslateHandler's map event listeners can read the latest state
  // without re-registering on every mouse move, which would tank drag
  // smoothness.
  const translateRef = useRef<{
    buildingId: string;
    startLatLng: L.LatLng;
    origPoints: SitePlanPoint[];
    lastPoints: SitePlanPoint[];
    moved: boolean;
  } | null>(null);

  // For buildings we append; multi-building sites are just a list of these.
  // The newly-drawn building becomes active so the sidebar focuses it.
  const finish = useCallback(() => {
    const points = draft;
    // Frontage is an open polyline — finishes with 2+ points, not 3+.
    const minPoints = tool === "frontage" ? 2 : 3;
    if (points.length < minPoints) {
      setDraft([]);
      return;
    }
    if (tool === "parcel") {
      const area = polygonAreaSf(points);
      updateActiveScenario((scen) => ({
        ...scen,
        parcel_points: points,
        parcel_area_sf: Math.round(area),
      }));
    } else if (tool === "building") {
      const area = polygonAreaSf(points);
      updateActiveScenario((scen) => {
        const usedLabels = new Set(scen.buildings.map((b) => b.label));
        let n = scen.buildings.length + 1;
        while (usedLabels.has(`Building ${n}`)) n++;
        const newBuilding: SitePlanBuilding = {
          id:
            (typeof crypto !== "undefined" && typeof (crypto as { randomUUID?: () => string }).randomUUID === "function"
              ? (crypto as { randomUUID: () => string }).randomUUID()
              : `bld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
          label: `Building ${n}`,
          points,
          area_sf: Math.round(area),
        };
        return {
          ...scen,
          buildings: [...scen.buildings, newBuilding],
          active_building_id: newBuilding.id,
        };
      });
    } else if (tool === "cutout") {
      // Cutouts attach to the currently active building. No active
      // building = no-op (shouldn't happen because the toolbar gates
      // the Cutout button, but belt-and-braces).
      const area = polygonAreaSf(points);
      updateActiveScenario((scen) => {
        const activeBid = scen.active_building_id;
        if (!activeBid) return scen;
        return {
          ...scen,
          buildings: scen.buildings.map((b) => {
            if (b.id !== activeBid) return b;
            const existing = b.cutouts || [];
            const usedLabels = new Set(existing.map((c) => c.label));
            let n = existing.length + 1;
            while (usedLabels.has(`Cutout ${n}`)) n++;
            const newCutout: SitePlanCutout = {
              id:
                (typeof crypto !== "undefined" && typeof (crypto as { randomUUID?: () => string }).randomUUID === "function"
                  ? (crypto as { randomUUID: () => string }).randomUUID()
                  : `cut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
              label: `Cutout ${n}`,
              points,
              area_sf: Math.round(area),
            };
            return { ...b, cutouts: [...existing, newCutout] };
          }),
        };
      });
    } else if (tool === "frontage") {
      // Frontage = open polyline stored on the scenario. Length drives
      // linear-SF line items in the dev budget.
      const len = polygonPerimeterFtOpen(points);
      updateActiveScenario((scen) => ({
        ...scen,
        frontage_points: points,
        frontage_length_ft: Math.round(len),
      }));
    }
    setDraft([]);
    setTool("pan");
  }, [draft, tool, updateActiveScenario]);

  // Keyboard: Enter to finish, Escape/Backspace to undo last vertex, Esc twice to cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (tool === "pan") return;
      if (e.key === "Enter") {
        e.preventDefault();
        // Frontage is an open polyline and finishes on ≥2 points; all
        // other tools close a polygon and need ≥3.
        const minPoints = tool === "frontage" ? 2 : 3;
        if (draft.length >= minPoints) finish();
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

  // Duplicate the active building: Cmd/Ctrl+D → single clone offset
  // east by its own width + 10ft gap, Cmd/Ctrl+Shift+D → 2×2 grid.
  // The step size adapts to the building's bounding box so a 20ft
  // building clones at ~20ft and a 200ft building clones at ~200ft.
  useEffect(() => {
    function onDup(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "d") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const src = buildings.find((b) => b.id === activeBuildingId);
      if (!src) return;
      e.preventDefault();
      const { stepX, stepY } = cloneStep(src.points);
      if (e.shiftKey) {
        duplicateBuilding(src.id, [
          [stepX, 0],
          [0, -stepY],
          [stepX, -stepY],
        ]);
      } else {
        duplicateBuilding(src.id, [[stepX, 0]]);
      }
    }
    window.addEventListener("keydown", onDup);
    return () => window.removeEventListener("keydown", onDup);
  }, [duplicateBuilding, buildings, activeBuildingId]);

  // Hold space to pan mid-draw. Skip when focus is on a text input
  // (typing a space shouldn't hijack the map), and stop propagation so
  // we don't also scroll the page. The ref flips immediately for the
  // map handlers; the state flip drives the UI hint.
  useEffect(() => {
    function onSpaceDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (tool === "pan") return;
      e.preventDefault();
      if (!panOverrideRef.current) {
        panOverrideRef.current = true;
        setSpaceHeld(true);
        setCursor(null);
      }
    }
    function onSpaceUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (panOverrideRef.current) {
        panOverrideRef.current = false;
        setSpaceHeld(false);
      }
    }
    window.addEventListener("keydown", onSpaceDown);
    window.addEventListener("keyup", onSpaceUp);
    return () => {
      window.removeEventListener("keydown", onSpaceDown);
      window.removeEventListener("keyup", onSpaceUp);
    };
  }, [tool]);

  // Vertices the drawing surface may snap to — the other polygons that
  // are already on the map. When drawing the parcel we snap to any
  // already-drawn buildings; when drawing a new building we snap to the
  // parcel and every other building vertex.
  const existingVertices = useMemo<SitePlanPoint[]>(() => {
    const all: SitePlanPoint[] = [];
    if (tool === "parcel") {
      for (const b of buildings) all.push(...b.points);
    } else if (tool === "building") {
      all.push(...parcelPoints);
      for (const b of buildings) all.push(...b.points);
    }
    return all;
  }, [tool, parcelPoints, buildings]);

  // Ghost polyline / live area / measure-total all depend on cursor, which
  // updates every mousemove. They're computed inside the GhostOverlay /
  // LiveMetricsLabel child components (which subscribe to cursorListenersRef)
  // so the parent component doesn't re-render ~60 times a second while
  // the user is drawing.

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
  const CUTOUT_COLOR = "#f472b6";    // pink — "void inside the building"
  const FRONTAGE_COLOR = "#fbbf24";  // amber — reads as a different kind of linework
  const DRAFT_COLOR =
    tool === "parcel" ? PARCEL_COLOR
    : tool === "building" ? BUILDING_COLOR
    : tool === "cutout" ? CUTOUT_COLOR
    : tool === "frontage" ? FRONTAGE_COLOR
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
    if (!value.show_setbacks || maxSetbackFt <= 0 || parcelPoints.length < 3) return [];
    return insetPolygon(parcelPoints, maxSetbackFt);
  }, [value.show_setbacks, maxSetbackFt, parcelPoints]);

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
          {/* Cutout requires an active building — render disabled when
              no building has been drawn / selected. */}
          <ToolButton
            active={tool === "cutout"}
            onClick={() => switchTool("cutout")}
            label="Cutout"
            icon={<Scissors className="h-3.5 w-3.5 text-pink-400" />}
            disabled={!activeBuildingId}
            title={
              activeBuildingId
                ? "Draw a courtyard / light well inside the active building"
                : "Select a building first"
            }
          />
          <ToolButton
            active={tool === "frontage"}
            onClick={() => switchTool("frontage")}
            label="Frontage"
            icon={<LineIcon className="h-3.5 w-3.5 text-amber-400" />}
            title="Draw the parcel's street frontage — linear SF flows into dev-budget line items"
          />
          <ToolButton
            active={tool === "measure"}
            onClick={() => switchTool("measure")}
            label="Measure"
            icon={<Ruler className="h-3.5 w-3.5 text-cyan-400" />}
          />
          {/* Snapshot — captures the current map view and saves it to
              the deal's Documents store. Disabled when no dealId is
              wired (render site of SitePlanGenerator forgot to pass it). */}
          {dealId && (
            <ToolButton
              active={false}
              disabled={snapshotting}
              onClick={takeSnapshot}
              label={snapshotting ? "Saving..." : "Snapshot"}
              icon={snapshotting
                ? <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin" />
                : <Camera className="h-3.5 w-3.5 text-emerald-400" />}
              title="Save the current map view as a PNG to Documents"
            />
          )}
        </div>

        {/* Duplicate / Array — only shown when a building is selected
            and no draw is in progress. Keyboard alternates:
            Cmd/Ctrl+D (single copy east) · Cmd/Ctrl+Shift+D (2×2 grid). */}
        {tool === "pan" && activeBuildingId && (
          <div className="bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card p-1 flex items-center gap-1">
            <button
              onClick={() => {
                const src = buildings.find((b) => b.id === activeBuildingId);
                if (!src) return;
                const { stepX } = cloneStep(src.points);
                duplicateBuilding(src.id, [[stepX, 0]]);
              }}
              title="Duplicate active building (⌘D) — places a copy one width east"
              className="h-7 px-2 flex items-center gap-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60"
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicate
            </button>
            <button
              onClick={() => {
                const src = buildings.find((b) => b.id === activeBuildingId);
                if (!src) return;
                const { stepX, stepY } = cloneStep(src.points);
                duplicateBuilding(src.id, [[stepX, 0], [0, -stepY], [stepX, -stepY]]);
              }}
              title="Array (⌘⇧D) — 2×2 grid of the active building"
              className="h-7 px-2 flex items-center gap-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60"
            >
              <CopyPlus className="h-3.5 w-3.5" />
              2×2
            </button>
          </div>
        )}

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
              disabled={draft.length < (tool === "frontage" ? 2 : 3)}
              title={tool === "frontage" ? "Finish frontage (Enter / double-click)" : "Finish polygon (Enter / double-click)"}
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
          {/* Supply pipeline overlay — pulls nearby under-construction /
              planned projects from uploaded market reports so the developer
              can see competing supply around their parcel. Requires dealId. */}
          {dealId && (
            <div className="pt-1 border-t border-border/40 space-y-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPipeline}
                  onChange={(e) => setShowPipeline(e.target.checked)}
                  className="accent-red-400 h-3 w-3"
                />
                <span>Supply pipeline</span>
                {showPipeline && pipelineData && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {pipelineData.mapped.length} on map · {pipelineData.totals.total_units.toLocaleString()} units
                  </span>
                )}
              </label>
              {showPipeline && (
                <label className="flex items-center gap-1.5 text-[11px] pl-5">
                  <span className="text-muted-foreground">Radius</span>
                  <select
                    value={pipelineRadiusMi}
                    onChange={(e) => setPipelineRadiusMi(Number(e.target.value))}
                    className="bg-background border border-border/40 rounded px-1 py-0.5 text-[10px]"
                  >
                    <option value={1}>1 mi</option>
                    <option value={3}>3 mi</option>
                    <option value={5}>5 mi</option>
                    <option value={10}>10 mi</option>
                    <option value={25}>25 mi</option>
                    <option value={0}>All</option>
                  </select>
                </label>
              )}
              {showPipeline && pipelineData && (
                <div className="text-[10px] text-muted-foreground pl-5 leading-relaxed">
                  <span className="text-red-400">●</span> {pipelineData.totals.under_construction_count} UC ({pipelineData.totals.under_construction_units.toLocaleString()} u) ·{" "}
                  <span className="text-amber-400">●</span> {pipelineData.totals.planned_count} planned ({pipelineData.totals.planned_units.toLocaleString()} u)
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Clear buttons — top right */}
      <div className="absolute top-3 right-3 z-[500] flex flex-col gap-1.5">
        <div className="bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card p-1 flex items-center gap-1">
          <button
            disabled={parcelPoints.length === 0}
            onClick={() =>
              updateActiveScenario((scen) => ({
                ...scen,
                parcel_points: [],
                parcel_area_sf: 0,
              }))
            }
            className="h-7 px-2 flex items-center gap-1 rounded-md text-[10px] text-red-300 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear parcel polygon"
          >
            <Trash2 className="h-3 w-3" /> Parcel
          </button>
          {/* "Clear buildings" wipes every drawn building in the active
              scenario. The sidebar surfaces per-building delete + rename
              for more surgical edits. Other scenarios are untouched. */}
          <button
            disabled={buildings.length === 0}
            onClick={() =>
              updateActiveScenario((scen) => ({
                ...scen,
                buildings: [],
                active_building_id: null,
              }))
            }
            className="h-7 px-2 flex items-center gap-1 rounded-md text-[10px] text-blue-300 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear all buildings"
          >
            <Trash2 className="h-3 w-3" /> Buildings
          </button>
          {/* Clear frontage — only enabled when a frontage is present.
              Lets the analyst wipe and redraw without having to toggle
              into the Frontage tool first. */}
          <button
            disabled={!activeScen?.frontage_points || activeScen.frontage_points.length === 0}
            onClick={() =>
              updateActiveScenario((scen) => ({
                ...scen,
                frontage_points: [],
                frontage_length_ft: 0,
              }))
            }
            className="h-7 px-2 flex items-center gap-1 rounded-md text-[10px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear frontage"
          >
            <Trash2 className="h-3 w-3" /> Frontage
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

      {/* Tile fallback hint — shown when Mapbox tiles failed and we
          auto-swapped to the free CARTO/Esri layers. The analyst still
          sees a map; this just explains why it might look different
          (e.g. lower-res or non-satellite). Most common cause is an
          ad blocker or corporate firewall blocking api.mapbox.com. */}
      {tilesFallback && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-amber-500/15 border border-amber-500/40 text-amber-100 rounded-lg shadow-card px-3 py-1 text-[11px]">
          Using fallback tiles — Mapbox blocked (ad blocker / firewall?).
        </div>
      )}

      {/* Drawing hint */}
      {tool !== "pan" && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-card px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="text-foreground font-medium mr-2">
            {tool === "parcel" ? "Tracing parcel"
              : tool === "building" ? "Drawing building footprint"
              : tool === "cutout" ? "Cutting out courtyard"
              : tool === "frontage" ? "Drawing frontage"
              : "Measuring distance"}
          </span>
          {tool === "measure" ? (
            <>Click to add point · double-click to clear · Backspace to undo · Esc to cancel · hold ⌥ / Ctrl for precision · hold Space to pan</>
          ) : tool === "frontage" ? (
            <>Click to add point · double-click / Enter to finish · Backspace to undo · Esc to cancel · hold ⌥ / Ctrl for precision · hold Space to pan</>
          ) : (
            <>Click to add vertex · first-vertex / double-click / Enter to close · Backspace to undo · Esc to cancel · hold ⌥ / Ctrl for precision · hold Space to pan</>
          )}
          {spaceHeld && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-semibold uppercase tracking-wide">
              Panning
            </span>
          )}
          {/* Live area / linear-foot / measure total — each subscribes
              to cursor via cursorListenersRef so we don't re-render the
              whole hint bar + map container on every mousemove. */}
          <LiveMetricsLabel
            tool={tool}
            draft={draft}
            listenersRef={cursorListenersRef}
            cursorRef={cursorRef}
          />
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
        <TileUpdater
          style={value.map_style}
          onFallback={() => setTilesFallback(true)}
        />
        {/* Nearby supply-pipeline markers. Sits above tiles but below the
            user's drawn polygons so clicks on the parcel / building always
            win. Only mounts when the analyst turns the layer on. */}
        {dealId && (
          <SupplyPipelineLayer
            dealId={dealId}
            enabled={showPipeline}
            radiusMi={pipelineRadiusMi}
            onDataChange={setPipelineData}
          />
        )}
        <CursorStyler tool={tool} />
        <MapRefCapture onReady={(m) => { mapRef.current = m; }} />
        <TranslateHandler
          translateRef={translateRef}
          onTranslate={translateBuilding}
          onEnd={() => {
            // Re-enable map drag that was turned off during translate.
            const m = mapRef.current;
            if (m) m.dragging.enable();
          }}
        />
        <DrawingSurface
          tool={tool}
          draft={draft}
          setDraft={setDraft}
          setCursor={setCursor}
          snapRightAngleOn={value.snap_right_angle}
          snapVertexOn={value.snap_vertex}
          snapGridFt={value.snap_grid_ft}
          existingVertices={existingVertices}
          onFinish={finish}
          panOverrideRef={panOverrideRef}
        />

        {/* ── Parcel polygon ── */}
        {parcelPoints.length >= 3 && (
          <Polygon
            positions={parcelPoints.map(toLatLng)}
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
        {parcelPoints.map((p, i) => (
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

        {/* ── Buildings (one polygon per drawn structure) ──
            Cutouts are rendered as inner holes by passing a multi-ring
            positions array: [outer, cutout1, cutout2, ...]. Leaflet's
            Polygon then treats the inner rings as holes, which is
            exactly the Texas-donut behaviour the analyst wants. */}
        {buildings.map((b) => {
          const isActive = b.id === activeBuildingId;
          const cutouts = b.cutouts || [];
          const positions =
            cutouts.length > 0
              ? [b.points.map(toLatLng), ...cutouts.map((c) => c.points.map(toLatLng))]
              : b.points.map(toLatLng);
          return (
            <Polygon
              key={`b-${b.id}`}
              positions={positions}
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
                    updateActiveScenario((scen) => ({ ...scen, active_building_id: b.id }));
                  }
                },
                mousedown: (e) => {
                  // Press-and-drag on the polygon body translates the
                  // whole building. Only fires in pan mode AND only on the
                  // currently active building (non-active buildings still
                  // select-on-click via the handler above).
                  if (tool !== "pan") return;
                  if (b.id !== activeBuildingId) return;
                  const m = mapRef.current;
                  if (!m) return;
                  // Prevent the map from drag-panning while we translate,
                  // and swallow the event so the default Leaflet
                  // click-to-select doesn't also fire.
                  m.dragging.disable();
                  L.DomEvent.stopPropagation(e.originalEvent as unknown as Event);
                  translateRef.current = {
                    buildingId: b.id,
                    startLatLng: e.latlng,
                    origPoints: b.points.slice(),
                    lastPoints: b.points.slice(),
                    moved: false,
                  };
                },
                contextmenu: (e) => {
                  // Right-click on the polygon body inserts a vertex at
                  // the nearest edge. Only operates on the active building
                  // (so the user first clicks to select, then right-clicks
                  // to add vertices). Stop native context menu too.
                  if (tool !== "pan") return;
                  if (b.id !== activeBuildingId) {
                    updateActiveScenario((scen) => ({ ...scen, active_building_id: b.id }));
                    L.DomEvent.stop(e.originalEvent as unknown as Event);
                    return;
                  }
                  const latlng: SitePlanPoint = { lat: e.latlng.lat, lng: e.latlng.lng };
                  const idx = nearestEdgeInsertIndex(b.points, latlng);
                  insertBuildingVertex(b.id, idx, latlng);
                  L.DomEvent.stop(e.originalEvent as unknown as Event);
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
        {buildings.flatMap((b) => {
          if (b.id !== activeBuildingId) {
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
                  contextmenu: (ev) => {
                    // Right-click a vertex handle to delete it (min 3
                    // vertices enforced by deleteBuildingVertex).
                    deleteBuildingVertex(b.id, i);
                    L.DomEvent.stop(ev.originalEvent as unknown as Event);
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

        {/* ── Cutouts — render outline + vertex markers + label so the
            analyst can see the hole even though Leaflet's multi-ring
            polygon already visually voids the fill. We draw them as
            pink dashed rings. */}
        {buildings.flatMap((b) => {
          const cutouts = b.cutouts || [];
          if (cutouts.length === 0) return [] as React.ReactElement[];
          const nodes: React.ReactElement[] = [];
          for (const c of cutouts) {
            // Centroid for label placement.
            const cx = c.points.reduce((s, p) => s + p.lat, 0) / c.points.length;
            const cy = c.points.reduce((s, p) => s + p.lng, 0) / c.points.length;
            nodes.push(
              <Polyline
                key={`co-${b.id}-${c.id}`}
                positions={[...c.points.map(toLatLng), toLatLng(c.points[0])]}
                pathOptions={{
                  color: CUTOUT_COLOR,
                  weight: 2,
                  dashArray: "4 3",
                }}
              />
            );
            c.points.forEach((p, i) => {
              nodes.push(
                <CircleMarker
                  key={`cov-${b.id}-${c.id}-${i}`}
                  center={toLatLng(p)}
                  radius={3}
                  pathOptions={{ color: CUTOUT_COLOR, fillColor: "#fff", fillOpacity: 1, weight: 2 }}
                />
              );
            });
            // Invisible marker at the centroid carrying a permanent
            // tooltip with the label + area. Keeps cutouts visually
            // identifiable without a standalone Text layer.
            nodes.push(
              <CircleMarker
                key={`col-${b.id}-${c.id}`}
                center={[cx, cy]}
                radius={0.1}
                pathOptions={{ color: "transparent", weight: 0, opacity: 0 }}
              >
                <Tooltip permanent direction="center" className="site-plan-dim-label">
                  {c.label} · {c.area_sf.toLocaleString()} SF
                </Tooltip>
              </CircleMarker>
            );
          }
          return nodes;
        })}

        {/* ── Frontage polyline (open) for the active scenario ── */}
        {activeScen?.frontage_points && activeScen.frontage_points.length >= 2 && (
          <>
            <Polyline
              positions={activeScen.frontage_points.map(toLatLng)}
              pathOptions={{ color: FRONTAGE_COLOR, weight: 3 }}
            />
            {activeScen.frontage_points.map((p, i) => (
              <CircleMarker
                key={`fv-${i}`}
                center={toLatLng(p)}
                radius={3}
                pathOptions={{ color: FRONTAGE_COLOR, fillColor: "#fff", fillOpacity: 1, weight: 2 }}
              />
            ))}
          </>
        )}

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
        {/* Per-segment dimension labels on every committed draft segment.
            Shown for every drawing tool (parcel / building / cutout /
            frontage / measure) so the analyst can read off leg lengths
            as they click — important for multifamily where the bay
            dimension matters. */}
        {tool !== "pan" && draft.length >= 2 && draft.slice(0, -1).map((p, i) => {
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

        {/* ── Ghost segment with dimension label ──
            Subscribes to cursor via cursorListenersRef so the rest of
            the map tree doesn't re-render when the cursor moves. */}
        <GhostOverlay
          tool={tool}
          draft={draft}
          listenersRef={cursorListenersRef}
          cursorRef={cursorRef}
          draftColor={DRAFT_COLOR}
        />
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
  active, onClick, label, icon, disabled, title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-7 px-2 flex items-center gap-1 rounded-md text-[11px] transition-colors ${
        active
          ? "bg-primary/20 text-primary"
          : disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
      title={title || label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
