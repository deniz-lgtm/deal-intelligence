"use client";

import { useEffect, useState } from "react";
import { DEAL_PIPELINE, DEAL_STAGE_LABELS } from "@/lib/types";
import type { DealStatus } from "@/lib/types";

export interface PipelineStage {
  id: string;
  label: string;
  sort_order: number;
  color: string | null;
  is_terminal: boolean;
}

const DEFAULT_STAGES: PipelineStage[] = DEAL_PIPELINE.map((id, i) => ({
  id,
  label: DEAL_STAGE_LABELS[id] ?? id,
  sort_order: i,
  color: null,
  is_terminal: id === "closed",
}));

let cache: PipelineStage[] | null = null;
let inflight: Promise<PipelineStage[]> | null = null;

async function fetchPipeline(): Promise<PipelineStage[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/pipeline");
      if (!res.ok) return DEFAULT_STAGES;
      const json = await res.json();
      const data = (json.data ?? []) as PipelineStage[];
      cache = data.length > 0 ? data : DEFAULT_STAGES;
      return cache;
    } catch {
      return DEFAULT_STAGES;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Returns the effective pipeline stages (admin overrides if any) plus a
 * label-lookup helper. Falls back to defaults instantly while loading so the
 * kanban never shows blank columns.
 */
export function usePipeline() {
  const [stages, setStages] = useState<PipelineStage[]>(cache ?? DEFAULT_STAGES);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    fetchPipeline().then((data) => {
      if (!cancelled) setStages(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const labelMap: Record<string, string> = {};
  for (const s of stages) labelMap[s.id] = s.label;
  // Ensure off-pipeline statuses still have labels
  for (const k of Object.keys(DEAL_STAGE_LABELS)) {
    if (!(k in labelMap)) labelMap[k] = DEAL_STAGE_LABELS[k as DealStatus];
  }

  const colorMap: Record<string, string | null> = {};
  for (const s of stages) colorMap[s.id] = s.color;

  return { stages, labelMap, colorMap };
}
