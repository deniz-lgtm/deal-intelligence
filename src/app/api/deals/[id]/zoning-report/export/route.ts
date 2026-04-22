import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { getBrandingForDeal, documentQueries } from "@/lib/db";
import { resolveBranding } from "@/lib/export-markdown";
import { htmlToPdf, PuppeteerMissingError } from "@/lib/html-to-pdf";
import {
  markdownToHtml,
  renderReportHtml,
  renderKvTable,
  inlineMarkdownToHtml,
} from "@/lib/report-html-shell";
import { uploadBlob } from "@/lib/blob-storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * POST /api/deals/:id/zoning-report/export
 * Body: { dealName, siteInfo, zoningInfo, devParams, narrative }
 * Returns: application/pdf
 *
 * Replaces the previous DOCX export with an HTML → PDF pipeline shared
 * with DD Abstract, Investment Package, and IC Package. Structured data
 * (site info, zoning, setbacks, heights, density bonuses, legislation)
 * renders as branded KV tables; the AI narrative flows through the
 * shared markdown→HTML converter.
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
    const { dealName, siteInfo, zoningInfo, devParams, narrative } = body as {
      dealName: string;
      siteInfo: AnyRec;
      zoningInfo: AnyRec;
      devParams: AnyRec;
      narrative: string;
    };

    let branding: Record<string, unknown> | null = null;
    try { branding = await getBrandingForDeal(params.id); } catch { /* defaults */ }
    const theme = resolveBranding(branding);

    // ── Site Information ─────────────────────────────────────────
    const siteRows: Array<[string, string]> = [
      ["Land Area", `${siteInfo?.land_acres || 0} AC / ${Math.round(siteInfo?.land_sf || 0).toLocaleString()} SF`],
      ["Parcel ID", siteInfo?.parcel_id || "—"],
      ["Flood Zone", siteInfo?.flood_zone || "—"],
      ["Current Improvements", siteInfo?.current_improvements || "—"],
      ["Topography", siteInfo?.topography || "—"],
      ["Utilities", siteInfo?.utilities || "—"],
      ["Environmental", siteInfo?.environmental_notes || "—"],
      ["Soil Conditions", siteInfo?.soil_conditions || "—"],
    ];

    // ── Zoning Information ───────────────────────────────────────
    const zoningRows: Array<[string, string]> = [
      ["Zoning Designation", zoningInfo?.zoning_designation || "—"],
      ["FAR", zoningInfo?.far != null ? String(zoningInfo.far) : "—"],
      ["Lot Coverage", zoningInfo?.lot_coverage_pct != null ? `${zoningInfo.lot_coverage_pct}%` : "—"],
      ["Overlays", zoningInfo?.overlays?.length > 0 ? zoningInfo.overlays.join(", ") : "None"],
      ["Permitted Uses", zoningInfo?.permitted_uses?.length > 0 ? zoningInfo.permitted_uses.join(", ") : "—"],
      ["Parking Requirements", zoningInfo?.parking_requirements || "—"],
      ["Open Space", zoningInfo?.open_space_requirements || "—"],
    ];

    const setbackRows: Array<[string, string]> = Array.isArray(zoningInfo?.setbacks)
      ? zoningInfo.setbacks
          .filter((s: AnyRec) => s?.feet != null)
          .map((s: AnyRec) => [String(s.label ?? ""), `${s.feet} ft`])
      : [];

    const heightLimitsHtml = Array.isArray(zoningInfo?.height_limits) && zoningInfo.height_limits.length > 0
      ? `<h3>Height Limits</h3><ul>${(zoningInfo.height_limits as AnyRec[])
          .map((h) => {
            let rendered: string = h.value || "";
            const hasStructured = (typeof h.feet === "number" && h.feet !== null)
              || (typeof h.stories === "number" && h.stories !== null);
            if (hasStructured) {
              const parts: string[] = [];
              if (h.stories != null) parts.push(`${h.stories} stories`);
              if (h.feet != null) parts.push(`${h.feet} ft`);
              rendered = parts.join(` ${h.connector || "and"} `);
            }
            return `<li><strong>${esc(h.label || "")}:</strong> ${inlineMarkdownToHtml(rendered)}</li>`;
          })
          .join("")}</ul>`
      : "";

    const activeBonuses = (zoningInfo?.density_bonuses || []).filter((b: AnyRec) => b?.enabled !== false);
    const bonusesHtml = activeBonuses.length > 0
      ? `<h3>Density Bonuses &amp; Incentives</h3><ul>${activeBonuses
          .map((b: AnyRec) =>
            `<li><strong>${esc(b.source || "")}:</strong> ${inlineMarkdownToHtml(`${b.description || ""} (${b.additional_density || ""})`)}</li>`
          )
          .join("")}</ul>`
      : "";

    const legislationHtml = Array.isArray(zoningInfo?.future_legislation) && zoningInfo.future_legislation.length > 0
      ? `<h3>Future Legislation &amp; Plan Changes</h3><ul>${(zoningInfo.future_legislation as AnyRec[])
          .map((f) => {
            const header = f.effective_date ? `${f.source} (${f.effective_date})` : `${f.source || ""}`;
            const desc = [f.description, f.impact].filter(Boolean).join(" — ");
            return `<li><strong>${esc(header)}:</strong> ${inlineMarkdownToHtml(desc)}</li>`;
          })
          .join("")}</ul>`
      : "";

    const sourceHtml = zoningInfo?.source_url
      ? `<p><strong>Source:</strong> <a href="${esc(zoningInfo.source_url)}">${esc(zoningInfo.source_url)}</a></p>`
      : "";

    // ── Development Parameters ───────────────────────────────────
    const devRows: Array<[string, string]> = devParams?.max_gsf > 0
      ? [
          ["Max GSF", `${Math.round(devParams.max_gsf).toLocaleString()} SF`],
          ["Efficiency", `${devParams.efficiency_pct}%`],
          ["Max NRSF", `${Math.round(devParams.max_nrsf).toLocaleString()} SF`],
        ]
      : [];

    const bodyHtml = `
      <div class="section">
        <h2>Site Information</h2>
        ${renderKvTable(siteRows)}
      </div>
      <div class="section">
        <h2>Zoning Information</h2>
        ${renderKvTable(zoningRows)}
        ${setbackRows.length > 0 ? `<h3>Setbacks</h3>${renderKvTable(setbackRows)}` : ""}
        ${heightLimitsHtml}
        ${bonusesHtml}
        ${legislationHtml}
        ${sourceHtml}
      </div>
      ${devRows.length > 0
        ? `<div class="section"><h2>Development Parameters</h2>${renderKvTable(devRows)}</div>`
        : ""}
      ${narrative
        ? `<div class="section"><h2>AI Zoning Analysis</h2>${markdownToHtml(narrative)}</div>`
        : ""}
    `;

    const html = renderReportHtml({
      title: `Zoning Report — ${dealName}`,
      headline: dealName,
      subtitle: "Zoning & Site Report",
      eyebrow: "SITE DUE DILIGENCE",
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

    const filename = `Zoning-Report-${dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.pdf`;

    try {
      const docId = uuidv4();
      const dateStamp = new Date().toISOString().slice(0, 10);
      const blobPath = `deals/${params.id}/reports/${dateStamp}-${docId}-${filename}`;
      const url = await uploadBlob(blobPath, pdf, "application/pdf");
      await documentQueries.create({
        id: docId,
        deal_id: params.id,
        name: `Zoning Report — ${dealName}`,
        original_name: filename,
        category: "zoning_report",
        file_path: url,
        file_size: pdf.length,
        mime_type: "application/pdf",
        content_text: null,
        ai_summary: `Zoning & Site Report · ${new Date().toLocaleDateString()}`,
        ai_tags: ["zoning-report", "ai-generated", "pdf"],
      });
    } catch (saveErr) {
      console.warn("Failed to save zoning report PDF to documents:", (saveErr as Error).message?.slice(0, 200));
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
    console.error("Zoning Report PDF export error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Export failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}
