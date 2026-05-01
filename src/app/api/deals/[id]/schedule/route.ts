import { NextRequest, NextResponse } from "next/server";
import { devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

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
