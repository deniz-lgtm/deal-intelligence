import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import {
  phaseKeyForMilestone,
  phaseToMilestoneShape,
} from "@/lib/legacy-schedule-compat";
import { recomputeSchedule } from "@/lib/schedule-recompute";
import type { DevPhase } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * Compatibility wrapper around the unified schedule API. The legacy
 * deal_milestones table is no longer the source of truth — this route
 * reads/writes deal_dev_phases (kind='milestone') so new milestones
 * created through the existing UI flow into the unified model and
 * surface in the Today-strip "Upcoming" feed.
 *
 * Response shape stays the legacy DealMilestone so ProjectManagement.tsx
 * keeps working without code changes. When the UI migrates to call
 * /schedule directly, this whole route can be deleted.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const phases = (await devPhaseQueries.getFiltered({
      deal_id: params.id,
      kind: "milestone",
    })) as DevPhase[];
    return NextResponse.json({ data: phases.map(phaseToMilestoneShape) });
  } catch (error) {
    console.error("GET /api/deals/[id]/milestones error:", error);
    return NextResponse.json({ error: "Failed to fetch milestones" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealEditAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    const { title, stage, target_date, sort_order } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const phase = await devPhaseQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      track: "development",
      kind: "milestone",
      phase_key: phaseKeyForMilestone(stage),
      label: title.trim(),
      // Milestones are point-in-time — start = end = the legacy
      // target_date so the CPM compute treats it as a zero-duration
      // event with a hard date.
      start_date: target_date || null,
      end_date: target_date || null,
      duration_days: 0,
      sort_order: sort_order ?? 0,
      is_milestone: true,
      status: "not_started",
    });

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("POST /api/deals/[id]/milestones recompute error:", err);
    }

    return NextResponse.json({ data: phaseToMilestoneShape(phase as DevPhase) });
  } catch (error) {
    console.error("POST /api/deals/[id]/milestones error:", error);
    return NextResponse.json({ error: "Failed to create milestone" }, { status: 500 });
  }
}
