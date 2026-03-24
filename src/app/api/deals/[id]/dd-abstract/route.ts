import { NextRequest, NextResponse } from "next/server";
import { dealQueries, documentQueries, checklistQueries, underwritingQueries } from "@/lib/db";
import { generateDDAbstract } from "@/lib/claude";
import type { Document, ChecklistItem, Deal } from "@/lib/types";
import type { UnderwritingSnapshot } from "@/lib/claude";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deal = await dealQueries.getById(params.id);
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const [documents, checklist, uwRow] = await Promise.all([
      documentQueries.getByDealId(params.id) as Promise<Document[]>,
      checklistQueries.getByDealId(params.id) as Promise<ChecklistItem[]>,
      underwritingQueries.getByDealId(params.id),
    ]);

    // Build underwriting snapshot from proforma_outputs (stored on deal) + raw UW data
    const underwriting: UnderwritingSnapshot = {
      proforma: deal.proforma_outputs ?? null,
      uwData: uwRow?.data ?? null,
    };

    const abstract = await generateDDAbstract(deal as Deal, documents, checklist, underwriting, deal.context_notes);
    return NextResponse.json({ data: abstract });
  } catch (error) {
    console.error("POST /api/deals/[id]/dd-abstract error:", error);
    return NextResponse.json({ error: "Failed to generate DD abstract" }, { status: 500 });
  }
}
