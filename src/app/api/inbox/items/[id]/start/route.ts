import { NextRequest, NextResponse } from "next/server";
import { dealQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { startInboxAnalysis } from "@/lib/inbox";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/inbox/items/[id]/start
 * Body: {
 *   business_plan_id: string;
 *   property_type: string;
 *   investment_strategy: string;
 * }
 *
 * The inbox page shows auto-ingested OMs with extracted property info
 * and three required dropdowns. When the user has picked a business
 * plan + property type + investment strategy and clicks "Start
 * Analysis", this endpoint:
 *
 *   1. Validates the inputs and the deal
 *   2. Persists the selections on the deal
 *   3. Transitions the deal from `sourcing` → `screening` (initial review)
 *   4. Kicks off the full 4-stage OM analysis in the background
 *
 * Returns the new analysis id so the client can navigate to the
 * /deals/:id/om-analysis page and watch the processing state.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const businessPlanId = typeof body.business_plan_id === "string" ? body.business_plan_id.trim() : "";
    const propertyType = typeof body.property_type === "string" ? body.property_type.trim() : "";
    const investmentStrategy = typeof body.investment_strategy === "string" ? body.investment_strategy.trim() : "";

    const missing: string[] = [];
    if (!businessPlanId) missing.push("business_plan_id");
    if (!propertyType) missing.push("property_type");
    if (!investmentStrategy) missing.push("investment_strategy");
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required field(s): ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // Access check for inbox items is custom: a deal is startable if
    // the caller owns it, has an explicit share, OR the deal is
    // orphaned (owner_id IS NULL — ingested before we started stamping
    // ownership). Standard requireDealAccess rejects orphans with
    // "Deal not found", which looked like the polling flow was broken.
    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    if (!deal.auto_ingested) {
      return NextResponse.json(
        { error: "Not an auto-ingested inbox item" },
        { status: 400 }
      );
    }
    const isOwner = deal.owner_id === userId;
    const isOrphan = deal.owner_id == null;
    if (!isOwner && !isOrphan) {
      // Could add a deal_shares check here, but for inbox items that's
      // unusual — sharing typically happens after Start Analysis.
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    // Lazy claim: stamp ownership on orphans so subsequent requests
    // (underwriting saves, deal-score, etc.) pass the standard access
    // gate without special-casing.
    if (isOrphan) {
      await dealQueries.update(params.id, { owner_id: userId });
    }

    const result = await startInboxAnalysis({
      dealId: params.id,
      businessPlanId,
      propertyType,
      investmentStrategy,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("POST /api/inbox/items/[id]/start error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to start analysis: ${msg}` },
      { status: 500 }
    );
  }
}
