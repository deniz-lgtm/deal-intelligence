import {
  markdownToHtml,
  renderKvTable,
  inlineMarkdownToHtml,
} from "@/lib/report-html-shell";
import { renderBrandedPdf } from "./_shared/branded-pdf";
import type { ArtifactGenerator } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

interface ZoningReportPayload {
  dealName?: string;
  siteInfo?: AnyRec;
  zoningInfo?: AnyRec;
  devParams?: AnyRec;
  narrative?: string;
  deal?: { id: string; updated_at: string | Date | null } | null;
  underwriting?: { id: string; updated_at: string | Date | null } | null;
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
 * Composes structured zoning data (site info, zoning, setbacks, bonuses,
 * dev parameters) into a branded PDF. Mirrors the body HTML the old
 * /zoning-report/export route produced — same fields, same tables —
 * just routed through the unified artifact pipeline.
 */
const zoningReportGenerator: ArtifactGenerator = async (opts) => {
  const payload = (opts.payload ?? {}) as ZoningReportPayload;
  const dealName = payload.dealName ?? "Deal";
  const siteInfo = payload.siteInfo ?? {};
  const zoningInfo = payload.zoningInfo ?? {};
  const devParams = payload.devParams ?? {};
  const narrative = payload.narrative ?? "";

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

  const zoningRows: Array<[string, string]> = [
    ["Zoning Designation", zoningInfo?.zoning_designation || "—"],
    ["FAR", zoningInfo?.far != null ? String(zoningInfo.far) : "—"],
    ["Lot Coverage", zoningInfo?.lot_coverage_pct != null ? `${zoningInfo.lot_coverage_pct}%` : "—"],
    ["Density (DU/AC)", zoningInfo?.density_du_per_ac != null ? String(zoningInfo.density_du_per_ac) : "—"],
    ["Permitted Uses", zoningInfo?.permitted_uses || "—"],
  ];

  const setbackRows: Array<[string, string]> = Array.isArray(zoningInfo?.setbacks)
    ? zoningInfo.setbacks.map((s: AnyRec) => [esc(s.side || ""), esc(s.distance_ft ? `${s.distance_ft} ft` : "—")])
    : [];

  const heightLimitsHtml = Array.isArray(zoningInfo?.height_limits)
    ? zoningInfo.height_limits
        .map(
          (h: AnyRec) =>
            `<p><strong>${esc(h.label || "Height")}:</strong> ${esc(h.feet ? `${h.feet} ft` : "—")}</p>`
        )
        .join("")
    : "";

  const bonusesHtml = Array.isArray(zoningInfo?.density_bonuses) && zoningInfo.density_bonuses.length > 0
    ? `<h3>Density Bonuses</h3>${zoningInfo.density_bonuses
        .map((b: AnyRec) => `<p>${inlineMarkdownToHtml(b.description || "")}</p>`)
        .join("")}`
    : "";

  const legislationHtml = zoningInfo?.legislation
    ? `<p><strong>Enabling Legislation:</strong> ${inlineMarkdownToHtml(zoningInfo.legislation)}</p>`
    : "";

  const sourceHtml = zoningInfo?.source_url
    ? `<p><strong>Source:</strong> <a href="${esc(zoningInfo.source_url)}">${esc(zoningInfo.source_url)}</a></p>`
    : "";

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

  return renderBrandedPdf(opts, {
    kind: "zoning_report",
    artifactTitle: "Zoning Report",
    headline: dealName,
    eyebrow: "SITE DUE DILIGENCE",
    subtitle: "Zoning & Site Report",
    bodyHtml,
    summary: `Zoning & Site Report · ${new Date().toLocaleDateString()}`,
    hashExtras: {
      zoningDesignation: zoningInfo?.zoning_designation ?? null,
      narrativeLength: narrative.length,
    },
    deal: payload.deal ?? null,
    underwriting: payload.underwriting ?? null,
  });
};

export default zoningReportGenerator;
