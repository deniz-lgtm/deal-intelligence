import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import { dealQueries, documentQueries, omAnalysisQueries } from "@/lib/db";
import { extractOmMetrics } from "@/lib/om-extraction";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

/**
 * POST /api/deals/:id/om-init
 * Saves the OM file, creates an om_analyses row with status='processing',
 * and returns immediately. Analysis runs in the background so the OM tab
 * shows the processing state as soon as the user lands there.
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
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const dealContext = (formData.get("deal_context") as string | null)?.trim() || undefined;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
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

    // ── Create processing row and return immediately ─────────────────────────
    const analysisRow = await omAnalysisQueries.create(params.id, docId);
    const analysisId = analysisRow.id;

    // ── Run full analysis in the background (no await) ───────────────────────
    runAnalysisBackground({
      analysisId,
      dealId: params.id,
      docId,
      pdfText,
      buffer,
      file,
      filePath,
      dealContext,
    }).catch((err) => console.error("Background OM analysis error:", err));

    return NextResponse.json({ data: { analysis_id: analysisId } });
  } catch (error) {
    console.error("POST /api/deals/[id]/om-init error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to start OM analysis: ${msg}` }, { status: 500 });
  }
}

async function runAnalysisBackground({
  analysisId,
  dealId,
  docId,
  pdfText,
  buffer,
  file,
  filePath,
  dealContext,
}: {
  analysisId: string;
  dealId: string;
  docId: string;
  pdfText: string;
  buffer: Buffer;
  file: File;
  filePath: string;
  dealContext: string | undefined;
}) {
  try {
    const extraction = await extractOmMetrics(pdfText, dealContext, buffer);
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

    // Create document record
    const ext = path.extname(file.name) || ".pdf";
    const redFlagCount = full.red_flags.length;
    const criticalCount = full.red_flags.filter((f) => f.severity === "critical").length;
    await documentQueries.create({
      id: docId,
      deal_id: dealId,
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
  } catch (err) {
    console.error("runAnalysisBackground failed:", err);
    await omAnalysisQueries.updateStatus(
      analysisId,
      "error",
      err instanceof Error ? err.message : "Unknown error"
    ).catch(() => {});
  }
}
