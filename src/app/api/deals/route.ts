import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { dealQueries, checklistQueries } from "@/lib/db";
import { DILIGENCE_CHECKLIST_TEMPLATE } from "@/lib/types";

export async function GET() {
  try {
    const deals = await dealQueries.getAll();
    return NextResponse.json({ data: deals });
  } catch (error) {
    console.error("GET /api/deals error:", error);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = uuidv4();

    const deal = await dealQueries.create({
      id,
      name: body.name || "Untitled Deal",
      address: body.address || "",
      city: body.city || "",
      state: body.state || "",
      zip: body.zip || "",
      property_type: body.property_type || "other",
      status: body.status || "diligence",
      starred: body.starred ?? false,
      asking_price: body.asking_price ?? null,
      square_footage: body.square_footage ?? null,
      units: body.units ?? null,
      bedrooms: body.bedrooms ?? null,
      year_built: body.year_built ?? null,
      notes: body.notes ?? null,
      loi_executed: false,
      psa_executed: false,
      business_plan_id: body.business_plan_id ?? null,
    });

    // Seed the diligence checklist from template
    const checklistItems = DILIGENCE_CHECKLIST_TEMPLATE.flatMap((section) =>
      section.items.map((item) => ({
        id: uuidv4(),
        deal_id: id,
        category: section.category,
        item,
        status: "pending",
        notes: null,
        ai_filled: false,
        source_document_ids: null,
      }))
    );
    await checklistQueries.bulkUpsert(checklistItems);

    return NextResponse.json({ data: deal }, { status: 201 });
  } catch (error) {
    console.error("POST /api/deals error:", error);
    return NextResponse.json({ error: "Failed to create deal" }, { status: 500 });
  }
}
