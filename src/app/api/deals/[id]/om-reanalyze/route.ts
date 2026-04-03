import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import { dealQueries, documentQueries, omAnalysisQueries } from "@/lib/db";
import { extractOmMetrics } from "@/lib/om-extraction";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * POST /api/deals/:id/om-reanalyze
 * Re-runs OM analysis using the existing document's extracted text.
 * No file upload required — reuses content_text from the documents table.
 * Accepts optional deal_context (business plan + notes) in the JSON body.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let analysisId: string | null = null;

  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json().catch(() => ({}));
    const dealContext: string | undefined = body.deal_context?.trim() || undefined;
    const documentId: string | undefined = body.document_id;

    // Find the existing OM document for this deal
    let doc: Record<string, unknown> | null = null;

    if (documentId) {
      doc = await documentQueries.getById(documentId);
    }

    // Fallback: find by latest om_analysis document_id
    if (!doc) {
      const latestAnalysis = await omAnalysisQueries.getByDealId(params.id);
      if (latestAnalysis?.document_id) {
        doc = await documentQueries.getById(latestAnalysis.document_id);
      }
    }

    // Fallback: find any OM document for this deal
    if (!doc) {
      const docs = await documentQueries.getByDealId(params.id);
      doc = docs.find((d: Record<string, unknown>) =>
        (d.ai_tags as string[] || []).includes("offering-memorandum") ||
        (d.original_name as string || "").toLowerCase().includes("om")
      ) ?? null;
    }

    if (!doc || !doc.content_text) {
      return NextResponse.json(
        { error: "No OM document found for this deal. Upload one first." },
        { status: 404 }
      );
    }

    const pdfText = doc.content_text as string;

    // Create new analysis row
    const newDocId = doc.id as string;
    const analysisRow = await omAnalysisQueries.create(params.id, newDocId);
    analysisId = analysisRow.id;

    // Return immediately, run analysis in background
    runReanalysisBackground({
      analysisId,
      dealId: params.id,
      docId: newDocId,
      pdfText,
      dealContext,
      filePath: doc.file_path as string | undefined,
    }).catch((err) => console.error("Background OM re-analysis error:", err));

    return NextResponse.json({ data: { analysis_id: analysisId } });
  } catch (error) {
    console.error("POST /api/deals/[id]/om-reanalyze error:", error);
    if (analysisId) {
      await omAnalysisQueries.updateStatus(
        analysisId, "error",
        error instanceof Error ? error.message : "Unknown error"
      ).catch(() => {});
    }
    return NextResponse.json({ error: "Re-analysis failed" }, { status: 500 });
  }
}

async function runReanalysisBackground({
  analysisId,
  dealId,
  docId,
  pdfText,
  dealContext,
  filePath,
}: {
  analysisId: string;
  dealId: string;
  docId: string;
  pdfText: string;
  dealContext: string | undefined;
  filePath?: string;
}) {
  try {
    // Read PDF buffer for native document input if file path available
    let pdfBuffer: Buffer | undefined;
    if (filePath) {
      try { pdfBuffer = await fs.readFile(filePath); } catch { /* use text fallback */ }
    }
    const extraction = await extractOmMetrics(pdfText, dealContext, pdfBuffer);
    const full = extraction.full_result;

    await omAnalysisQueries.setResult(analysisId, {
      document_id: docId,
      status: "complete",
      deal_context: dealContext ?? null,
      property_name: full.property_details.name,
      address: full.property_details.address,
      property_type: full.property_details.property_type,
      year_built: full.property_details.year_built,
      sf: full.property_details.sf,
      unit_count: full.property_details.unit_count,
      asking_price: full.financial_metrics.asking_price,
      noi: full.financial_metrics.noi,
      cap_rate: full.financial_metrics.cap_rate,
      grm: full.financial_metrics.grm,
      cash_on_cash: full.financial_metrics.cash_on_cash,
      irr: full.financial_metrics.irr,
      equity_multiple: full.financial_metrics.equity_multiple,
      dscr: full.financial_metrics.dscr,
      vacancy_rate: full.financial_metrics.vacancy_rate,
      expense_ratio: full.financial_metrics.expense_ratio,
      price_per_sf: full.financial_metrics.price_per_sf,
      price_per_unit: full.financial_metrics.price_per_unit,
      rent_growth: full.assumptions.rent_growth,
      hold_period: full.assumptions.hold_period,
      leverage: full.assumptions.leverage,
      exit_cap_rate: full.assumptions.exit_cap_rate,
      deal_score: full.deal_score,
      score_reasoning: full.score_reasoning,
      summary: full.summary,
      recommendations: full.recommendations,
      red_flags: full.red_flags,
      model_used: full.model_used,
      tokens_used: full.tokens_used,
      cost_estimate: full.cost_estimate,
      processing_ms: full.processing_ms,
    });

    // Update deal fields
    const dealUpdates: Record<string, unknown> = {
      om_score: extraction.om_score,
      om_extracted: extraction.om_extracted,
    };
    if (extraction.om_extracted.asking_price)
      dealUpdates.asking_price = extraction.om_extracted.asking_price;
    if (extraction.om_extracted.sf)
      dealUpdates.square_footage = extraction.om_extracted.sf;
    if (extraction.om_extracted.units)
      dealUpdates.units = extraction.om_extracted.units;
    if (extraction.om_extracted.year_built)
      dealUpdates.year_built = extraction.om_extracted.year_built;
    await dealQueries.update(dealId, dealUpdates);
  } catch (err) {
    console.error("runReanalysisBackground failed:", err);
    await omAnalysisQueries.updateStatus(
      analysisId, "error",
      err instanceof Error ? err.message : "Unknown error"
    ).catch(() => {});
  }
}
