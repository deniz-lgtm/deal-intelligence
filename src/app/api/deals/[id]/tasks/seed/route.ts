import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealEditAccess } from "@/lib/auth";
import { DEFAULT_MILESTONES, DEFAULT_TASKS } from "@/lib/types";
import {
  phaseKeyForMilestone,
  phaseToMilestoneShape,
  phaseToTaskShape,
} from "@/lib/legacy-schedule-compat";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import type { DevPhase } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * Compat seeder. Creates the DEFAULT_MILESTONES + DEFAULT_TASKS as
 * deal_dev_phases rows (kind='milestone' / 'task') the first time
 * ProjectManagement.tsx loads for a deal. No-op if any milestones or
 * tasks already exist on the deal — the existing rows come back so the
 * UI renders them.
 *
 * Response shape stays { milestones: DealMilestone[], tasks: DealTask[],
 * seeded: boolean } so the UI's first-load flow keeps working.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const existingMilestones = (await devPhaseQueries.getFiltered({
      deal_id: params.id,
      kind: "milestone",
    })) as DevPhase[];
    const existingTasks = (await devPhaseQueries.getFiltered({
      deal_id: params.id,
      kind: "task",
    })) as DevPhase[];

    if (existingMilestones.length > 0 || existingTasks.length > 0) {
      return NextResponse.json({
        data: {
          milestones: existingMilestones.map(phaseToMilestoneShape),
          tasks: existingTasks.map(phaseToTaskShape),
          seeded: false,
        },
      });
    }

    // Seed milestones first so we can wire up child tasks via
    // parent_phase_id. Map by title because DEFAULT_TASKS references
    // milestones by `milestone_title`.
    const milestoneIdByTitle = new Map<string, string>();
    const seededMilestones: DevPhase[] = [];
    for (let i = 0; i < DEFAULT_MILESTONES.length; i++) {
      const m = DEFAULT_MILESTONES[i];
      const id = uuidv4();
      milestoneIdByTitle.set(m.title, id);
      const phase = await devPhaseQueries.create({
        id,
        deal_id: params.id,
        track: "development",
        kind: "milestone",
        phase_key: phaseKeyForMilestone(m.stage),
        label: m.title,
        sort_order: i,
        is_milestone: true,
        duration_days: 0,
        status: "not_started",
      });
      seededMilestones.push(phase as DevPhase);
    }

    const seededTasks: DevPhase[] = [];
    for (let i = 0; i < DEFAULT_TASKS.length; i++) {
      const t = DEFAULT_TASKS[i];
      const parentPhaseId = t.milestone_title
        ? milestoneIdByTitle.get(t.milestone_title) ?? null
        : null;
      const phase = await devPhaseQueries.create({
        id: uuidv4(),
        deal_id: params.id,
        track: "development",
        kind: "task",
        phase_key: "legacy_task",
        label: t.title,
        parent_phase_id: parentPhaseId,
        sort_order: i,
        duration_days: 1,
        status: "not_started",
        is_milestone: false,
      });
      seededTasks.push(phase as DevPhase);
    }

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("POST /api/deals/[id]/tasks/seed recompute error:", err);
    }

    return NextResponse.json({
      data: {
        milestones: seededMilestones.map(phaseToMilestoneShape),
        tasks: seededTasks.map(phaseToTaskShape),
        seeded: true,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/tasks/seed error:", error);
    return NextResponse.json({ error: "Failed to seed project data" }, { status: 500 });
  }
}
