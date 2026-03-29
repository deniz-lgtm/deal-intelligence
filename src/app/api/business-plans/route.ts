import { NextRequest, NextResponse } from "next/server";
import { businessPlanQueries } from "@/lib/db";

export async function GET() {
  try {
    const plans = await businessPlanQueries.getAll();
    return NextResponse.json({ data: plans });
  } catch (error) {
    console.error("GET /api/business-plans error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch business plans: ${message}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const plan = await businessPlanQueries.create({
      name: body.name.trim(),
      description: (body.description || "").trim(),
      is_default: body.is_default ?? false,
      investment_theses: body.investment_theses ?? [],
      target_markets: body.target_markets ?? [],
      property_types: body.property_types ?? [],
      hold_period_min: body.hold_period_min ?? null,
      hold_period_max: body.hold_period_max ?? null,
      target_irr_min: body.target_irr_min ?? null,
      target_irr_max: body.target_irr_max ?? null,
      target_equity_multiple_min: body.target_equity_multiple_min ?? null,
      target_equity_multiple_max: body.target_equity_multiple_max ?? null,
    });
    return NextResponse.json({ data: plan }, { status: 201 });
  } catch (error) {
    console.error("POST /api/business-plans error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to create business plan: ${message}` }, { status: 500 });
  }
}
