"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  MousePointer2,
  Square,
  Minus,
  DoorOpen,
  RectangleHorizontal,
  Type,
  Trash2,
  Download,
  FileDown,
  Loader2,
  Undo2,
  Redo2,
  Bed,
  Bath,
  ChevronDown,
  Ruler,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { computeAreaSchedule } from "@/lib/floor-plan-area-schedule";

// SVG-based floor plan sketcher. Coordinates live on a 1ft grid (PX_PER_FT).
// Element types: rooms, walls, doors, windows, labels, and a generic
// "object" type used for furniture / fixtures / cabinets — each rendered with
// a kind-specific glyph but sharing position / size / rotation behavior.

const PX_PER_FT = 12;
const GRID = PX_PER_FT;
const SNAP_TOLERANCE = 10; // px — within this, prefer element snap over grid

type ToolId =
  | "select"
  | "room"
  | "wall"
  | "door"
  | "window"
  | "label"
  | "object"
  | "dimension"
  | "leader";

type ObjectKind =
  // Furniture
  | "bed-twin"
  | "bed-full"
  | "bed-queen"
  | "bed-king"
  | "sofa"
  | "dining-table"
  | "chair"
  | "desk"
  | "dresser"
  | "nightstand"
  // Fixtures
  | "toilet"
  | "sink-vanity"
  | "tub"
  | "shower"
  | "range"
  | "fridge"
  | "dishwasher"
  | "washer"
  | "dryer"
  // Cabinets
  | "cabinet-base"
  | "cabinet-wall";

interface BaseEl {
  id: string;
  type:
    | "room"
    | "wall"
    | "door"
    | "window"
    | "label"
    | "object"
    | "dimension"
    | "leader";
}
interface RoomEl extends BaseEl {
  type: "room";
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}
interface WallEl extends BaseEl {
  type: "wall";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface DoorEl extends BaseEl {
  type: "door";
  x: number;
  y: number;
  rotation: number;
}
interface WindowEl extends BaseEl {
  type: "window";
  x: number;
  y: number;
  rotation: number;
}
interface LabelEl extends BaseEl {
  type: "label";
  x: number;
  y: number;
  text: string;
}
interface ObjectEl extends BaseEl {
  type: "object";
  kind: ObjectKind;
  x: number; // top-left
  y: number;
  w: number;
  h: number;
  rotation: number;
}
interface DimensionEl extends BaseEl {
  type: "dimension";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  offset: number; // perpendicular px offset from baseline to dimension line
}
interface LeaderEl extends BaseEl {
  type: "leader";
  x1: number; // arrow tip
  y1: number;
  x2: number; // text anchor
  y2: number;
  text: string;
}
type El =
  | RoomEl
  | WallEl
  | DoorEl
  | WindowEl
  | LabelEl
  | ObjectEl
  | DimensionEl
  | LeaderEl;

interface State {
  els: El[];
  title: string;
}

const EMPTY_STATE: State = { els: [], title: "Untitled Plan" };
const STORAGE_KEY = "floorPlanEditor.v3";

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface SnapPoint {
  x: number;
  y: number;
  kind: "corner" | "endpoint" | "midpoint";
}

// Collect snap candidates from all existing elements (room corners + edge
// midpoints, wall endpoints + midpoints). The cursor snaps to the nearest of
// these inside SNAP_TOLERANCE; otherwise falls back to the grid.
function collectSnapPoints(els: El[], excludeId?: string | null): SnapPoint[] {
  const pts: SnapPoint[] = [];
  for (const el of els) {
    if (el.id === excludeId) continue;
    if (el.type === "room") {
      const { x, y, w, h } = el;
      pts.push(
        { x, y, kind: "corner" },
        { x: x + w, y, kind: "corner" },
        { x, y: y + h, kind: "corner" },
        { x: x + w, y: y + h, kind: "corner" },
        { x: x + w / 2, y, kind: "midpoint" },
        { x: x + w / 2, y: y + h, kind: "midpoint" },
        { x, y: y + h / 2, kind: "midpoint" },
        { x: x + w, y: y + h / 2, kind: "midpoint" },
      );
    } else if (el.type === "wall") {
      pts.push(
        { x: el.x1, y: el.y1, kind: "endpoint" },
        { x: el.x2, y: el.y2, kind: "endpoint" },
        {
          x: (el.x1 + el.x2) / 2,
          y: (el.y1 + el.y2) / 2,
          kind: "midpoint",
        },
      );
    }
  }
  return pts;
}

function smartSnap(
  rawX: number,
  rawY: number,
  els: El[],
  enabled = true,
  excludeId?: string | null,
): { x: number; y: number; hint: SnapPoint | null } {
  if (!enabled) {
    return { x: snap(rawX), y: snap(rawY), hint: null };
  }
  const pts = collectSnapPoints(els, excludeId);
  let best: SnapPoint | null = null;
  let bestDist = SNAP_TOLERANCE;
  for (const p of pts) {
    const d = Math.hypot(p.x - rawX, p.y - rawY);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (best) return { x: best.x, y: best.y, hint: best };
  return { x: snap(rawX), y: snap(rawY), hint: null };
}

// Default footprints in feet for each object kind. Sized so each fits the
// 1ft grid cleanly. These are placeholder real-world dims, not exact.
const OBJECT_DEFAULTS: Record<
  ObjectKind,
  { w: number; h: number; label: string; group: "furniture" | "fixture" }
> = {
  "bed-twin": { w: 4, h: 7, label: "Twin Bed", group: "furniture" },
  "bed-full": { w: 5, h: 7, label: "Full Bed", group: "furniture" },
  "bed-queen": { w: 5, h: 7, label: "Queen Bed", group: "furniture" },
  "bed-king": { w: 7, h: 7, label: "King Bed", group: "furniture" },
  sofa: { w: 7, h: 3, label: "Sofa", group: "furniture" },
  "dining-table": { w: 6, h: 3, label: "Dining Table", group: "furniture" },
  chair: { w: 2, h: 2, label: "Chair", group: "furniture" },
  desk: { w: 5, h: 3, label: "Desk", group: "furniture" },
  dresser: { w: 5, h: 2, label: "Dresser", group: "furniture" },
  nightstand: { w: 2, h: 2, label: "Nightstand", group: "furniture" },
  toilet: { w: 2, h: 3, label: "Toilet", group: "fixture" },
  "sink-vanity": { w: 3, h: 2, label: "Vanity", group: "fixture" },
  tub: { w: 5, h: 3, label: "Tub", group: "fixture" },
  shower: { w: 3, h: 3, label: "Shower", group: "fixture" },
  range: { w: 3, h: 2, label: "Range", group: "fixture" },
  fridge: { w: 3, h: 3, label: "Fridge", group: "fixture" },
  dishwasher: { w: 2, h: 2, label: "DW", group: "fixture" },
  washer: { w: 3, h: 3, label: "Washer", group: "fixture" },
  dryer: { w: 3, h: 3, label: "Dryer", group: "fixture" },
  "cabinet-base": { w: 2, h: 2, label: "Base Cab", group: "fixture" },
  "cabinet-wall": { w: 2, h: 1, label: "Wall Cab", group: "fixture" },
};

const FURNITURE_KINDS: ObjectKind[] = [
  "bed-twin",
  "bed-full",
  "bed-queen",
  "bed-king",
  "sofa",
  "dining-table",
  "chair",
  "desk",
  "dresser",
  "nightstand",
];
const FIXTURE_KINDS: ObjectKind[] = [
  "toilet",
  "sink-vanity",
  "tub",
  "shower",
  "range",
  "fridge",
  "dishwasher",
  "washer",
  "dryer",
  "cabinet-base",
  "cabinet-wall",
];

const BASE_TOOLS: { id: ToolId; label: string; icon: typeof MousePointer2 }[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "room", label: "Room", icon: Square },
  { id: "wall", label: "Wall", icon: Minus },
  { id: "door", label: "Door", icon: DoorOpen },
  { id: "window", label: "Window", icon: RectangleHorizontal },
  { id: "label", label: "Label", icon: Type },
  { id: "dimension", label: "Dim", icon: Ruler },
  { id: "leader", label: "Leader", icon: ArrowUpRight },
];

export function FloorPlanEditor() {
  const [state, setState] = useState<State>(EMPTY_STATE);
  const [tool, setTool] = useState<ToolId>("select");
  const [pendingKind, setPendingKind] = useState<ObjectKind | null>(null);
  const [palette, setPalette] = useState<"furniture" | "fixture" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<
    | { kind: "draw-room"; sx: number; sy: number; cx: number; cy: number }
    | { kind: "draw-wall"; sx: number; sy: number; cx: number; cy: number }
    | { kind: "move-el"; id: string; ox: number; oy: number; sx: number; sy: number }
    | null
  >(null);
  const [history, setHistory] = useState<State[]>([]);
  const [future, setFuture] = useState<State[]>([]);
  // For two-click tools (dimension, leader): the first click sets pendingPoint;
  // the second click commits the element using both points.
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [snapHint, setSnapHint] = useState<SnapPoint | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const commit = useCallback(
    (next: State | ((s: State) => State)) => {
      setState((prev) => {
        const resolved =
          typeof next === "function" ? (next as (s: State) => State)(prev) : next;
        setHistory((h) => [...h.slice(-49), prev]);
        setFuture([]);
        return resolved;
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [state, ...f].slice(0, 50));
      setState(prev);
      return h.slice(0, -1);
    });
  }, [state]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setHistory((h) => [...h, state].slice(-50));
      setState(next);
      return f.slice(1);
    });
  }, [state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        commit((s) => ({ ...s, els: s.els.filter((el) => el.id !== selectedId) }));
        setSelectedId(null);
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setTool("select");
        setPendingKind(null);
        setPendingPoint(null);
        setPalette(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "y" || (e.shiftKey && e.key === "Z"))
      ) {
        e.preventDefault();
        redo();
      } else if (e.key === "r" && selectedId) {
        // Quick rotate by 90° for door/window/object.
        commit((s) => ({
          ...s,
          els: s.els.map((el) => {
            if (el.id !== selectedId) return el;
            if (el.type === "door" || el.type === "window" || el.type === "object") {
              return { ...el, rotation: (el.rotation + 90) % 360 };
            }
            return el;
          }),
        }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, commit, undo, redo]);

  const svgPoint = (e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const { x, y } = svgPoint(e);
    const snapped = smartSnap(x, y, state.els, snapEnabled);
    const sx = snapped.x;
    const sy = snapped.y;

    if (tool === "select") {
      if (e.target === svgRef.current) setSelectedId(null);
      return;
    }
    if (tool === "dimension" || tool === "leader") {
      // Two-click flow handled on mouse up below; we just register the click.
      if (!pendingPoint) {
        setPendingPoint({ x: sx, y: sy });
      } else {
        if (tool === "dimension") {
          commit((s) => ({
            ...s,
            els: [
              ...s.els,
              {
                id: newId(),
                type: "dimension",
                x1: pendingPoint.x,
                y1: pendingPoint.y,
                x2: sx,
                y2: sy,
                offset: 24,
              },
            ],
          }));
        } else {
          const text = window.prompt("Leader text", "Note");
          if (text) {
            commit((s) => ({
              ...s,
              els: [
                ...s.els,
                {
                  id: newId(),
                  type: "leader",
                  x1: pendingPoint.x,
                  y1: pendingPoint.y,
                  x2: sx,
                  y2: sy,
                  text,
                },
              ],
            }));
          }
        }
        setPendingPoint(null);
        setTool("select");
      }
      return;
    }
    if (tool === "room") {
      setDrag({ kind: "draw-room", sx, sy, cx: sx, cy: sy });
    } else if (tool === "wall") {
      setDrag({ kind: "draw-wall", sx, sy, cx: sx, cy: sy });
    } else if (tool === "door") {
      commit((s) => ({
        ...s,
        els: [...s.els, { id: newId(), type: "door", x: sx, y: sy, rotation: 0 }],
      }));
      setTool("select");
    } else if (tool === "window") {
      commit((s) => ({
        ...s,
        els: [...s.els, { id: newId(), type: "window", x: sx, y: sy, rotation: 0 }],
      }));
      setTool("select");
    } else if (tool === "label") {
      const text = window.prompt("Label text");
      if (text) {
        commit((s) => ({
          ...s,
          els: [...s.els, { id: newId(), type: "label", x: sx, y: sy, text }],
        }));
      }
      setTool("select");
    } else if (tool === "object" && pendingKind) {
      const def = OBJECT_DEFAULTS[pendingKind];
      const id = newId();
      commit((s) => ({
        ...s,
        els: [
          ...s.els,
          {
            id,
            type: "object",
            kind: pendingKind,
            x: sx,
            y: sy,
            w: def.w * PX_PER_FT,
            h: def.h * PX_PER_FT,
            rotation: 0,
          },
        ],
      }));
      setSelectedId(id);
      setTool("select");
      setPendingKind(null);
    }
  };

  const onCanvasMouseMove = (e: React.MouseEvent) => {
    const { x, y } = svgPoint(e);
    const excludeId = drag?.kind === "move-el" ? drag.id : null;
    const snapped = smartSnap(x, y, state.els, snapEnabled, excludeId);
    const cx = snapped.x;
    const cy = snapped.y;
    setHoverPoint({ x: cx, y: cy });
    setSnapHint(snapped.hint);
    if (!drag) return;
    if (drag.kind === "draw-room" || drag.kind === "draw-wall") {
      setDrag({ ...drag, cx, cy });
    } else if (drag.kind === "move-el") {
      const dx = cx - drag.sx;
      const dy = cy - drag.sy;
      setState((s) => ({
        ...s,
        els: s.els.map((el) => {
          if (el.id !== drag.id) return el;
          if (el.type === "room" || el.type === "object") {
            return { ...el, x: drag.ox + dx, y: drag.oy + dy };
          }
          if (el.type === "wall" || el.type === "dimension" || el.type === "leader") {
            const ddx = drag.ox + dx - el.x1;
            const ddy = drag.oy + dy - el.y1;
            return {
              ...el,
              x1: el.x1 + ddx,
              y1: el.y1 + ddy,
              x2: el.x2 + ddx,
              y2: el.y2 + ddy,
            };
          }
          if (el.type === "door" || el.type === "window" || el.type === "label") {
            return { ...el, x: drag.ox + dx, y: drag.oy + dy };
          }
          return el;
        }),
      }));
    }
  };

  const onCanvasMouseUp = () => {
    if (!drag) return;
    if (drag.kind === "draw-room") {
      const x = Math.min(drag.sx, drag.cx);
      const y = Math.min(drag.sy, drag.cy);
      const w = Math.abs(drag.cx - drag.sx);
      const h = Math.abs(drag.cy - drag.sy);
      if (w >= GRID && h >= GRID) {
        const id = newId();
        commit((s) => ({
          ...s,
          els: [...s.els, { id, type: "room", x, y, w, h, label: "Room" }],
        }));
        setSelectedId(id);
      }
      setTool("select");
    } else if (drag.kind === "draw-wall") {
      if (drag.sx !== drag.cx || drag.sy !== drag.cy) {
        const dx = Math.abs(drag.cx - drag.sx);
        const dy = Math.abs(drag.cy - drag.sy);
        const x2 = dx >= dy ? drag.cx : drag.sx;
        const y2 = dx >= dy ? drag.sy : drag.cy;
        commit((s) => ({
          ...s,
          els: [
            ...s.els,
            { id: newId(), type: "wall", x1: drag.sx, y1: drag.sy, x2, y2 },
          ],
        }));
      }
      setTool("select");
    } else if (drag.kind === "move-el") {
      commit((s) => s);
    }
    setDrag(null);
  };

  const startMove = (e: React.MouseEvent, el: El) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSelectedId(el.id);
    const { x, y } = svgPoint(e);
    const snapped = smartSnap(x, y, state.els, snapEnabled, el.id);
    const sx = snapped.x;
    const sy = snapped.y;
    let ox = 0;
    let oy = 0;
    if (
      el.type === "room" ||
      el.type === "door" ||
      el.type === "window" ||
      el.type === "label" ||
      el.type === "object"
    ) {
      ox = el.x;
      oy = el.y;
    } else if (el.type === "wall" || el.type === "dimension" || el.type === "leader") {
      ox = el.x1;
      oy = el.y1;
    }
    setDrag({ kind: "move-el", id: el.id, ox, oy, sx, sy });
  };

  const selectedEl = useMemo(
    () => state.els.find((e) => e.id === selectedId) || null,
    [state.els, selectedId],
  );

  const totalArea = useMemo(() => {
    const roomFt2 = state.els
      .filter((e): e is RoomEl => e.type === "room")
      .reduce((acc, r) => acc + (r.w / PX_PER_FT) * (r.h / PX_PER_FT), 0);
    return Math.round(roomFt2);
  }, [state.els]);

  const updateSelected = (patch: Partial<El>) => {
    if (!selectedId) return;
    commit((s) => ({
      ...s,
      els: s.els.map((el) => (el.id === selectedId ? ({ ...el, ...patch } as El) : el)),
    }));
  };

  // Set wall length while preserving angle from (x1,y1) to (x2,y2).
  const setWallLength = (lengthFt: number) => {
    if (!selectedEl || selectedEl.type !== "wall") return;
    const lengthPx = Math.max(GRID, snap(lengthFt * PX_PER_FT));
    const dx = selectedEl.x2 - selectedEl.x1;
    const dy = selectedEl.y2 - selectedEl.y1;
    const cur = Math.hypot(dx, dy);
    if (cur === 0) {
      updateSelected({ x2: selectedEl.x1 + lengthPx, y2: selectedEl.y1 } as Partial<WallEl>);
      return;
    }
    const ux = dx / cur;
    const uy = dy / cur;
    updateSelected({
      x2: snap(selectedEl.x1 + ux * lengthPx),
      y2: snap(selectedEl.y1 + uy * lengthPx),
    } as Partial<WallEl>);
  };

  const exportPng = async () => {
    const node = exportRef.current;
    if (!node) return;
    try {
      const dataUrl = await toPng(node, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${state.title || "floor-plan"}.png`;
      a.click();
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  const [exportingPackage, setExportingPackage] = useState(false);
  // Architect package = canvas PNG + computed area schedule, wrapped in the
  // branded report shell. Captures the same exportRef the PNG export uses so
  // the user gets exactly what they see on screen.
  const exportArchitectPackage = async () => {
    const node = exportRef.current;
    if (!node) return;
    setExportingPackage(true);
    try {
      const dataUrl = await toPng(node, { backgroundColor: "#ffffff", pixelRatio: 2 });
      const res = await fetch("/api/floor-plans/architect-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: state.title || "Untitled Plan",
          plan_image_data_url: dataUrl,
          elements: state.els,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Package export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(state.title || "floor-plan").replace(/[^a-zA-Z0-9]/g, "-")}-architect-package.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Architect package export failed", err);
      alert(err instanceof Error ? err.message : "Architect package export failed");
    } finally {
      setExportingPackage(false);
    }
  };

  const clearAll = () => {
    if (!window.confirm("Clear the entire plan?")) return;
    commit({ ...EMPTY_STATE, title: state.title });
    setSelectedId(null);
  };

  const draftRoom =
    drag?.kind === "draw-room"
      ? {
          x: Math.min(drag.sx, drag.cx),
          y: Math.min(drag.sy, drag.cy),
          w: Math.abs(drag.cx - drag.sx),
          h: Math.abs(drag.cy - drag.sy),
        }
      : null;
  const draftWall =
    drag?.kind === "draw-wall"
      ? (() => {
          const dx = Math.abs(drag.cx - drag.sx);
          const dy = Math.abs(drag.cy - drag.sy);
          const x2 = dx >= dy ? drag.cx : drag.sx;
          const y2 = dx >= dy ? drag.sy : drag.cy;
          return { x1: drag.sx, y1: drag.sy, x2, y2 };
        })()
      : null;

  const pickObject = (kind: ObjectKind) => {
    setPendingKind(kind);
    setTool("object");
    setPalette(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-card/40 shrink-0 flex-wrap">
        <input
          value={state.title}
          onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
          className="text-sm font-medium bg-transparent border-b border-transparent hover:border-border/50 focus:border-primary/50 focus:outline-none px-1 py-0.5 mr-2 min-w-[180px]"
          placeholder="Plan title"
        />
        <div className="flex items-center rounded-md border border-border/50 bg-background/50 overflow-hidden">
          {BASE_TOOLS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTool(t.id);
                  setPendingKind(null);
                  setPendingPoint(null);
                }}
                title={t.label}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/50 text-muted-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Furniture / Fixtures palettes */}
        <PaletteButton
          icon={Bed}
          label="Furniture"
          open={palette === "furniture"}
          onToggle={() => setPalette(palette === "furniture" ? null : "furniture")}
          kinds={FURNITURE_KINDS}
          onPick={pickObject}
          active={tool === "object" && pendingKind != null && OBJECT_DEFAULTS[pendingKind].group === "furniture"}
        />
        <PaletteButton
          icon={Bath}
          label="Fixtures"
          open={palette === "fixture"}
          onToggle={() => setPalette(palette === "fixture" ? null : "fixture")}
          kinds={FIXTURE_KINDS}
          onPick={pickObject}
          active={tool === "object" && pendingKind != null && OBJECT_DEFAULTS[pendingKind].group === "fixture"}
        />

        <div className="flex-1" />
        <button
          onClick={() => setSnapEnabled((v) => !v)}
          title={snapEnabled ? "Snap on (toggle)" : "Snap off (toggle)"}
          className={cn(
            "px-2 py-1 rounded text-[10px] uppercase tracking-wider border transition-colors",
            snapEnabled
              ? "border-orange-500/40 text-orange-500 bg-orange-500/10"
              : "border-border/50 text-muted-foreground hover:bg-muted/50",
          )}
        >
          Snap {snapEnabled ? "On" : "Off"}
        </button>
        <div className="text-xs text-muted-foreground hidden sm:block">
          Total: <span className="font-medium text-foreground">{totalArea} ft²</span>
        </div>
        <button
          onClick={undo}
          disabled={history.length === 0}
          title="Undo"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={redo}
          disabled={future.length === 0}
          title="Redo"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={clearAll}
          title="Clear"
          className="p-1.5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={exportPng}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 text-xs font-medium hover:bg-muted/50"
        >
          <Download className="h-3.5 w-3.5" />
          PNG
        </button>
        <button
          onClick={exportArchitectPackage}
          disabled={exportingPackage || state.els.filter((e) => e.type === "room").length === 0}
          title="Branded PDF with the plan, area schedule, and totals — ready to email to the architect."
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exportingPackage ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileDown className="h-3.5 w-3.5" />
          )}
          {exportingPackage ? "Building…" : "Architect Package"}
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-muted/20 p-6">
          <div ref={exportRef} className="inline-block bg-white rounded shadow-sm">
            <div className="px-4 py-2 border-b border-zinc-200 flex items-center justify-between min-w-[800px]">
              <div className="text-sm font-semibold text-zinc-900">{state.title}</div>
              <div className="text-[11px] text-zinc-500">
                {totalArea} sq ft &middot; 1 grid = 1 ft
              </div>
            </div>
            <svg
              ref={svgRef}
              width={1200}
              height={800}
              viewBox="0 0 1200 800"
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseUp}
              className={cn(
                "block bg-white",
                tool !== "select" && "cursor-crosshair",
              )}
            >
              <defs>
                <pattern
                  id="fp-grid"
                  width={GRID}
                  height={GRID}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M ${GRID} 0 L 0 0 0 ${GRID}`}
                    fill="none"
                    stroke="#e4e4e7"
                    strokeWidth={0.5}
                  />
                </pattern>
                <pattern
                  id="fp-grid-major"
                  width={GRID * 5}
                  height={GRID * 5}
                  patternUnits="userSpaceOnUse"
                >
                  <rect width={GRID * 5} height={GRID * 5} fill="url(#fp-grid)" />
                  <path
                    d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`}
                    fill="none"
                    stroke="#d4d4d8"
                    strokeWidth={1}
                  />
                </pattern>
                <marker
                  id="fp-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#18181b" />
                </marker>
                <marker
                  id="fp-tick"
                  viewBox="-1 -5 2 10"
                  refX="0"
                  refY="0"
                  markerWidth="6"
                  markerHeight="10"
                  orient="auto"
                >
                  <line x1="0" y1="-4" x2="0" y2="4" stroke="#18181b" strokeWidth="1" />
                </marker>
              </defs>
              <rect width="100%" height="100%" fill="url(#fp-grid-major)" />

              {state.els.map((el) => {
                const isSel = el.id === selectedId;
                if (el.type === "room") {
                  const ft2 = Math.round(
                    (el.w / PX_PER_FT) * (el.h / PX_PER_FT),
                  );
                  return (
                    <g
                      key={el.id}
                      onMouseDown={(e) => startMove(e, el)}
                      className="cursor-move"
                    >
                      <rect
                        x={el.x}
                        y={el.y}
                        width={el.w}
                        height={el.h}
                        fill={isSel ? "rgba(59,130,246,0.06)" : "rgba(0,0,0,0.015)"}
                        stroke={isSel ? "#3b82f6" : "#18181b"}
                        strokeWidth={isSel ? 2 : 3}
                      />
                      <text
                        x={el.x + el.w / 2}
                        y={el.y + el.h / 2 - 4}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="#18181b"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {el.label}
                      </text>
                      <text
                        x={el.x + el.w / 2}
                        y={el.y + el.h / 2 + 10}
                        textAnchor="middle"
                        fontSize={9}
                        fill="#71717a"
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {Math.round(el.w / PX_PER_FT)}'×{Math.round(el.h / PX_PER_FT)}' &middot; {ft2} sq ft
                      </text>
                    </g>
                  );
                }
                if (el.type === "wall") {
                  const lenFt = Math.round(
                    Math.hypot(el.x2 - el.x1, el.y2 - el.y1) / PX_PER_FT,
                  );
                  const mx = (el.x1 + el.x2) / 2;
                  const my = (el.y1 + el.y2) / 2;
                  return (
                    <g key={el.id}>
                      <line
                        x1={el.x1}
                        y1={el.y1}
                        x2={el.x2}
                        y2={el.y2}
                        stroke={isSel ? "#3b82f6" : "#18181b"}
                        strokeWidth={isSel ? 5 : 4}
                        strokeLinecap="round"
                        onMouseDown={(e) => startMove(e, el)}
                        className="cursor-move"
                      />
                      {isSel && (
                        <g style={{ pointerEvents: "none" }}>
                          <rect
                            x={mx - 18}
                            y={my - 18}
                            width={36}
                            height={14}
                            rx={3}
                            fill="#3b82f6"
                          />
                          <text
                            x={mx}
                            y={my - 8}
                            textAnchor="middle"
                            fontSize={10}
                            fontWeight={600}
                            fill="white"
                          >
                            {lenFt} ft
                          </text>
                        </g>
                      )}
                    </g>
                  );
                }
                if (el.type === "door") {
                  return (
                    <g
                      key={el.id}
                      transform={`translate(${el.x},${el.y}) rotate(${el.rotation})`}
                      onMouseDown={(e) => startMove(e, el)}
                      className="cursor-move"
                    >
                      <rect
                        x={-18}
                        y={-2}
                        width={36}
                        height={4}
                        fill="white"
                        stroke={isSel ? "#3b82f6" : "#18181b"}
                        strokeWidth={1}
                      />
                      <path
                        d="M -18,-2 A 36,36 0 0 1 18,-2"
                        fill="none"
                        stroke={isSel ? "#3b82f6" : "#71717a"}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                      />
                    </g>
                  );
                }
                if (el.type === "window") {
                  return (
                    <g
                      key={el.id}
                      transform={`translate(${el.x},${el.y}) rotate(${el.rotation})`}
                      onMouseDown={(e) => startMove(e, el)}
                      className="cursor-move"
                    >
                      <rect
                        x={-24}
                        y={-3}
                        width={48}
                        height={6}
                        fill="white"
                        stroke={isSel ? "#3b82f6" : "#18181b"}
                        strokeWidth={1.5}
                      />
                      <line
                        x1={-24}
                        y1={0}
                        x2={24}
                        y2={0}
                        stroke={isSel ? "#3b82f6" : "#18181b"}
                        strokeWidth={1}
                      />
                    </g>
                  );
                }
                if (el.type === "label") {
                  return (
                    <g
                      key={el.id}
                      onMouseDown={(e) => startMove(e, el)}
                      className="cursor-move"
                    >
                      <text
                        x={el.x}
                        y={el.y}
                        fontSize={12}
                        fontWeight={500}
                        fill={isSel ? "#3b82f6" : "#18181b"}
                      >
                        {el.text}
                      </text>
                    </g>
                  );
                }
                if (el.type === "object") {
                  const cx = el.x + el.w / 2;
                  const cy = el.y + el.h / 2;
                  return (
                    <g
                      key={el.id}
                      transform={`rotate(${el.rotation} ${cx} ${cy})`}
                      onMouseDown={(e) => startMove(e, el)}
                      className="cursor-move"
                    >
                      <ObjectGlyph el={el} selected={isSel} />
                    </g>
                  );
                }
                if (el.type === "dimension") {
                  return (
                    <DimensionGlyph
                      key={el.id}
                      el={el}
                      selected={isSel}
                      onMouseDown={(e) => startMove(e, el)}
                    />
                  );
                }
                if (el.type === "leader") {
                  return (
                    <LeaderGlyph
                      key={el.id}
                      el={el}
                      selected={isSel}
                      onMouseDown={(e) => startMove(e, el)}
                    />
                  );
                }
                return null;
              })}

              {/* Draft previews */}
              {draftRoom && (
                <>
                  <rect
                    x={draftRoom.x}
                    y={draftRoom.y}
                    width={draftRoom.w}
                    height={draftRoom.h}
                    fill="rgba(59,130,246,0.08)"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    pointerEvents="none"
                  />
                  <text
                    x={draftRoom.x + draftRoom.w / 2}
                    y={draftRoom.y + draftRoom.h / 2}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="#3b82f6"
                    style={{ pointerEvents: "none" }}
                  >
                    {Math.round(draftRoom.w / PX_PER_FT)}' × {Math.round(draftRoom.h / PX_PER_FT)}'
                  </text>
                </>
              )}
              {draftWall && (
                <>
                  <line
                    x1={draftWall.x1}
                    y1={draftWall.y1}
                    x2={draftWall.x2}
                    y2={draftWall.y2}
                    stroke="#3b82f6"
                    strokeWidth={3}
                    strokeDasharray="4 3"
                    pointerEvents="none"
                  />
                  <text
                    x={(draftWall.x1 + draftWall.x2) / 2}
                    y={(draftWall.y1 + draftWall.y2) / 2 - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill="#3b82f6"
                    style={{ pointerEvents: "none" }}
                  >
                    {Math.round(
                      Math.hypot(
                        draftWall.x2 - draftWall.x1,
                        draftWall.y2 - draftWall.y1,
                      ) / PX_PER_FT,
                    )}{" "}
                    ft
                  </text>
                </>
              )}

              {/* Pending first-click point for two-step tools (dim, leader). */}
              {pendingPoint && (
                <>
                  <circle
                    cx={pendingPoint.x}
                    cy={pendingPoint.y}
                    r={4}
                    fill="#3b82f6"
                    pointerEvents="none"
                  />
                  {hoverPoint && (
                    <line
                      x1={pendingPoint.x}
                      y1={pendingPoint.y}
                      x2={hoverPoint.x}
                      y2={hoverPoint.y}
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      pointerEvents="none"
                    />
                  )}
                </>
              )}

              {/* Snap target indicator (rendered on top of everything). */}
              {snapHint && (
                <g pointerEvents="none">
                  <circle
                    cx={snapHint.x}
                    cy={snapHint.y}
                    r={5}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth={1.5}
                  />
                  <line
                    x1={snapHint.x - 7}
                    y1={snapHint.y}
                    x2={snapHint.x + 7}
                    y2={snapHint.y}
                    stroke="#f97316"
                    strokeWidth={1}
                  />
                  <line
                    x1={snapHint.x}
                    y1={snapHint.y - 7}
                    x2={snapHint.x}
                    y2={snapHint.y + 7}
                    stroke="#f97316"
                    strokeWidth={1}
                  />
                </g>
              )}
            </svg>
          </div>
        </div>

        {/* Right inspector */}
        <aside className="w-64 border-l border-border/40 bg-card/30 p-4 shrink-0 overflow-y-auto">
          {!selectedEl ? (
            <div className="text-xs text-muted-foreground space-y-4">
              <TotalsPanel els={state.els} />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                  How to use
                </div>
                <ul className="space-y-1.5 leading-relaxed">
                  <li>• Pick a tool, then drag (room/wall) or click (door/window/label) on the canvas.</li>
                  <li>• Furniture / Fixtures menus open palettes — click an item, then click on the canvas to drop it.</li>
                  <li>• <kbd className="px-1 rounded bg-muted text-[10px]">Dim</kbd> + <kbd className="px-1 rounded bg-muted text-[10px]">Leader</kbd> are two-click tools — click start, then end.</li>
                  <li>• Cursor snaps to nearby room corners and wall endpoints (orange marker). Toggle Snap in the toolbar.</li>
                  <li>• <kbd className="px-1 rounded bg-muted text-[10px]">R</kbd> rotates selection 90°. Delete / Backspace removes. ⌘Z / ⌘⇧Z for undo / redo.</li>
                  <li>• Plan auto-saves to your browser.</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {selectedEl.type === "object"
                  ? OBJECT_DEFAULTS[selectedEl.kind].label
                  : selectedEl.type}
              </div>

              {selectedEl.type === "room" && (
                <>
                  <Field label="Label">
                    <input
                      value={selectedEl.label}
                      onChange={(e) => updateSelected({ label: e.target.value })}
                      className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                    />
                  </Field>
                  <Field label="Width (ft)">
                    <input
                      type="number"
                      min={1}
                      value={Math.round(selectedEl.w / PX_PER_FT)}
                      onChange={(e) =>
                        updateSelected({
                          w: Math.max(1, Number(e.target.value)) * PX_PER_FT,
                        })
                      }
                      className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                    />
                  </Field>
                  <Field label="Height (ft)">
                    <input
                      type="number"
                      min={1}
                      value={Math.round(selectedEl.h / PX_PER_FT)}
                      onChange={(e) =>
                        updateSelected({
                          h: Math.max(1, Number(e.target.value)) * PX_PER_FT,
                        })
                      }
                      className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                    />
                  </Field>
                  <div className="text-[11px] text-muted-foreground pt-1">
                    {Math.round((selectedEl.w / PX_PER_FT) * (selectedEl.h / PX_PER_FT))} sq ft
                  </div>
                </>
              )}

              {selectedEl.type === "wall" && (
                <>
                  <Field label="Length (ft)">
                    <input
                      type="number"
                      min={1}
                      value={Math.round(
                        Math.hypot(
                          selectedEl.x2 - selectedEl.x1,
                          selectedEl.y2 - selectedEl.y1,
                        ) / PX_PER_FT,
                      )}
                      onChange={(e) => setWallLength(Number(e.target.value))}
                      className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                    />
                  </Field>
                </>
              )}

              {(selectedEl.type === "door" ||
                selectedEl.type === "window" ||
                selectedEl.type === "object") && (
                <Field label="Rotation">
                  <select
                    value={selectedEl.rotation}
                    onChange={(e) => updateSelected({ rotation: Number(e.target.value) })}
                    className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                  >
                    {[0, 45, 90, 135, 180, 225, 270, 315].map((r) => (
                      <option key={r} value={r}>
                        {r}°
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {selectedEl.type === "object" && (
                <>
                  <Field label="Width (ft)">
                    <input
                      type="number"
                      min={1}
                      value={Math.round(selectedEl.w / PX_PER_FT)}
                      onChange={(e) =>
                        updateSelected({
                          w: Math.max(1, Number(e.target.value)) * PX_PER_FT,
                        })
                      }
                      className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                    />
                  </Field>
                  <Field label="Height (ft)">
                    <input
                      type="number"
                      min={1}
                      value={Math.round(selectedEl.h / PX_PER_FT)}
                      onChange={(e) =>
                        updateSelected({
                          h: Math.max(1, Number(e.target.value)) * PX_PER_FT,
                        })
                      }
                      className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                    />
                  </Field>
                </>
              )}

              {selectedEl.type === "label" && (
                <Field label="Text">
                  <input
                    value={selectedEl.text}
                    onChange={(e) => updateSelected({ text: e.target.value })}
                    className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                  />
                </Field>
              )}

              {selectedEl.type === "dimension" && (
                <>
                  <div className="text-[11px] text-muted-foreground">
                    Measured length:{" "}
                    <span className="font-medium text-foreground">
                      {Math.round(
                        Math.hypot(
                          selectedEl.x2 - selectedEl.x1,
                          selectedEl.y2 - selectedEl.y1,
                        ) / PX_PER_FT,
                      )}{" "}
                      ft
                    </span>
                  </div>
                  <Field label="Offset (px)">
                    <input
                      type="number"
                      value={selectedEl.offset}
                      onChange={(e) =>
                        updateSelected({ offset: Number(e.target.value) })
                      }
                      className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                    />
                  </Field>
                </>
              )}

              {selectedEl.type === "leader" && (
                <Field label="Text">
                  <input
                    value={selectedEl.text}
                    onChange={(e) => updateSelected({ text: e.target.value })}
                    className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                  />
                </Field>
              )}

              <button
                onClick={() => {
                  commit((s) => ({
                    ...s,
                    els: s.els.filter((el) => el.id !== selectedEl.id),
                  }));
                  setSelectedId(null);
                }}
                className="w-full mt-3 text-xs px-2 py-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
        {label}
      </div>
      {children}
    </label>
  );
}

function PaletteButton({
  icon: Icon,
  label,
  open,
  onToggle,
  kinds,
  onPick,
  active,
}: {
  icon: typeof Bed;
  label: string;
  open: boolean;
  onToggle: () => void;
  kinds: ObjectKind[];
  onPick: (k: ObjectKind) => void;
  active: boolean;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors",
          active
            ? "bg-primary text-primary-foreground border-primary"
            : "border-border/50 bg-background/50 hover:bg-muted/50 text-muted-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="hidden md:inline">{label}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 w-56 max-h-[60vh] overflow-y-auto rounded-md border border-border/60 bg-card shadow-lg p-1">
          {kinds.map((k) => {
            const def = OBJECT_DEFAULTS[k];
            return (
              <button
                key={k}
                onClick={() => onPick(k)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/50 text-left"
              >
                <span className="font-medium">{def.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {def.w}'×{def.h}'
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// SVG glyphs for each object kind, drawn in local coords spanning the
// element's bounding box (el.x/y/w/h). Stroke color flips when selected.
function ObjectGlyph({ el, selected }: { el: ObjectEl; selected: boolean }) {
  const stroke = selected ? "#3b82f6" : "#18181b";
  const fill = selected ? "rgba(59,130,246,0.06)" : "white";
  const muted = "#a1a1aa";
  const { x, y, w, h, kind } = el;

  // Helper outline.
  const outline = (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      fill={fill}
      stroke={stroke}
      strokeWidth={1.5}
    />
  );

  // Bed: pillow strip at top, blanket lines below.
  if (kind.startsWith("bed-")) {
    const pillowH = Math.min(h * 0.18, 14);
    return (
      <>
        {outline}
        <rect
          x={x + 3}
          y={y + 3}
          width={w - 6}
          height={pillowH}
          fill="white"
          stroke={muted}
          strokeWidth={0.8}
        />
        <line
          x1={x + w / 2}
          y1={y + 3}
          x2={x + w / 2}
          y2={y + 3 + pillowH}
          stroke={muted}
          strokeWidth={0.6}
        />
        <text
          x={x + w / 2}
          y={y + h - 5}
          textAnchor="middle"
          fontSize={8}
          fill={muted}
        >
          {OBJECT_DEFAULTS[kind].label}
        </text>
      </>
    );
  }

  if (kind === "sofa") {
    return (
      <>
        {outline}
        <rect
          x={x + 3}
          y={y + 3}
          width={w - 6}
          height={h * 0.5}
          fill="white"
          stroke={muted}
          strokeWidth={0.8}
        />
        {[1, 2, 3].map((i) => (
          <line
            key={i}
            x1={x + (w / 4) * i}
            y1={y + 3}
            x2={x + (w / 4) * i}
            y2={y + 3 + h * 0.5}
            stroke={muted}
            strokeWidth={0.6}
          />
        ))}
      </>
    );
  }

  if (kind === "dining-table" || kind === "desk" || kind === "dresser" || kind === "nightstand") {
    return (
      <>
        {outline}
        <text
          x={x + w / 2}
          y={y + h / 2 + 3}
          textAnchor="middle"
          fontSize={8}
          fill={muted}
        >
          {OBJECT_DEFAULTS[kind].label}
        </text>
      </>
    );
  }

  if (kind === "chair") {
    return (
      <>
        {outline}
        <rect
          x={x + 2}
          y={y + 2}
          width={w - 4}
          height={3}
          fill={muted}
          opacity={0.6}
        />
      </>
    );
  }

  if (kind === "toilet") {
    return (
      <>
        {/* Tank */}
        <rect
          x={x}
          y={y}
          width={w}
          height={h * 0.3}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
        />
        {/* Bowl */}
        <ellipse
          cx={x + w / 2}
          cy={y + h * 0.65}
          rx={(w / 2) * 0.85}
          ry={(h * 0.65) * 0.55}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
        />
      </>
    );
  }

  if (kind === "sink-vanity") {
    return (
      <>
        {outline}
        <ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w * 0.3}
          ry={h * 0.3}
          fill="white"
          stroke={muted}
          strokeWidth={1}
        />
        <circle cx={x + w / 2} cy={y + h * 0.3} r={1.5} fill={muted} />
      </>
    );
  }

  if (kind === "tub") {
    return (
      <>
        {outline}
        <rect
          x={x + 4}
          y={y + 4}
          width={w - 8}
          height={h - 8}
          rx={6}
          fill="white"
          stroke={muted}
          strokeWidth={1}
        />
        <circle cx={x + w - 8} cy={y + h / 2} r={1.5} fill={muted} />
      </>
    );
  }

  if (kind === "shower") {
    return (
      <>
        {outline}
        <line
          x1={x}
          y1={y}
          x2={x + w}
          y2={y + h}
          stroke={muted}
          strokeWidth={0.6}
        />
        <line
          x1={x + w}
          y1={y}
          x2={x}
          y2={y + h}
          stroke={muted}
          strokeWidth={0.6}
        />
        <circle
          cx={x + w / 2}
          cy={y + h / 2}
          r={3}
          fill="white"
          stroke={muted}
        />
      </>
    );
  }

  if (kind === "range") {
    return (
      <>
        {outline}
        {[0.3, 0.7].map((fx) =>
          [0.3, 0.7].map((fy) => (
            <circle
              key={`${fx}-${fy}`}
              cx={x + w * fx}
              cy={y + h * fy}
              r={Math.min(w, h) * 0.12}
              fill="white"
              stroke={muted}
              strokeWidth={0.8}
            />
          )),
        )}
      </>
    );
  }

  if (kind === "fridge") {
    return (
      <>
        {outline}
        <line
          x1={x}
          y1={y + h * 0.35}
          x2={x + w}
          y2={y + h * 0.35}
          stroke={muted}
          strokeWidth={0.8}
        />
        <text
          x={x + w / 2}
          y={y + h - 6}
          textAnchor="middle"
          fontSize={8}
          fill={muted}
        >
          REF
        </text>
      </>
    );
  }

  if (kind === "dishwasher" || kind === "washer" || kind === "dryer") {
    const lbl =
      kind === "dishwasher" ? "DW" : kind === "washer" ? "W" : "D";
    return (
      <>
        {outline}
        <circle
          cx={x + w / 2}
          cy={y + h / 2}
          r={Math.min(w, h) * 0.3}
          fill="white"
          stroke={muted}
          strokeWidth={1}
        />
        <text
          x={x + w / 2}
          y={y + h / 2 + 3}
          textAnchor="middle"
          fontSize={9}
          fontWeight={700}
          fill={muted}
        >
          {lbl}
        </text>
      </>
    );
  }

  if (kind === "cabinet-base" || kind === "cabinet-wall") {
    return (
      <>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray={kind === "cabinet-wall" ? "4 2" : undefined}
        />
        <line
          x1={x}
          y1={y}
          x2={x + w}
          y2={y + h}
          stroke={muted}
          strokeWidth={0.6}
        />
      </>
    );
  }

  return outline;
}

// Linear dimension drawn parallel to (x1,y1)→(x2,y2), offset perpendicularly
// by `offset` px. Renders the two extension lines, the dimension line with
// tick markers, and the measured value in feet at the midpoint.
function DimensionGlyph({
  el,
  selected,
  onMouseDown,
}: {
  el: DimensionEl;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const stroke = selected ? "#3b82f6" : "#18181b";
  const dx = el.x2 - el.x1;
  const dy = el.y2 - el.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const nx = -dy / len; // unit normal
  const ny = dx / len;
  const ax = el.x1 + nx * el.offset;
  const ay = el.y1 + ny * el.offset;
  const bx = el.x2 + nx * el.offset;
  const by = el.y2 + ny * el.offset;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const ft = Math.round(len / PX_PER_FT);
  // Text rotation along the dimension line (keep upright).
  let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  return (
    <g onMouseDown={onMouseDown} className="cursor-move">
      {/* Extension lines */}
      <line x1={el.x1} y1={el.y1} x2={ax} y2={ay} stroke={stroke} strokeWidth={0.8} />
      <line x1={el.x2} y1={el.y2} x2={bx} y2={by} stroke={stroke} strokeWidth={0.8} />
      {/* Dimension line with end ticks */}
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke={stroke}
        strokeWidth={1}
        markerStart="url(#fp-tick)"
        markerEnd="url(#fp-tick)"
      />
      {/* Bigger invisible hit area */}
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke="transparent"
        strokeWidth={14}
      />
      <g transform={`translate(${mx} ${my}) rotate(${angle})`}>
        <rect
          x={-18}
          y={-9}
          width={36}
          height={14}
          rx={2}
          fill="white"
          stroke={stroke}
          strokeWidth={0.5}
        />
        <text
          x={0}
          y={1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fontWeight={600}
          fill={stroke}
        >
          {ft} ft
        </text>
      </g>
    </g>
  );
}

// Arrow-and-text annotation. Arrow tip is at (x1,y1); text sits at (x2,y2).
function LeaderGlyph({
  el,
  selected,
  onMouseDown,
}: {
  el: LeaderEl;
  selected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const stroke = selected ? "#3b82f6" : "#18181b";
  return (
    <g onMouseDown={onMouseDown} className="cursor-move">
      <line
        x1={el.x2}
        y1={el.y2}
        x2={el.x1}
        y2={el.y1}
        stroke={stroke}
        strokeWidth={1}
        markerEnd="url(#fp-arrow)"
      />
      <line
        x1={el.x2}
        y1={el.y2}
        x2={el.x1}
        y2={el.y1}
        stroke="transparent"
        strokeWidth={14}
      />
      <text
        x={el.x2 + (el.x2 >= el.x1 ? 4 : -4)}
        y={el.y2 - 3}
        textAnchor={el.x2 >= el.x1 ? "start" : "end"}
        fontSize={11}
        fontWeight={500}
        fill={stroke}
      >
        {el.text}
      </text>
    </g>
  );
}

// SF totals breakdown shown in the inspector when nothing is selected.
// Lists each room with its area, plus subtotals grouped by label so multiple
// "Bedroom" rooms collapse into one summed line.
function TotalsPanel({ els }: { els: El[] }) {
  const schedule = useMemo(() => computeAreaSchedule(els as unknown as Parameters<typeof computeAreaSchedule>[0]), [els]);

  if (schedule.rows.length === 0) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
          Area schedule
        </div>
        <div className="text-[11px] text-muted-foreground/70">
          No rooms yet. Draw a room to start counting.
        </div>
      </div>
    );
  }

  const efficiency = schedule.bboxFt2 && schedule.bboxFt2 > 0
    ? Math.round((schedule.totalFt2 / schedule.bboxFt2) * 100)
    : null;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Area schedule
          </div>
          <div className="text-[10px] text-muted-foreground/50">{schedule.rows.length} room{schedule.rows.length === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/40 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1 bg-muted/30 text-[9px] uppercase tracking-wider text-muted-foreground/70">
            <span>Room</span>
            <span className="text-right">W × H</span>
            <span className="text-right">ft²</span>
          </div>
          <div className="divide-y divide-border/30 max-h-56 overflow-y-auto">
            {schedule.rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1.5 text-[11px] tabular-nums"
              >
                <span className="text-foreground truncate">{row.label}</span>
                <span className="text-muted-foreground">{row.widthFt}′ × {row.heightFt}′</span>
                <span className="font-medium">{row.areaFt2}</span>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between px-2 py-1.5 bg-muted/30 text-xs">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Net total</span>
            <span className="font-bold tabular-nums">{Math.round(schedule.totalFt2)} ft²</span>
          </div>
        </div>
      </div>

      {schedule.groups.length > 1 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
            By room type
          </div>
          <div className="rounded-md border border-border/40 bg-background/40 divide-y divide-border/30">
            {schedule.groups.map((g) => (
              <div
                key={g.label}
                className="flex items-baseline justify-between px-2 py-1 text-[11px]"
              >
                <span className="text-foreground truncate">
                  {g.label}
                  {g.count > 1 && <span className="text-muted-foreground/60"> ×{g.count}</span>}
                </span>
                <span className="font-medium tabular-nums">{Math.round(g.totalFt2)} ft²</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {efficiency !== null && (
        <div className="text-[10px] text-muted-foreground/70 leading-relaxed">
          Net <span className="font-medium text-foreground">{Math.round(schedule.totalFt2)} ft²</span> of bounding box <span className="font-medium text-foreground">{Math.round(schedule.bboxFt2 ?? 0)} ft²</span> · <span className="font-medium text-foreground">{efficiency}%</span> efficient
        </div>
      )}
    </div>
  );
}
