import { NextRequest, NextResponse } from "next/server";
import { dealQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { DEFAULT_HARDCOST_THRESHOLDS } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { deal, errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const settings = deal.hardcost_settings ?? {
      total_budget: null,
      thresholds: DEFAULT_HARDCOST_THRESHOLDS,
    };
    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error("GET /api/deals/[id]/hardcost-settings error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();
    await dealQueries.update(params.id, { hardcost_settings: JSON.stringify(body) });
    return NextResponse.json({ data: body });
  } catch (error) {
    console.error("PUT /api/deals/[id]/hardcost-settings error:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
