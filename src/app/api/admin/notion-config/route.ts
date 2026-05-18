import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getNotionRegistryStatus } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse } = await requireAdmin();
  if (errorResponse) return errorResponse;

  try {
    const data = await getNotionRegistryStatus();
    return NextResponse.json({ data });
  } catch (error) {
    console.error("GET /api/admin/notion-config error:", error);
    return NextResponse.json({ error: "Failed to load Notion configuration" }, { status: 500 });
  }
}
