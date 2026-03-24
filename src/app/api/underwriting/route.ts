import { NextResponse } from "next/server";
import { underwritingQueries } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("deal_id");
    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }
    const uw = await underwritingQueries.getByDealId(dealId);
    return NextResponse.json({ data: uw || null });
  } catch (err) {
    console.error("Error fetching underwriting:", err);
    return NextResponse.json({ error: "Failed to fetch underwriting" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { deal_id, data } = body;
    if (!deal_id) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }
    const existing = (await underwritingQueries.getByDealId(deal_id)) as { id: string } | undefined;
    const id = existing?.id || uuidv4();
    const dataStr = typeof data === "string" ? data : JSON.stringify(data);
    const result = await underwritingQueries.upsert(deal_id, id, dataStr);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("Error saving underwriting:", err);
    return NextResponse.json({ error: "Failed to save underwriting" }, { status: 500 });
  }
}
