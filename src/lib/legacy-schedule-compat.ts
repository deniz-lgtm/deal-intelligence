// Legacy-shape compatibility layer for the unified schedule.
//
// Phase 1 step 5: the four legacy routes (/api/deals/[id]/milestones,
// /milestones/[id], /tasks, /tasks/[id]) plus the bulk seeders
// (/tasks/seed, /tasks/ai-suggest) used to read/write deal_milestones
// and deal_tasks. They now read/write deal_dev_phases instead, but the
// existing UI (ProjectManagement.tsx) and any external callers still
// expect the legacy DealMilestone / DealTask response shapes.
//
// This file is the only place we map between the unified DevPhase row
// and those legacy shapes. When a follow-up retires the legacy routes
// entirely, this file goes too.

import { getPool } from "@/lib/db";
import type { DevPhase } from "@/lib/types";

export type LegacyMilestone = {
  id: string;
  deal_id: string;
  title: string;
  stage: string | null;
  target_date: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type LegacyTask = {
  id: string;
  deal_id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  status: "todo" | "in_progress" | "done" | "blocked";
  milestone_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const LEGACY_MILESTONE_PREFIX = "legacy_milestone_";

/** Pull the original `stage` value out of a phase_key. NULL when the
 * row wasn't migrated from a legacy milestone (so phase_key doesn't
 * carry the prefix). */
export function extractStageFromPhaseKey(phaseKey: string | null | undefined): string | null {
  if (!phaseKey || !phaseKey.startsWith(LEGACY_MILESTONE_PREFIX)) return null;
  const stage = phaseKey.slice(LEGACY_MILESTONE_PREFIX.length);
  return stage === "unknown" || stage === "" ? null : stage;
}

/** Encode a legacy `stage` value back into a phase_key for new rows
 * created via the milestone POST compat wrapper. */
export function phaseKeyForMilestone(stage: string | null | undefined): string {
  return `${LEGACY_MILESTONE_PREFIX}${stage || "unknown"}`;
}

/** Map dev_phase.status → legacy task.status. The unified model has a
 * 'delayed' status we surface as the legacy 'blocked' state since
 * neither the kanban nor the Today strip distinguish between them. */
export function phaseStatusToTaskStatus(s: string | null | undefined): LegacyTask["status"] {
  if (s === "complete") return "done";
  if (s === "in_progress") return "in_progress";
  if (s === "delayed") return "blocked";
  return "todo";
}

/** Map legacy task.status → dev_phase.status for INSERT / UPDATE bodies. */
export function taskStatusToPhaseStatus(s: string | null | undefined): string {
  if (s === "done") return "complete";
  if (s === "in_progress") return "in_progress";
  if (s === "blocked") return "delayed";
  return "not_started";
}

/** Render a DevPhase row in the legacy DealMilestone shape. */
export function phaseToMilestoneShape(p: DevPhase): LegacyMilestone {
  return {
    id: p.id,
    deal_id: p.deal_id,
    title: p.label,
    stage: extractStageFromPhaseKey(p.phase_key),
    // Milestones are point-in-time, so end_date == start_date == the
    // legacy target_date. Read from end_date because that's what the
    // CPM compute keeps in sync.
    target_date: p.end_date,
    completed_at: p.completed_at,
    sort_order: p.sort_order,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/** Render a DevPhase row in the legacy DealTask shape. */
export function phaseToTaskShape(p: DevPhase): LegacyTask {
  return {
    id: p.id,
    deal_id: p.deal_id,
    title: p.label,
    description: p.notes,
    // task_owner carries the legacy assignee free-text after migration;
    // for newly-created compat-wrapper tasks we also write through to
    // task_owner so this round-trips cleanly.
    assignee: p.task_owner,
    due_date: p.end_date,
    // Priority isn't tracked on the unified model. Always present in
    // the legacy shape, so we hand back the default.
    priority: "medium",
    status: phaseStatusToTaskStatus(p.status),
    milestone_id: p.parent_phase_id,
    sort_order: p.sort_order,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/**
 * Resolve the URL `[milestoneId]` or `[taskId]` parameter to the
 * corresponding deal_dev_phases row. The id might be a dev_phase id
 * directly (for rows newly created via the compat wrapper) OR the
 * original legacy id (for rows the UI cached pre-migration); either
 * lookup wins.
 *
 * deal_id constrains the query so the same id format used for dev-phase
 * rows in #150 still applies — a row from a different deal returns null.
 */
export async function resolveLegacyPhase(
  dealId: string,
  urlId: string,
  legacyType: "milestone" | "task"
): Promise<DevPhase | null> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT * FROM deal_dev_phases
     WHERE deal_id = $1
       AND (id = $2 OR (source_legacy_type = $3 AND source_legacy_id = $2))
     LIMIT 1`,
    [dealId, urlId, legacyType]
  );
  return (res.rows[0] as DevPhase | undefined) ?? null;
}
