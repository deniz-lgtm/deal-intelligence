import { NextRequest, NextResponse } from "next/server";
import { brandingQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const branding = await brandingQueries.get();
    return NextResponse.json({ data: branding ?? null });
  } catch (error) {
    console.error("GET /api/branding error:", error);
    return NextResponse.json({ error: "Failed to fetch branding" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const branding = await brandingQueries.upsert(body);
    return NextResponse.json({ data: branding });
  } catch (error) {
    console.error("PUT /api/branding error:", error);
    return NextResponse.json({ error: "Failed to update branding" }, { status: 500 });
  }
}
