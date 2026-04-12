import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { dealQueries, checklistQueries, checklistTemplateQueries } from "@/lib/db";
import { DILIGENCE_CHECKLIST_TEMPLATE } from "@/lib/types";
import { requireAuth, requirePermission, syncCurrentUser } from "@/lib/auth";

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const deals = await dealQueries.getAll(userId);
    return NextResponse.json({ data: deals });
  } catch (error) {
    console.error("GET /api/deals error:", error);
    return NextResponse.json({ error: "Failed to fetch deals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requirePermission("deals.create");
  if (errorResponse) return errorResponse;

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
      land_acres: body.land_acres ?? null,
      investment_strategy: body.investment_strategy ?? null,
      loi_executed: false,
      psa_executed: false,
      business_plan_id: body.business_plan_id ?? null,
      owner_id: userId,
    });

    // Seed the diligence checklist from the admin-editable template
    // (falls back to the hardcoded one if the table is empty)
    let templateItems: Array<{ category: string; item: string }> = [];
    try {
      const dbItems = await checklistTemplateQueries.listAll();
      if (dbItems.length > 0) {
        templateItems = dbItems.map((r) => ({ category: r.category, item: r.item }));
      }
    } catch {
      /* fall through */
    }
    if (templateItems.length === 0) {
      templateItems = DILIGENCE_CHECKLIST_TEMPLATE.flatMap((section) =>
        section.items.map((item) => ({ category: section.category, item }))
      );
    }
    const checklistItems = templateItems.map(({ category, item }) => ({
      id: uuidv4(),
      deal_id: id,
      category,
      item,
      status: "pending",
      notes: null,
      ai_filled: false,
      source_document_ids: null,
    }));
    await checklistQueries.bulkUpsert(checklistItems);

    return NextResponse.json({ data: deal }, { status: 201 });
  } catch (error) {
    console.error("POST /api/deals error:", error);
    const msg = error instanceof Error ? error.message : "Failed to create deal";
    return NextResponse.json({ error: `Failed to create deal: ${msg}` }, { status: 500 });
  }
}
