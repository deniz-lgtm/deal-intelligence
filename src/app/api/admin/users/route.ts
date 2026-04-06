import { NextResponse } from "next/server";
import { userQueries } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

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
