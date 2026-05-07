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
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// A simple SVG-based floor plan sketcher. One canvas per plan, four element
// types (room rectangles, walls, doors, windows, free-text labels). Coordinates
// live on a 1ft grid (PX_PER_FT below). No persistence yet — this is a sketch
// pad for showing intent to teammates / architects, exportable to PNG.

const PX_PER_FT = 12; // 12px = 1 ft on screen
const GRID = PX_PER_FT; // snap to 1 ft

type ToolId = "select" | "room" | "wall" | "door" | "window" | "label";

interface BaseEl {
  id: string;
  type: "room" | "wall" | "door" | "window" | "label";
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
  rotation: number; // degrees
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
type El = RoomEl | WallEl | DoorEl | WindowEl | LabelEl;

interface State {
  els: El[];
  title: string;
}

const EMPTY_STATE: State = { els: [], title: "Untitled Plan" };
const STORAGE_KEY = "floorPlanEditor.v1";

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const TOOLS: { id: ToolId; label: string; icon: typeof MousePointer2 }[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "room", label: "Room", icon: Square },
  { id: "wall", label: "Wall", icon: Minus },
  { id: "door", label: "Door", icon: DoorOpen },
  { id: "window", label: "Window", icon: RectangleHorizontal },
  { id: "label", label: "Label", icon: Type },
];

export function FloorPlanEditor() {
  const [state, setState] = useState<State>(EMPTY_STATE);
  const [tool, setTool] = useState<ToolId>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<
    | { kind: "draw-room"; sx: number; sy: number; cx: number; cy: number }
    | { kind: "draw-wall"; sx: number; sy: number; cx: number; cy: number }
    | { kind: "move-el"; id: string; ox: number; oy: number; sx: number; sy: number }
    | null
  >(null);
  const [history, setHistory] = useState<State[]>([]);
  const [future, setFuture] = useState<State[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // Hydrate once from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [state]);

  const commit = useCallback(
    (next: State | ((s: State) => State)) => {
      setState((prev) => {
        const resolved = typeof next === "function" ? (next as (s: State) => State)(prev) : next;
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

  // Keyboard: Delete to remove selection, Esc to deselect, ⌘Z / ⌘⇧Z.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        commit((s) => ({ ...s, els: s.els.filter((el) => el.id !== selectedId) }));
        setSelectedId(null);
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setTool("select");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        e.preventDefault();
        redo();
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
    const sx = snap(x);
    const sy = snap(y);

    if (tool === "select") {
      // Click on empty canvas clears selection.
      if (e.target === svgRef.current) setSelectedId(null);
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
    }
  };

  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const { x, y } = svgPoint(e);
    const cx = snap(x);
    const cy = snap(y);
    if (drag.kind === "draw-room" || drag.kind === "draw-wall") {
      setDrag({ ...drag, cx, cy });
    } else if (drag.kind === "move-el") {
      const dx = cx - drag.sx;
      const dy = cy - drag.sy;
      setState((s) => ({
        ...s,
        els: s.els.map((el) => {
          if (el.id !== drag.id) return el;
          if (el.type === "room") {
            return { ...el, x: drag.ox + dx, y: drag.oy + dy };
          }
          if (el.type === "wall") {
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
        // Constrain to nearest axis for cleaner sketches.
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
      // Move-el state already mutated through setState above; still record an
      // entry on history for undo. Snapshot current state as redo target.
      commit((s) => s);
    }
    setDrag(null);
  };

  const startMove = (e: React.MouseEvent, el: El) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSelectedId(el.id);
    const { x, y } = svgPoint(e);
    const sx = snap(x);
    const sy = snap(y);
    let ox = 0;
    let oy = 0;
    if (el.type === "room" || el.type === "door" || el.type === "window" || el.type === "label") {
      ox = el.x;
      oy = el.y;
    } else if (el.type === "wall") {
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

  const clearAll = () => {
    if (!window.confirm("Clear the entire plan?")) return;
    commit({ ...EMPTY_STATE, title: state.title });
    setSelectedId(null);
  };

  // Compute draft preview for in-progress draw drag.
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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-card/40 shrink-0">
        <input
          value={state.title}
          onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
          className="text-sm font-medium bg-transparent border-b border-transparent hover:border-border/50 focus:border-primary/50 focus:outline-none px-1 py-0.5 mr-2 min-w-[180px]"
          placeholder="Plan title"
        />
        <div className="flex items-center rounded-md border border-border/50 bg-background/50 overflow-hidden">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
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
        <div className="flex-1" />
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-medium hover:opacity-90"
        >
          <Download className="h-3.5 w-3.5" />
          Export PNG
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
                        {ft2} sq ft
                      </text>
                    </g>
                  );
                }
                if (el.type === "wall") {
                  return (
                    <line
                      key={el.id}
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
                return null;
              })}

              {/* Draft previews */}
              {draftRoom && (
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
              )}
              {draftWall && (
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
              )}
            </svg>
          </div>
        </div>

        {/* Right inspector */}
        <aside className="w-64 border-l border-border/40 bg-card/30 p-4 shrink-0 overflow-y-auto">
          {!selectedEl ? (
            <div className="text-xs text-muted-foreground space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                  How to use
                </div>
                <ul className="space-y-1.5 leading-relaxed">
                  <li>• Pick a tool, then drag (room/wall) or click (door/window/label) on the canvas.</li>
                  <li>• Walls auto-straighten to the dominant axis.</li>
                  <li>• Click anything with the Select tool to edit or move.</li>
                  <li>• Delete / Backspace removes selection.</li>
                  <li>• ⌘Z to undo, ⌘⇧Z to redo.</li>
                  <li>• Plan auto-saves to your browser.</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {selectedEl.type}
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
                        updateSelected({ w: Math.max(1, Number(e.target.value)) * PX_PER_FT })
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
                        updateSelected({ h: Math.max(1, Number(e.target.value)) * PX_PER_FT })
                      }
                      className="w-full text-xs px-2 py-1 rounded border border-border/50 bg-background"
                    />
                  </Field>
                  <div className="text-[11px] text-muted-foreground pt-1">
                    {Math.round((selectedEl.w / PX_PER_FT) * (selectedEl.h / PX_PER_FT))} sq ft
                  </div>
                </>
              )}
              {(selectedEl.type === "door" || selectedEl.type === "window") && (
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
              {selectedEl.type === "label" && (
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
                  commit((s) => ({ ...s, els: s.els.filter((el) => el.id !== selectedEl.id) }));
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
