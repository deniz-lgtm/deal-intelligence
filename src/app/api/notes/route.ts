import { NextRequest, NextResponse } from "next/server";
import { dealNoteQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/notes
 *
 * Workspace-wide notes repository. Returns every deal_note row across
 * every deal the caller has access to (owned or shared), most-recent first.
 *
 * Query params:
 *   deal=<id>   scope to a single deal (same rows you'd see in the per-deal
 *               panel, but pre-shared and deep-linkable from /notes)
 *   limit=<n>   cap the result set (default 500, max 1000).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const url = new URL(req.url);
    const deal = url.searchParams.get("deal") || undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const rows = await dealNoteQueries.getAllAccessible(userId, {
      dealId: deal,
      limit,
    });
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/notes error:", error);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }
}
