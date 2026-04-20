import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

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
    const res = await pool.query("SELECT ceqa_data FROM deals WHERE id = $1", [params.id]);
    return NextResponse.json({ data: res.rows[0]?.ceqa_data || null });
  } catch (error) {
    console.error("GET /api/deals/[id]/ceqa error:", error);
    return NextResponse.json({ error: "Failed to fetch CEQA data" }, { status: 500 });
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

    const pool = getPool();
    const body = await req.json();
    await pool.query(
      "UPDATE deals SET ceqa_data = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(body.data), params.id]
    );
    return NextResponse.json({ data: body.data });
  } catch (error) {
    console.error("PUT /api/deals/[id]/ceqa error:", error);
    return NextResponse.json({ error: "Failed to save CEQA data" }, { status: 500 });
  }
}
