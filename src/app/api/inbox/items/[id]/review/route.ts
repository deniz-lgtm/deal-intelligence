import { NextRequest, NextResponse } from "next/server";
import { dealQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/inbox/items/[id]/review
 * Body: { dismiss?: boolean }
 *
 * Marks an auto-ingested deal as reviewed so it disappears from the
 * Inbox list. If `dismiss: true` is passed, the deal is moved to the
 * `dead` stage at the same time (analyst doesn't want to pursue it).
 * Otherwise the deal stays where it is (sourcing) and just gets the
 * `inbox_reviewed_at` timestamp set.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const dismiss = Boolean(body.dismiss);

    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!deal.auto_ingested) {
      return NextResponse.json(
        { error: "Not an auto-ingested deal" },
        { status: 400 }
      );
    }

    await dealQueries.markInboxReviewed(params.id);
    if (dismiss) {
      await dealQueries.update(params.id, { status: "dead" });
    }

    const updated = await dealQueries.getById(params.id);
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("POST /api/inbox/items/[id]/review error:", error);
    return NextResponse.json(
      { error: "Failed to review inbox item" },
      { status: 500 }
    );
  }
}
