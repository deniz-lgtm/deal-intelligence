import { NextResponse } from "next/server";
import { userQueries } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Opt out of static analysis at `next build`. Reads auth / headers() / DB.
// Without this flag Next.js evaluates the handler during static-page
// generation and throws Dynamic-server / DATABASE_URL errors.
export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  try {
    const users = await userQueries.listAll();
    return NextResponse.json({ data: users });
  } catch (error) {
    console.error("GET /api/admin/users error:", error);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}
