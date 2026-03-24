import { NextRequest, NextResponse } from "next/server";
import { businessPlanQueries } from "@/lib/db";

export async function GET() {
  try {
    const plans = await businessPlanQueries.getAll();
    return NextResponse.json({ data: plans });
  } catch (error) {
    console.error("GET /api/business-plans error:", error);
    return NextResponse.json({ error: "Failed to fetch business plans" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name?.trim() || !body.description?.trim()) {
      return NextResponse.json({ error: "name and description are required" }, { status: 400 });
    }
    const plan = await businessPlanQueries.create({
      name: body.name.trim(),
      description: body.description.trim(),
      is_default: body.is_default ?? false,
    });
    return NextResponse.json({ data: plan }, { status: 201 });
  } catch (error) {
    console.error("POST /api/business-plans error:", error);
    return NextResponse.json({ error: "Failed to create business plan" }, { status: 500 });
  }
}
