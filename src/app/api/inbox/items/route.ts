import { NextResponse } from "next/server";
import { dealQueries } from "@/lib/db";
import { requireAuth, syncCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/inbox/items
 *
 * Returns auto-ingested deals that haven't been marked reviewed yet.
 * Powers the main list on the /inbox page.
 */
export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const rows = await dealQueries.getPendingInboxItems(50, userId);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/inbox/items error:", error);
    return NextResponse.json(
      { error: "Failed to fetch inbox items" },
      { status: 500 }
    );
  }
}
