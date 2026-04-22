import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { htmlToPdf, PuppeteerMissingError } from "@/lib/html-to-pdf";
import { documentQueries } from "@/lib/db";
import { uploadBlob } from "@/lib/blob-storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/deals/[id]/ic-package/pdf
 * Body: { html: string, filename?: string } — full rendered HTML of the IC package page
 * Returns: application/pdf buffer
 *
 * Delegates to the shared htmlToPdf() helper so puppeteer is invoked
 * the same way here as for DD Abstract, Investment Package, Zoning
 * Report, and any future HTML-rendered generator. If puppeteer isn't
 * installed we return a structured 501 and the client falls back to
 * window.print().
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const body = await req.json();
    const html = body.html as string | undefined;
    const filename = (body.filename as string | undefined) ?? `ic-package-${params.id}.pdf`;
    if (!html) {
      return NextResponse.json({ error: "Missing html" }, { status: 400 });
    }

    let pdf: Buffer;
    try {
      pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in", waitUntil: "networkidle0" });
    } catch (err) {
      if (err instanceof PuppeteerMissingError) {
        return NextResponse.json(
          { error: err.code, message: err.message },
          { status: 501 }
        );
      }
      throw err;
    }

    // Persist to the documents library so past IC packages stay
    // browsable alongside every other generated report. Non-fatal
    // on failure — the download still fires.
    try {
      const docId = uuidv4();
      const dateStamp = new Date().toISOString().slice(0, 10);
      const safeFilename = filename.replace(/"/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
      const blobPath = `deals/${params.id}/reports/${dateStamp}-${docId}-${safeFilename}`;
      const url = await uploadBlob(blobPath, pdf, "application/pdf");
      await documentQueries.create({
        id: docId,
        deal_id: params.id,
        name: safeFilename.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim(),
        original_name: safeFilename,
        category: "ic_package",
        file_path: url,
        file_size: pdf.length,
        mime_type: "application/pdf",
        content_text: null,
        ai_summary: `IC Package · ${new Date().toLocaleDateString()}`,
        ai_tags: ["ic-package", "ai-generated", "pdf"],
      });
    } catch (saveErr) {
      console.warn("Failed to save IC package PDF to documents:", (saveErr as Error).message?.slice(0, 200));
    }

    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      },
    });
  } catch (err) {
    console.error("POST /api/deals/[id]/ic-package/pdf error:", err);
    const message = err instanceof Error ? err.message : "PDF export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
