import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { floorPlanQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const plan = await floorPlanQueries.getById(params.id);
    if (!plan) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });

    const body = await req.json();
    const market = (body.market ?? "").trim();
    if (!market) return NextResponse.json({ error: "market is required" }, { status: 400 });

    const row = await floorPlanQueries.createMetric({
      id: uuidv4(),
      floor_plan_id: params.id,
      market,
      monthly_rent: body.monthly_rent ?? null,
      rent_per_sf: body.rent_per_sf ?? null,
      hard_cost: body.hard_cost ?? null,
      hard_cost_per_sf: body.hard_cost_per_sf ?? null,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    console.error("POST /api/floor-plans/[id]/metrics error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to add metric: ${message}` }, { status: 500 });
  }
}
