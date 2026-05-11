import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { floorPlanQueries } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getUnitTypeById } from "@/lib/floor-plan-unit-types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const unitType = req.nextUrl.searchParams.get("unit_type") || undefined;
    const plans = await floorPlanQueries.list({ unit_type: unitType });
    return NextResponse.json({ data: plans });
  } catch (error) {
    console.error("GET /api/floor-plans error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to list floor plans: ${message}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const name = (body.name ?? "").trim();
    const unitType = (body.unit_type ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const def = getUnitTypeById(unitType);
    if (!def) return NextResponse.json({ error: `unknown unit_type: ${unitType}` }, { status: 400 });

    const plan = await floorPlanQueries.create({
      id: uuidv4(),
      name,
      unit_type: def.id,
      bedrooms: def.bedrooms,
      bathrooms: def.bathrooms,
      square_footage: body.square_footage ?? null,
      description: body.description ?? null,
      plan_data: body.plan_data ?? { els: [], title: name },
      thumbnail: null,
      created_by: userId,
    });
    return NextResponse.json({ data: plan }, { status: 201 });
  } catch (error) {
    console.error("POST /api/floor-plans error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to create floor plan: ${message}` }, { status: 500 });
  }
}
