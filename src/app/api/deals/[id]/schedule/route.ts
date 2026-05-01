import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import { recomputeSchedule } from "@/lib/schedule-recompute";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

const ALLOWED_TRACKS = new Set(["acquisition", "development", "construction"]);
const ALLOWED_KINDS = new Set(["phase", "milestone", "task"]);

/**
 * GET /api/deals/[id]/schedule
 *
 * The unified read surface for the schedule. Returns rows from
 * `deal_dev_phases` — which now contains the Acq / Dev / Construction
 * phases AND the milestones + tasks that used to live in the legacy
 * `deal_milestones` / `deal_tasks` tables (migrated by ensureColumns).
 *
 * Optional filters:
 *   ?track=acquisition|development|construction
 *   ?kind=phase|milestone|task
 *   ?parent_phase_id=<id>  // drill into one parent's children (used by
 *                          //   Schedule Focus Views in Theme 2.5)
 *
 * The legacy `/api/deals/[id]/dev-schedule` route stays operational for
 * now so we can switch over readers incrementally — both endpoints read
 * from the same table, so the data is consistent.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const sp = req.nextUrl.searchParams;
    const track = sp.get("track");
    const kind = sp.get("kind");
    const parent = sp.get("parent_phase_id");

    if (track && !ALLOWED_TRACKS.has(track)) {
      return NextResponse.json(
        { error: `Invalid track: ${track}` },
        { status: 400 }
      );
    }
    if (kind && !ALLOWED_KINDS.has(kind)) {
      return NextResponse.json(
        { error: `Invalid kind: ${kind}` },
        { status: 400 }
      );
    }

    const rows = await devPhaseQueries.getFiltered({
      deal_id: params.id,
      track,
      kind,
      parent_phase_id: parent,
    });
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/schedule error:", error);
    return NextResponse.json(
      { error: "Failed to fetch schedule" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/deals/[id]/schedule
 *
 * Create a new schedule item — phase, milestone, or task — on the deal.
 * Body fields mirror DevPhase columns; `kind` is required and must be
 * one of phase | milestone | task.
 *
 * The legacy /milestones and /tasks POST routes are converted to compat
 * wrappers around this in a follow-up so all writes converge here.
 */
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
    }

    const kind = body.kind ?? "phase";
    if (!ALLOWED_KINDS.has(kind)) {
      return NextResponse.json({ error: `Invalid kind: ${kind}` }, { status: 400 });
    }

    const track = body.track ?? "development";
    if (!ALLOWED_TRACKS.has(track)) {
      return NextResponse.json({ error: `Invalid track: ${track}` }, { status: 400 });
    }

    if (typeof body.label !== "string" || body.label.trim() === "") {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }

    // Inherit the parent's track when a parent_phase_id is set so child
    // tasks can't end up dangling on a different track from their parent.
    let resolvedTrack = track;
    if (body.parent_phase_id) {
      const parent = (await devPhaseQueries.getFiltered({
        deal_id: params.id,
      })).find((p) => p.id === body.parent_phase_id);
      if (!parent) {
        return NextResponse.json(
          { error: "parent_phase_id not found in this deal" },
          { status: 400 }
        );
      }
      resolvedTrack = parent.track;
    }

    const created = await devPhaseQueries.create({
      id: uuidv4(),
      deal_id: params.id,
      track: resolvedTrack,
      kind,
      phase_key: body.phase_key ?? `${kind}_${Date.now()}`,
      label: body.label,
      start_date: body.start_date ?? null,
      end_date: body.end_date ?? null,
      duration_days: body.duration_days ?? (kind === "milestone" ? 0 : null),
      predecessor_id: body.predecessor_id ?? null,
      lag_days: body.lag_days ?? 0,
      parent_phase_id: body.parent_phase_id ?? null,
      task_category: body.task_category ?? null,
      task_owner: body.task_owner ?? null,
      assignee_user_id: body.assignee_user_id ?? null,
      linked_document_ids: body.linked_document_ids ?? null,
      pct_complete: body.pct_complete ?? 0,
      budget: body.budget ?? null,
      status: body.status ?? "not_started",
      notes: body.notes ?? null,
      sort_order: body.sort_order ?? 0,
      // is_milestone stays synced for back-compat with readers that
      // haven't moved to `kind` yet. devPhaseQueries.create handles
      // this automatically when kind === "milestone", but setting it
      // explicitly keeps the route handler legible.
      is_milestone: kind === "milestone",
    });

    try {
      await recomputeSchedule(params.id);
    } catch (err) {
      console.error("POST /api/deals/[id]/schedule recompute error:", err);
    }

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    console.error("POST /api/deals/[id]/schedule error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to create schedule item", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}
