import { NextRequest, NextResponse } from "next/server";
import { floorPlanQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; metricId: string } }
) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const allowed = ["market", "monthly_rent", "rent_per_sf", "hard_cost", "hard_cost_per_sf", "notes"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) patch[k] = body[k];
    }
    const row = await floorPlanQueries.updateMetric(params.metricId, patch as Parameters<typeof floorPlanQueries.updateMetric>[1]);
    if (!row) return NextResponse.json({ error: "Metric not found" }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("PATCH metric error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to update metric: ${message}` }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; metricId: string } }
) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    await floorPlanQueries.deleteMetric(params.metricId);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE metric error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to delete metric: ${message}` }, { status: 500 });
  }
}
