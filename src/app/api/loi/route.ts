import { NextResponse } from "next/server";
import { loiQueries, dealQueries } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }
    const loi = await loiQueries.getByDealId(dealId);
    return NextResponse.json({ data: loi || null });
  } catch (err) {
    console.error("Error fetching LOI:", err);
    return NextResponse.json({ error: "Failed to fetch LOI" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { deal_id, data, executed } = body;
    if (!deal_id) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }
    const existing = (await loiQueries.getByDealId(deal_id)) as { id: string } | undefined;
    const id = existing?.id || uuidv4();
    const result = await loiQueries.upsert(deal_id, id, JSON.stringify(data), !!executed);

    // If marking as executed, update deal flag
    if (executed) {
      await dealQueries.update(deal_id, { loi_executed: true });
    }

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("Error saving LOI:", err);
    return NextResponse.json({ error: "Failed to save LOI" }, { status: 500 });
  }
}
