import { NextRequest, NextResponse } from "next/server";
import { floorPlanQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const plan = await floorPlanQueries.getById(params.id);
    if (!plan) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });
    const metrics = await floorPlanQueries.listMetrics(params.id);
    return NextResponse.json({ data: { ...plan, metrics } });
  } catch (error) {
    console.error("GET /api/floor-plans/[id] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch floor plan: ${message}` }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const existing = await floorPlanQueries.getById(params.id);
    if (!existing) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });

    const body = await req.json();
    const allowed = ["name", "unit_type", "bedrooms", "bathrooms", "square_footage", "description", "plan_data", "thumbnail"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) patch[k] = body[k];
    }
    const updated = await floorPlanQueries.update(params.id, patch as Parameters<typeof floorPlanQueries.update>[1]);
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("PATCH /api/floor-plans/[id] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to update floor plan: ${message}` }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    await floorPlanQueries.delete(params.id);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/floor-plans/[id] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to delete floor plan: ${message}` }, { status: 500 });
  }
}
