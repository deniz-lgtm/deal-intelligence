import { NextRequest, NextResponse } from "next/server";
import { businessPlanQueries } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const plan = await businessPlanQueries.getById(params.id);
    if (!plan) {
      return NextResponse.json({ error: "Business plan not found" }, { status: 404 });
    }
    return NextResponse.json({ data: plan });
  } catch (error) {
    console.error("GET /api/business-plans/[id] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch business plan: ${message}` }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    // Special action: set as default
    if (body.action === "setDefault") {
      await businessPlanQueries.setDefault(params.id);
      const plan = await businessPlanQueries.getById(params.id);
      return NextResponse.json({ data: plan });
    }

    const plan = await businessPlanQueries.update(params.id, body);
    return NextResponse.json({ data: plan });
  } catch (error) {
    console.error("PATCH /api/business-plans/[id] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to update business plan: ${message}` }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await businessPlanQueries.delete(params.id);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("DELETE /api/business-plans/[id] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to delete business plan: ${message}` }, { status: 500 });
  }
}
