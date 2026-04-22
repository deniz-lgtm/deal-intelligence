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

interface ExportSection {
  id: string;
  title: string;
  notes: Array<{ text: string }>;
  generatedContent?: string;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * POST /api/deals/:id/investment-package/export
 * Body: { sections, dealName, massing_id? }
 * Returns: application/pdf
 *
 * Replaces the previous PPTX + DOCX output with a single HTML → PDF
 * pipeline shared with DD Abstract, Zoning Report, and IC Package. The
 * `format` field is accepted for backward compatibility but every format
 * produces a PDF now.
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

    const { sections, dealName, massing_id } = await req.json() as {
      sections: ExportSection[];
      dealName: string;
      format?: string; // accepted but ignored — everything is PDF now
      massing_id?: string;
    };

    let branding: Record<string, unknown> | null = null;
    try { branding = await getBrandingForDeal(params.id); } catch { /* defaults */ }
    const theme = resolveBranding(branding);

    // Build the body HTML: table of contents, then each section as a
    // block with its markdown rendered. Filter out sections with no
    // content so the TOC matches what actually renders.
    const renderable = sections.filter(
      (s) => s.generatedContent || s.notes?.filter((n) => n.text?.trim()).length > 0
    );

    const tocHtml = renderable.length > 1
      ? `<div class="section">
           <h2>Table of Contents</h2>
           <ol>${renderable.map((s) => `<li>${esc(s.title)}</li>`).join("")}</ol>
         </div>`
      : "";

    const sectionsHtml = renderable.map((section, i) => {
      const md = section.generatedContent
        ? section.generatedContent
        : section.notes
            .filter((n) => n.text?.trim())
            .map((n) => `- ${n.text}`)
            .join("\n");
      const num = String(i + 1).padStart(2, "0");
      return `<div class="section">
                <div class="section-number">${num} / ${String(renderable.length).padStart(2, "0")}</div>
                <h2>${esc(section.title)}</h2>
                ${markdownToHtml(md)}
              </div>`;
    }).join("");

    const html = renderReportHtml({
      title: `Investment Package — ${dealName}`,
      headline: dealName,
      subtitle: "Investment Committee Materials",
      eyebrow: "IC MEMO",
      bodyHtml: tocHtml + sectionsHtml,
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

    const filename = `Investment-Package-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.pdf`;

    try {
      const docId = uuidv4();
      const dateStamp = new Date().toISOString().slice(0, 10);
      const blobPath = `deals/${params.id}/reports/${dateStamp}-${docId}-${filename}`;
      const url = await uploadBlob(blobPath, pdf, "application/pdf");
      await documentQueries.create({
        id: docId,
        deal_id: params.id,
        name: `Investment Package — ${dealName}`,
        original_name: filename,
        category: "investment_package",
        file_path: url,
        file_size: pdf.length,
        mime_type: "application/pdf",
        content_text: null,
        ai_summary: `Investment Package · ${new Date().toLocaleDateString()} · ${renderable.length} sections`,
        ai_tags: ["investment-package", "ai-generated", "pdf", ...(massing_id ? [`massing:${massing_id}`] : [])],
      });
    } catch (saveErr) {
      console.warn("Failed to save investment package PDF to documents:", (saveErr as Error).message?.slice(0, 200));
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
    console.error("Investment Package PDF export error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Export failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}
