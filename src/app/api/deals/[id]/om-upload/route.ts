import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { dealQueries, documentQueries, omAnalysisQueries } from "@/lib/db";
import { extractOmMetrics } from "@/lib/om-extraction";
import { requireAuth, requireDealAccess } from "@/lib/auth";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

/**
 * POST /api/deals/:id/om-upload
 * Upload an Offering Memorandum PDF, run 4-stage LLM analysis, and save results.
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

    const deal = await dealQueries.getById(params.id);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const dealContext = (formData.get("deal_context") as string | null)?.trim() || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Only PDF and DOCX files are supported for OM upload" },
        { status: 400 }
      );
    }

    // ── Save file ────────────────────────────────────────────────────────────
    const docId = uuidv4();
    const ext = path.extname(file.name) || ".pdf";
    const safeName = `${docId}${ext}`;
    const dealUploadDir = path.join(UPLOAD_DIR, params.id);
    await fs.mkdir(dealUploadDir, { recursive: true });
    const filePath = path.join(dealUploadDir, safeName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // ── Extract text ─────────────────────────────────────────────────────────
    let pdfText = "";
    if (file.type === "application/pdf") {
      try {
        const pdfParse = (await import("pdf-parse")).default;
        const data = await pdfParse(buffer);
        pdfText = (data.text || "").replace(/\x00/g, "").replace(/[\uFFFD]/g, "");
      } catch (e) {
        console.error("PDF parse error:", e);
      }
    }

    // ── Create om_analyses row with status=processing ────────────────────────
    const analysisRow = await omAnalysisQueries.create(params.id, docId);
    analysisId = analysisRow.id;

    // ── Run 4-stage LLM analysis ─────────────────────────────────────────────
    const extraction = await extractOmMetrics(pdfText, dealContext, buffer);
    const full = extraction.full_result;

    // ── Save full analysis to om_analyses ────────────────────────────────────
    await omAnalysisQueries.setResult(analysisId, {
      document_id: docId,
      status: "complete",
      deal_context: dealContext ?? null,
      // Property
      property_name: full.property_details.name,
      address: full.property_details.address,
      property_type: full.property_details.property_type,
      year_built: full.property_details.year_built,
      sf: full.property_details.sf,
      unit_count: full.property_details.unit_count,
      // Financials
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
      // Assumptions
      rent_growth: full.assumptions.rent_growth,
      hold_period: full.assumptions.hold_period,
      leverage: full.assumptions.leverage,
      exit_cap_rate: full.assumptions.exit_cap_rate,
      // Results
      deal_score: full.deal_score,
      score_reasoning: full.score_reasoning,
      summary: full.summary,
      recommendations: full.recommendations,
      red_flags: full.red_flags,
      // Meta
      model_used: full.model_used,
      tokens_used: full.tokens_used,
      cost_estimate: full.cost_estimate,
      processing_ms: full.processing_ms,
    });

    // ── Update deal with OM data (backwards compat) ──────────────────────────
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

    const updatedDeal = await dealQueries.update(params.id, dealUpdates);

    // ── Create document record ───────────────────────────────────────────────
    const redFlagCount = full.red_flags.length;
    const criticalCount = full.red_flags.filter((f) => f.severity === "critical").length;
    const doc = await documentQueries.create({
      id: docId,
      deal_id: params.id,
      name: file.name.replace(ext, "").slice(0, 200),
      original_name: file.name,
      category: "financial",
      file_path: filePath,
      file_size: buffer.length,
      mime_type: file.type,
      content_text: pdfText || null,
      ai_summary: `Offering Memorandum — Deal Score: ${full.deal_score}/10. ${
        redFlagCount > 0
          ? `${redFlagCount} red flag(s)${criticalCount > 0 ? `, ${criticalCount} critical` : ""}.`
          : "No red flags detected."
      } ${full.summary ? full.summary.slice(0, 200) : ""}`,
      ai_tags: ["offering-memorandum", "om", "financial"],
    });

    const savedAnalysis = await omAnalysisQueries.getById(analysisId);

    return NextResponse.json({
      data: {
        deal: updatedDeal,
        document: doc,
        analysis: savedAnalysis,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/om-upload error:", error);

    // Mark analysis as error if we created one
    if (analysisId) {
      try {
        await omAnalysisQueries.updateStatus(
          analysisId,
          "error",
          error instanceof Error ? error.message : "Unknown error"
        );
      } catch {}
    }

    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `OM upload failed: ${msg}` },
      { status: 500 }
    );
  }
}
