import { NextRequest, NextResponse } from "next/server";
import { compQueries } from "@/lib/db";
import { requireAuth, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/workspace/comps?type=sale|rent&property_type=...&q=...
 *
 * Cross-deal comp library. Returns every comp the signed-in user can see,
 * whether it's attached to a specific deal or is a workspace-only comp
 * created from a deal snapshot / manual entry.
 */
export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  const sp = req.nextUrl.searchParams;
  const typeParam = sp.get("type");
  const compType =
    typeParam === "sale" || typeParam === "rent" ? typeParam : undefined;

  try {
    const rows = await compQueries.getWorkspace(userId, {
      compType,
      propertyType: sp.get("property_type") || undefined,
      search: sp.get("q") || undefined,
      limit: Number(sp.get("limit")) || undefined,
    });
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/workspace/comps error:", error);
    return NextResponse.json(
      { error: "Failed to fetch workspace comps" },
      { status: 500 }
    );
  }
}
