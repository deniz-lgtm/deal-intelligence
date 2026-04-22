import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getBrandingForDeal, documentQueries } from "@/lib/db";
import { resolveBranding } from "@/lib/export-markdown";
import { htmlToPdf, PuppeteerMissingError } from "@/lib/html-to-pdf";
import { markdownToHtml, renderReportHtml } from "@/lib/report-html-shell";
import { uploadBlob } from "@/lib/blob-storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/deals/:id/dd-abstract/export
 * Body: { markdown: string, dealName: string, massing_id?: string }
 * Returns: application/pdf
 *
 * Replaces the old DOCX export with an HTML → puppeteer → PDF pipeline
 * so we share one output format (PDF) with the IC Package, Investment
 * Package, and Zoning Report. The PDF also lands in the documents
 * library so analysts can pull up past runs.
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

    const body = await req.json();
    const markdown: string = body.markdown ?? "";
    const dealName: string = body.dealName ?? "Deal";
    const massingId: string | undefined = body.massing_id;

    let branding: Record<string, unknown> | null = null;
    try { branding = await getBrandingForDeal(params.id); } catch { /* defaults */ }
    const theme = resolveBranding(branding);

    const bodyHtml = markdownToHtml(markdown);
    const html = renderReportHtml({
      title: `DD Abstract — ${dealName}`,
      headline: dealName,
      subtitle: "Due Diligence Abstract",
      eyebrow: "IC PRE-READ",
      bodyHtml,
      theme,
    });

    let pdf: Buffer;
    try {
      pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in" });
    } catch (err) {
      if (err instanceof PuppeteerMissingError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: 501 });
      }
      throw err;
    }

    const filename = `DD-Abstract-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.pdf`;

    // Persist to the documents library (non-fatal on failure).
    try {
      const docId = uuidv4();
      const dateStamp = new Date().toISOString().slice(0, 10);
      const blobPath = `deals/${params.id}/reports/${dateStamp}-${docId}-${filename}`;
      const url = await uploadBlob(blobPath, pdf, "application/pdf");
      await documentQueries.create({
        id: docId,
        deal_id: params.id,
        name: `DD Abstract — ${dealName}`,
        original_name: filename,
        category: "dd_abstract",
        file_path: url,
        file_size: pdf.length,
        mime_type: "application/pdf",
        content_text: markdown,
        ai_summary: `AI-generated DD Abstract · ${new Date().toLocaleDateString()}`,
        ai_tags: ["dd-abstract", "ai-generated", "pdf", ...(massingId ? [`massing:${massingId}`] : [])],
      });
    } catch (saveErr) {
      console.warn("Failed to save DD abstract PDF to documents:", (saveErr as Error).message?.slice(0, 200));
    }

    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdf.length.toString(),
      },
    });
  } catch (error) {
    console.error("DD Abstract PDF export error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Export failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}
