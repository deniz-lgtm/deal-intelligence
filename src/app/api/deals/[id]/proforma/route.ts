import { NextRequest, NextResponse } from "next/server";
import { dealQueries, checklistQueries } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * POST /api/deals/:id/proforma
 * Accept proforma outputs, store on deal, and auto-flag checklist items.
 *
 * Body:
 * {
 *   irr: number,
 *   yoc: number,              (yield on cost, e.g. 0.059 = 5.9%)
 *   equity_multiple: number,
 *   max_pp: number,           (max purchase price at 6% YoC)
 *   dscr: number,
 *   noi_stabilized: number,
 *   refi_proceeds: number,    (negative = shortfall)
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id);
    const body = await req.json();
    const {
      irr,
      yoc,
      equity_multiple,
      max_pp,
      dscr,
      noi_stabilized,
      refi_proceeds,
    } = body;

    const proforma_outputs = {
      irr,
      yoc,
      equity_multiple,
      max_pp,
      dscr,
      noi_stabilized,
      refi_proceeds,
    };

    const updated = await dealQueries.update(params.id, { proforma_outputs });

    // ── Auto-flag checklist items based on proforma results ───────────────────
    const flags: Array<{
      category: string;
      item: string;
      status: string;
      notes: string;
    }> = [];

    if (typeof yoc === "number" && yoc < 0.06) {
      flags.push({
        category: "Financial",
        item: "Yield on Cost vs. Market Threshold",
        status: "issue",
        notes: `Basis Risk — YoC is ${(yoc * 100).toFixed(2)}%, below the 6% market threshold. Purchase price may be above market.`,
      });
    }

    if (typeof refi_proceeds === "number" && refi_proceeds < 0) {
      flags.push({
        category: "Financial",
        item: "Refinance Proceeds / Capital Structure",
        status: "issue",
        notes: `Capital Structure Risk — Refi shortfall of $${Math.abs(refi_proceeds).toLocaleString()}. Additional equity will be required at refinance.`,
      });
    }

    if (typeof dscr === "number" && dscr < 1.25) {
      flags.push({
        category: "Financial",
        item: "Debt Service Coverage Ratio (DSCR)",
        status: "issue",
        notes: `Debt Coverage Risk — DSCR is ${dscr.toFixed(2)}, below the typical lender threshold of 1.25x.`,
      });
    }

    if (flags.length > 0) {
      // Get existing checklist to find or create these items
      const existing = await checklistQueries.getByDealId(params.id) as Array<{
        id: string;
        category: string;
        item: string;
      }>;
      const existingMap = new Map(
        existing.map((i) => [`${i.category}|${i.item}`, i.id])
      );

      const upserts = flags.map((flag) => {
        const key = `${flag.category}|${flag.item}`;
        const existingId = existingMap.get(key);
        return {
          id: existingId || uuidv4(),
          deal_id: params.id,
          category: flag.category,
          item: flag.item,
          status: flag.status,
          notes: flag.notes,
          ai_filled: true,
          source_document_ids: null,
        };
      });

      await checklistQueries.bulkUpsert(upserts);
    }

    return NextResponse.json({
      data: updated,
      flags_raised: flags.length,
      flags,
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/proforma error:", error);
    return NextResponse.json({ error: "Failed to store proforma outputs" }, { status: 500 });
  }
}
