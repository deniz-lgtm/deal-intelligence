import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { submarketMetricsQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const row = await submarketMetricsQueries.getByDealId(params.id);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("GET /api/deals/[id]/submarket-metrics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch submarket metrics" },
      { status: 500 }
    );
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

    const body = await req.json();
    const existing = await submarketMetricsQueries.getByDealId(params.id);
    const id = existing?.id ?? uuidv4();
    const row = await submarketMetricsQueries.upsert(params.id, id, body);
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PUT /api/deals/[id]/submarket-metrics error:", error);
    return NextResponse.json(
      { error: "Failed to save submarket metrics" },
      { status: 500 }
    );
  }
}
