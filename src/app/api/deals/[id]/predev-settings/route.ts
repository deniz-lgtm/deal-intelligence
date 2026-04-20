import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { DEFAULT_PREDEV_THRESHOLDS } from "@/lib/types";

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
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const pool = getPool();
    const res = await pool.query("SELECT predev_settings FROM deals WHERE id = $1", [params.id]);
    const settings = res.rows[0]?.predev_settings || {
      total_budget: null,
      thresholds: DEFAULT_PREDEV_THRESHOLDS,
    };
    return NextResponse.json({ data: settings });
  } catch (error) {
    console.error("GET /api/deals/[id]/predev-settings error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const pool = getPool();
    const body = await req.json();
    await pool.query(
      "UPDATE deals SET predev_settings = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(body), params.id]
    );
    return NextResponse.json({ data: body });
  } catch (error) {
    console.error("PATCH /api/deals/[id]/predev-settings error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
