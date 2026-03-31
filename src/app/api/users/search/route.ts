import { NextRequest, NextResponse } from "next/server";
import { userQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/users/search?q=email_or_name
 * Search users by email or name (for the share dialog autocomplete).
 */
export async function GET(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ data: [] });
  }

  try {
    const users = await userQueries.search(q, userId);
    // Only return safe fields — no internal IDs beyond what's needed for sharing
    const results = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
    }));
    return NextResponse.json({ data: results });
  } catch (error) {
    console.error("GET /api/users/search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
