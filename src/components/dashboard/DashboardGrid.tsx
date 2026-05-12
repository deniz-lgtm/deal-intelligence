"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Settings2, Trash2, X, Lock, Unlock, RotateCcw } from "lucide-react";

interface Layout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

interface GridProps {
  layout: Layout[];
  cols: number;
  rowHeight: number;
  margin: [number, number];
  width: number;
  onLayoutChange?: (layout: Layout[]) => void;
  isDraggable?: boolean;
  isResizable?: boolean;
  draggableCancel?: string;
  compactType?: "vertical" | "horizontal" | null;
  className?: string;
  children?: React.ReactNode;
}

interface UseContainerWidthResult {
  width: number;
  mounted: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
}

// react-grid-layout v2.x ships as CommonJS. Load via require and grab the named exports
// we need: the `GridLayout` class and the `useContainerWidth` hook (replaces the old WidthProvider HOC).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RGL = require("react-grid-layout") as {
  GridLayout: React.ComponentType<GridProps>;
  useContainerWidth: (opts?: { measureBeforeMount?: boolean; initialWidth?: number }) => UseContainerWidthResult;
};
const GridLayoutComponent = RGL.GridLayout;
const useContainerWidth = RGL.useContainerWidth;
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WIDGETS, renderWidgetConfig, DEFAULT_DASHBOARD } from "./registry";
import type {
  DashboardData,
  DashboardLayoutState,
  WidgetRenderProps,
} from "./types";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const STORAGE_KEY = "dashboard:layout:v1";

function loadLocal(): DashboardLayoutState {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD as DashboardLayoutState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DASHBOARD as DashboardLayoutState;
    const parsed = JSON.parse(raw) as DashboardLayoutState;
    if (!parsed.widgets || !parsed.layouts) return DEFAULT_DASHBOARD as DashboardLayoutState;
    return parsed;
  } catch {
    return DEFAULT_DASHBOARD as DashboardLayoutState;
  }
}

function saveLocal(state: DashboardLayoutState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

async function loadRemote(): Promise<DashboardLayoutState | null> {
  try {
    const res = await fetch("/api/dashboard/layout");
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.data || !json.data.widgets || !json.data.layouts) return null;
    return json.data as DashboardLayoutState;
  } catch {
    return null;
  }
}

async function saveRemote(state: DashboardLayoutState): Promise<void> {
  try {
    await fetch("/api/dashboard/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {
    // best effort — localStorage is the write-through cache so the user
    // doesn't lose their layout if the network round trip fails.
  }
}

interface DashboardGridProps {
  data: DashboardData;
}

export function DashboardGrid({ data }: DashboardGridProps) {
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<DashboardLayoutState>(DEFAULT_DASHBOARD as DashboardLayoutState);
  const [editMode, setEditMode] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true, initialWidth: 1200 });

  // Hydrate with localStorage immediately for fast first paint, then
  // reconcile with the server in the background. If the server has a
  // saved layout it wins; otherwise we treat the local copy as canonical
  // and push it up.
  useEffect(() => {
    let cancelled = false;
    setState(loadLocal());
    setHydrated(true);
    (async () => {
      const remote = await loadRemote();
      if (!cancelled && remote) setState(remote);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced write-through: localStorage on every change (instant),
  // server every 800ms idle (resilient to rapid drag/resize).
  useEffect(() => {
    if (!hydrated) return;
    saveLocal(state);
    const t = setTimeout(() => {
      saveRemote(state);
    }, 800);
    return () => clearTimeout(t);
  }, [state, hydrated]);

  const onLayoutChange = useCallback((layout: Layout[]) => {
    setState((prev) => ({
      ...prev,
      layouts: { ...prev.layouts, lg: layout.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h })) },
    }));
  }, []);

  const removeWidget = (id: string) => {
    setState((prev) => ({
      widgets: prev.widgets.filter((w) => w.id !== id),
      layouts: { ...prev.layouts, lg: (prev.layouts.lg ?? []).filter((l) => l.i !== id) },
    }));
  };

  const updateWidgetConfig = (id: string, config: Record<string, unknown>) => {
    setState((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => (w.id === id ? { ...w, config } : w)),
    }));
  };

  const addWidget = (type: string) => {
    const def = WIDGETS[type];
    if (!def) return;
    const id = `${type}-${Date.now().toString(36)}`;
    const existing = state.layouts.lg ?? [];
    const maxY = existing.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    setState((prev) => ({
      widgets: [
        ...prev.widgets,
        { id, type, config: type === "kpi" ? { metric: "active_deals" } : type === "chart" ? { chartType: "bar", groupBy: "phase", metric: "count" } : {} },
      ],
      layouts: {
        ...prev.layouts,
        lg: [
          ...existing,
          { i: id, x: 0, y: maxY, w: def.defaultSize.w, h: def.defaultSize.h },
        ],
      },
    }));
    setShowAdd(false);
  };

  const resetLayout = () => {
    if (!confirm("Reset dashboard to default layout?")) return;
    setState(DEFAULT_DASHBOARD as DashboardLayoutState);
    // Clear server-side too so the next device load gets defaults instead
    // of the stale layout that just got reset.
    fetch("/api/dashboard/layout", { method: "DELETE" }).catch(() => {});
  };

  const configuringWidget = useMemo(
    () => state.widgets.find((w) => w.id === configuring) ?? null,
    [state.widgets, configuring],
  );

  if (!hydrated) {
    return <div className="p-8 text-sm text-muted-foreground">Loading dashboard…</div>;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="font-nameplate text-lg leading-none tracking-tight">Pipeline Dashboard</span>
          <span className="text-2xs uppercase tracking-[0.18em] text-muted-foreground/60">
            {data.deals.length} deals
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {editMode && (
            <>
              <Button variant="ghost" size="sm" onClick={resetLayout} className="h-8 text-xs">
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(true)} className="h-8 text-xs">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Widget
              </Button>
            </>
          )}
          <Button
            variant={editMode ? "default" : "ghost"}
            size="sm"
            onClick={() => setEditMode((v) => !v)}
            className="h-8 text-xs"
          >
            {editMode ? <Unlock className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
            {editMode ? "Editing" : "Edit"}
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <GridLayoutComponent
          className="layout"
          layout={state.layouts.lg ?? []}
          cols={12}
          rowHeight={32}
          margin={[12, 12]}
          width={mounted ? width : 1200}
          onLayoutChange={onLayoutChange}
          isDraggable={editMode}
          isResizable={editMode}
          draggableCancel=".widget-no-drag"
          compactType="vertical"
        >
          {state.widgets.map((instance) => {
            const def = WIDGETS[instance.type];
            if (!def) return <div key={instance.id} />;
            const renderProps: WidgetRenderProps = {
              data,
              instance,
              onConfigChange: (cfg) => updateWidgetConfig(instance.id, cfg),
            };
            return (
              <div
                key={instance.id}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-xl border border-border/40 bg-card/60 shadow-sm backdrop-blur-sm",
                  editMode && "ring-1 ring-border/50 hover:ring-primary/40",
                )}
              >
                {editMode && (
                  <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 opacity-80 transition-opacity">
                    {def.type !== "phase_kanban" && (
                      <button
                        onClick={() => setConfiguring(instance.id)}
                        className="widget-no-drag flex h-6 w-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground"
                        aria-label="Configure widget"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => removeWidget(instance.id)}
                      className="widget-no-drag flex h-6 w-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground hover:bg-background hover:text-rose-400"
                      aria-label="Remove widget"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className={cn("h-full min-h-0", editMode && instance.type !== "phase_kanban" && "pointer-events-none")}>
                  {def.render(renderProps)}
                </div>
              </div>
            );
          })}
        </GridLayoutComponent>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div
            className="w-full max-w-md rounded-xl border border-border/60 bg-card p-5 shadow-lifted"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-nameplate text-lg tracking-tight">Add Widget</h3>
              <button onClick={() => setShowAdd(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {Object.values(WIDGETS).map((w) => (
                <button
                  key={w.type}
                  onClick={() => addWidget(w.type)}
                  className="flex flex-col gap-1 rounded-lg border border-border/40 bg-background/40 p-3 text-left transition-colors hover:border-primary/40 hover:bg-background"
                >
                  <span className="text-sm font-medium">{w.label}</span>
                  <span className="text-xs text-muted-foreground">{w.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {configuringWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm" onClick={() => setConfiguring(null)}>
          <div
            className="w-full max-w-md rounded-xl border border-border/60 bg-card p-5 shadow-lifted"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-nameplate text-lg tracking-tight">
                Configure {WIDGETS[configuringWidget.type]?.label}
              </h3>
              <button onClick={() => setConfiguring(null)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {renderWidgetConfig(configuringWidget.type, {
              data,
              instance: configuringWidget,
              onConfigChange: (cfg) => updateWidgetConfig(configuringWidget.id, cfg),
            })}
          </div>
        </div>
      )}
    </div>
  );
}
