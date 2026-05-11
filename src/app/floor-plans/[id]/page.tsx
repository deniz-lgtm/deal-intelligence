"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { FloorPlanEditor, type FloorPlanEditorState } from "@/components/floor-plan/FloorPlanEditor";
import { MetricsPanel, type MetricRow } from "@/components/floor-plan/MetricsPanel";
import { getUnitTypeById } from "@/lib/floor-plan-unit-types";

interface FloorPlanFull {
  id: string;
  name: string;
  unit_type: string;
  bedrooms: number;
  bathrooms: number;
  square_footage: number | null;
  description: string | null;
  plan_data: FloorPlanEditorState | null;
  updated_at: string;
  metrics: MetricRow[];
}

// Save status indicator state. We treat the editor body separately from the
// metadata fields (name, SF, description) — both can have their own dirty
// timer so a quick rename doesn't stall the auto-save of the canvas.
type SaveStatus = "idle" | "dirty" | "saving" | "saved";

const AUTOSAVE_DELAY_MS = 1200;

export default function FloorPlanEditorPage({ params }: { params: { id: string } }) {
  const [plan, setPlan] = useState<FloorPlanFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Meta fields stored locally so the inputs feel snappy; persisted through
  // the same debounced PATCH that handles plan_data.
  const [name, setName] = useState("");
  const [squareFootage, setSquareFootage] = useState<string>("");
  const [description, setDescription] = useState("");

  const [editorState, setEditorState] = useState<FloorPlanEditorState | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/floor-plans/${params.id}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled || !json?.data) return;
        const full = json.data as FloorPlanFull;
        setPlan(full);
        setName(full.name);
        setSquareFootage(full.square_footage ? String(full.square_footage) : "");
        setDescription(full.description ?? "");
        setEditorState(full.plan_data && typeof full.plan_data === "object"
          ? (full.plan_data as FloorPlanEditorState)
          : { els: [], title: full.name });
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id]);

  // Debounced auto-save. Each time the editor state or any meta field
  // changes, we mark dirty and queue a save. A leading-edge save would be
  // smoother but the canvas emits state changes constantly while dragging.
  const scheduleSave = useCallback((nextEditorState?: FloorPlanEditorState) => {
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        const body: Record<string, unknown> = {
          name: name.trim() || "Untitled Plan",
          square_footage: squareFootage ? Number(squareFootage) : null,
          description: description.trim() || null,
        };
        const finalEditor = nextEditorState ?? editorState;
        if (finalEditor) body.plan_data = finalEditor;
        await fetch(`/api/floor-plans/${params.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setStatus("saved");
        // Brief settle to "idle" so the badge doesn't shout forever.
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (err) {
        console.error("Floor plan save failed", err);
        setStatus("dirty");
      }
    }, AUTOSAVE_DELAY_MS);
  }, [params.id, name, squareFootage, description, editorState]);

  // Save meta on field change.
  useEffect(() => {
    if (!plan) return;
    scheduleSave();
    // We deliberately exclude scheduleSave from deps — it would loop. The
    // values it closes over are exactly the ones that should trigger a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, squareFootage, description]);

  const handleEditorChange = useCallback((state: FloorPlanEditorState) => {
    setEditorState(state);
    scheduleSave(state);
  }, [scheduleSave]);

  if (notFound) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center py-20">
          <div className="text-center">
            <h1 className="font-display text-xl">Floor plan not found</h1>
            <Button asChild size="sm" variant="outline" className="mt-4">
              <Link href="/floor-plans">Back to library</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (loading || !plan || !editorState) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading plan…
        </div>
      </AppShell>
    );
  }

  const unitDef = getUnitTypeById(plan.unit_type);

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border/40 px-6 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <Link href="/floor-plans" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" />
              Library
            </Link>
            <span className="text-border text-xs">/</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-[200px] max-w-md flex-1 truncate rounded border-b border-transparent bg-transparent px-1 py-0.5 font-display text-base outline-none focus:border-primary/40"
              placeholder="Plan name"
            />
            <span className="text-2xs uppercase tracking-wider text-muted-foreground/60">{unitDef?.label ?? plan.unit_type}</span>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <SaveBadge status={status} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{plan.bedrooms === 0 ? "Studio" : `${plan.bedrooms} BR`} · {plan.bathrooms} BA</span>
            <label className="inline-flex items-center gap-1">
              <span>SF</span>
              <input
                type="number"
                min={0}
                value={squareFootage}
                onChange={(e) => setSquareFootage(e.target.value)}
                className="w-20 rounded border border-border/40 bg-background/60 px-1.5 py-0.5 text-xs tabular-nums focus:border-primary/40 focus:outline-none"
              />
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description…"
              className="min-w-[200px] flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-muted-foreground hover:border-border/40 focus:border-primary/40 focus:bg-background/60 focus:text-foreground focus:outline-none"
            />
          </div>
        </header>

        <div className="flex-1 min-h-0">
          <FloorPlanEditor initialState={editorState} onChange={handleEditorChange} />
        </div>

        <div className="shrink-0 border-t border-border/40 bg-background/60 px-6 py-5 sm:px-8">
          <MetricsPanel
            floorPlanId={plan.id}
            squareFootage={squareFootage ? Number(squareFootage) : null}
            metrics={plan.metrics}
            onChange={(metrics) => setPlan((p) => p ? { ...p, metrics } : p)}
          />
        </div>
      </div>
    </AppShell>
  );
}

function SaveBadge({ status }: { status: SaveStatus }) {
  if (status === "saving") return <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving</span>;
  if (status === "saved") return <span className="inline-flex items-center gap-1 text-emerald-500"><Check className="h-3 w-3" /> Saved</span>;
  if (status === "dirty") return <span className="inline-flex items-center gap-1"><Save className="h-3 w-3" /> Unsaved</span>;
  return null;
}
