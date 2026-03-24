import { NextRequest, NextResponse } from "next/server";
import { checklistQueries } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");

    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const items = await checklistQueries.getByDealId(dealId);
    return NextResponse.json({ data: items });
  } catch (error) {
    console.error("GET /api/checklist error:", error);
    return NextResponse.json({ error: "Failed to fetch checklist" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, notes } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: "id and status are required" },
        { status: 400 }
      );
    }

    await checklistQueries.updateStatus(id, status, notes || null);
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error("PATCH /api/checklist error:", error);
    return NextResponse.json({ error: "Failed to update checklist item" }, { status: 500 });
  }
}
