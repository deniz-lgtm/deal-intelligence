import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, dealNoteQueries, omAnalysisQueries, underwritingQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { CONCISE_STYLE } from "@/lib/ai-style";

const MODEL = "claude-sonnet-4-6";

function parseJsonArray(raw: string): unknown[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * POST /api/deals/:id/capex-estimate
 * Use AI to generate estimated CapEx / development budget line items based on
 * deal info, investment strategy, OM analysis, and analyst notes.
 *
 * For ground-up: generates hard cost $/SF categories + soft cost categories
 * For value-add / other: generates traditional CapEx line items
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id);
    const analysis = await omAnalysisQueries.getByDealId(params.id);
    const uw = await underwritingQueries.getByDealId(params.id);

    // Use project-level GSF from underwriting data, fall back to OM/deal SF
    const uwData = uw?.data ? (typeof uw.data === "string" ? JSON.parse(uw.data) : uw.data) : null;
    const projectGSF = uwData?.max_gsf || deal.square_footage || 0;

    // Summarize the drawn site plan + programmed massing so the estimator can
    // reason about actual construction type (wood-frame vs podium vs high-rise),
    // parking (surface/structured/below-grade), and use mix — all of which move
    // hard $/GSF dramatically.
    const siteMassingText = summarizeSiteAndMassingForCapex(uwData);

    const dealInfo = [
      `Property Type: ${deal.property_type ?? "unknown"}`,
      deal.investment_strategy ? `Investment Strategy: ${deal.investment_strategy}` : null,
      deal.units ? `Units: ${deal.units}` : null,
      projectGSF ? `Project GSF: ${projectGSF.toLocaleString()}` : null,
      deal.year_built ? `Year Built: ${deal.year_built}` : null,
      [deal.address, deal.city, deal.state].filter(Boolean).length
        ? `Address: ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}`
        : null,
      siteMassingText ? `\n${siteMassingText}` : null,
    ].filter(Boolean).join("\n");

    const redFlagsText = analysis && Array.isArray(analysis.red_flags) && analysis.red_flags.length > 0
      ? `OM RED FLAGS:\n${(analysis.red_flags as Array<{ description: string; severity?: string }>)
          .map(f => `- [${f.severity ?? "?"}] ${f.description}`)
          .join("\n")}`
      : "";

    const recommendationsText = analysis && Array.isArray(analysis.recommendations) && analysis.recommendations.length > 0
      ? `OM RECOMMENDATIONS:\n${(analysis.recommendations as string[]).map(r => `- ${r}`).join("\n")}`
      : "";

    const summaryText = analysis?.summary ? `OM SUMMARY: ${analysis.summary}` : "";

    const memoryText = await dealNoteQueries.getMemoryText(params.id);
    const contextText = memoryText
      ? `ANALYST NOTES (from deal notes):\n${memoryText}`
      : "";

    const isGroundUp = deal.investment_strategy === "ground_up";

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);

    try {
      if (isGroundUp) {
        const prompt = buildGroundUpPrompt(dealInfo, summaryText, redFlagsText, recommendationsText, contextText);
        const response = await client.messages.create(
          { model: MODEL, max_tokens: 500, messages: [{ role: "user", content: prompt }] },
          { signal: controller.signal }
        );
        const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
        const parsed = parseJsonObject(raw);
        return NextResponse.json({
          hard_cost_per_sf: parsed?.hard_cost_per_sf ?? 150,
          soft_cost_pct: parsed?.soft_cost_pct ?? 25,
          basis: parsed?.basis ?? "",
          strategy: "ground_up",
        });
      }

      const prompt = buildValueAddPrompt(dealInfo, summaryText, redFlagsText, recommendationsText, contextText);
      const response = await client.messages.create(
        { model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] },
        { signal: controller.signal }
      );
      const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
      const estimates = parseJsonArray(raw);

      return NextResponse.json({ data: estimates, strategy: deal.investment_strategy || "value_add" });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    console.error("POST /api/deals/[id]/capex-estimate error:", error);
    return NextResponse.json({ error: "Estimation failed" }, { status: 500 });
  }
}

// Summarize the drawn site plan + programmed massing so the cost estimator
// can reason about actual construction type + parking + use mix — all of
// which move hard $/GSF materially. Mirror of the helper used by the
// investment package generator but scoped to the fields an estimator cares
// about (structure, height, parking treatment, program mix).
type CapexRec = Record<string, unknown>;
function summarizeSiteAndMassingForCapex(uwData: CapexRec | null): string {
  if (!uwData) return "";
  const sp = (uwData.site_plan || {}) as CapexRec;
  const bp = (uwData.building_program || {}) as CapexRec;

  const lines: string[] = [];

  const scenarios = (Array.isArray(sp.scenarios) ? sp.scenarios : []) as CapexRec[];
  const active = scenarios.find((s) => (s as CapexRec).is_base_case)
    || scenarios.find((s) => (s as CapexRec).id === sp.active_scenario_id)
    || scenarios[0];
  if (active) {
    const parcelSf = Number((active as CapexRec).parcel_area_sf || 0);
    const parcelAc = parcelSf ? (parcelSf / 43560).toFixed(2) : null;
    const bldgs = (Array.isArray((active as CapexRec).buildings) ? (active as CapexRec).buildings : []) as CapexRec[];
    const totalFootprint = bldgs.reduce((s, b) => s + Number((b as CapexRec).area_sf || 0), 0);
    const cov = (parcelSf && totalFootprint) ? ((totalFootprint / parcelSf) * 100).toFixed(1) : null;
    lines.push(`SITE PLAN (base case, drawn to scale on satellite):`);
    if (parcelSf) lines.push(`  Parcel: ${parcelSf.toLocaleString()} SF (${parcelAc} ac)`);
    if (bldgs.length) lines.push(`  Buildings: ${bldgs.length} | Combined footprint: ${totalFootprint.toLocaleString()} SF${cov ? ` (${cov}% lot coverage)` : ""}`);
  }

  const massings = (Array.isArray(bp.scenarios) ? bp.scenarios : []) as CapexRec[];
  const baseMassing = massings.find((m) => (m as CapexRec).is_baseline)
    || massings.find((m) => (m as CapexRec).id === bp.active_scenario_id)
    || massings[0];
  if (baseMassing) {
    const floors = (Array.isArray((baseMassing as CapexRec).floors) ? (baseMassing as CapexRec).floors : []) as CapexRec[];
    const above = floors.filter((f) => !(f as CapexRec).is_below_grade);
    const below = floors.filter((f) => !!(f as CapexRec).is_below_grade);
    const totalGSF = floors.reduce((s, f) => s + Number((f as CapexRec).floor_plate_sf || 0), 0);
    const heightFt = above.reduce((s, f) => s + Number((f as CapexRec).floor_to_floor_ft || 0), 0);
    const byUse: Record<string, number> = {};
    for (const f of floors) {
      const u = String((f as CapexRec).use_type || "other");
      byUse[u] = (byUse[u] || 0) + Number((f as CapexRec).floor_plate_sf || 0);
    }
    const parkSF = byUse.parking || 0;
    const parkShare = totalGSF ? (parkSF / totalGSF) * 100 : 0;
    const hasBelowGradeParking = below.some((f) => (f as CapexRec).use_type === "parking");
    const hasAboveGradeParking = above.some((f) => (f as CapexRec).use_type === "parking");
    const useMix = Object.entries(byUse)
      .sort((a, b) => b[1] - a[1])
      .map(([u, sf]) => `${u} ${Math.round(sf).toLocaleString()} SF`)
      .join(", ");

    // Infer a likely construction type from height + stories — gives the
    // estimator a concrete starting point for hard-cost pricing.
    let inferredType = "";
    const stories = above.length;
    if (stories <= 4) inferredType = "Likely wood-frame (Type III/V) — low-rise";
    else if (stories <= 7) inferredType = "Likely wood/stick over podium (Type III/V over Type I) — mid-rise";
    else if (stories <= 15) inferredType = "Likely concrete flat-plate or hybrid — mid-to-high-rise";
    else inferredType = "Likely concrete or structural steel — high-rise";

    lines.push(`PROGRAMMED MASSING (base case):`);
    lines.push(`  ${above.length} above-grade + ${below.length} below-grade floors | ~${Math.round(heightFt)} ft above-grade height`);
    lines.push(`  Total GSF: ${totalGSF.toLocaleString()}`);
    if (useMix) lines.push(`  Program Mix: ${useMix}`);
    if (parkSF) {
      lines.push(`  Parking: ${Math.round(parkSF).toLocaleString()} SF (${parkShare.toFixed(0)}% of GSF) — ${hasBelowGradeParking ? "below-grade" : hasAboveGradeParking ? "structured above-grade" : "surface"}`);
    }
    if (inferredType) lines.push(`  Structure Inference: ${inferredType}`);
    if ((baseMassing as CapexRec).density_bonus_applied) {
      lines.push(`  Density Bonus: ${String((baseMassing as CapexRec).density_bonus_applied)} applied`);
    }
  }

  return lines.length ? `[DRAWN SITE PLAN + PROGRAMMED MASSING]\n${lines.join("\n")}` : "";
}

function buildGroundUpPrompt(
  dealInfo: string,
  summaryText: string,
  redFlagsText: string,
  recommendationsText: string,
  contextText: string,
): string {
  return `${CONCISE_STYLE}

ROLE: You are a senior development cost estimator preparing a budget input for an institutional Investment Committee. The output will flow directly into the underwriting's sources-and-uses and drive the go/no-go decision, so your numbers must be defensible to a managing director with 20 years of development experience.

${dealInfo}
${summaryText}
${redFlagsText}
${recommendationsText}
${contextText}

TASK: Produce two numbers — hard_cost_per_sf and soft_cost_pct — that reflect CURRENT (2024-2025) contractor pricing in the indicated market. Work from the drawn site plan and programmed massing if provided, not generic averages.

HARD COST LOGIC — walk through the following before committing to a number:
1. Construction type implied by the floor stack (height, structure, parking):
   - ≤ 4 stories above a podium → wood-frame over Type I podium ("5-over-1"): ~$200-260/GSF base
   - 5-7 stories residential → wood over 1-2 podium levels, or Type III/V over podium: ~$240-320/GSF
   - 8-15 stories → concrete or hybrid: ~$330-460/GSF
   - 15+ stories → high-rise concrete/steel: ~$450-650/GSF
2. Parking premium — below-grade parking adds roughly $40-80/GSF of parking area; structured above-grade adds $25-50/GSF; surface is closest to $0. Scale proportionally by the parking SF share of total GSF.
3. Use mix premium — retail / amenity / office shell adds vs. residential base; mechanical floors should be priced near shell only.
4. Geography multiplier — coastal/major gateway markets (SF, NYC, Boston, DC, Seattle) price 20-40% above Sunbelt baseline; tertiary markets may be 10-15% below.
5. Site work / subgrade conditions — if OM flags poor soils, environmental remediation, or difficult access, add 3-8% to base hard cost.
6. Escalation — carry 4-6% annual escalation to mid-construction from current bids.

SOFT COST LOGIC:
- Baseline 20-25% of hard for typical MF infill. Add if: long entitlement fight (+3-5%), complex agency financing (+2-3%), extended construction duration pushing interest reserve (+2-5%), union labor markets, LEED/affordable overlays.
- Always carry enough for: A&E 5-8%, permits/fees 2-5%, legal 1-2%, development management 3-5%, financing costs + interest reserve 4-8%, owner contingency 4-7%.

CALIBRATION:
- Anchor your number to the specific construction type, NOT a generic $/GSF average.
- If parking and podium make up >30% of GSF, pricing trends higher — note this in basis.
- If the analyst notes or OM call out market-specific drivers (hard-market insurance, labor tightness, agency-required prevailing wage), incorporate them.

Return ONLY a JSON object, no explanation:
{
  "hard_cost_per_sf": 245,
  "soft_cost_pct": 25,
  "basis": "5-over-1 wood-frame MF in Austin TX, mid-2025 pricing. Base Type III/V ~$215/GSF + ~15% for structured podium parking (28% of GSF) + 3% escalation to mid-construction = ~$245/GSF. Soft at 25% reflects typical 24-mo entitlement/construction timeline and market-rate interest reserve."
}`;
}

function buildValueAddPrompt(
  dealInfo: string,
  summaryText: string,
  redFlagsText: string,
  recommendationsText: string,
  contextText: string,
): string {
  return `${CONCISE_STYLE}

ROLE: You are a senior asset-management CapEx estimator building the line-item budget for an institutional value-add acquisition. The output feeds the sources-and-uses in the IC underwriting and drives the ROC on CapEx. Numbers must be defensible to a skeptical Director of Construction.

${dealInfo}
${summaryText}
${redFlagsText}
${recommendationsText}
${contextText}

TASK: Produce 4-8 CapEx line items that reflect CURRENT (2024-2025) contractor pricing in the indicated market. Work from property-specific cues (age, prior renovation vintage, OM red flags, analyst notes) — avoid generic averages.

PRODUCT-TYPE PLAYBOOKS:
- MULTIFAMILY / SFR: unit interior scope tiered by age (light: $4-8k/unit, medium: $9-15k/unit, full gut: $20-35k/unit — appliances, LVP, counters, cabinets, bath, lighting), common areas / amenity refresh ($150-500/unit), exterior (paint, roof, parking, signage), and capital R&M (HVAC, water heaters, roofs, windows). Size unit scope to the comp rent premium the business plan is chasing.
- INDUSTRIAL / FLEX: roof ($12-22/SF), HVAC (rooftop units $6-12k each; VAV box replacements), dock equipment (dock levelers $6-9k, dock seals $1-2k), LED retrofit ($1-3/SF), paving/seal-coat/striping ($3-6/SF asphalt), office build-out ($40-80/SF white-box, $80-150/SF spec suite), life safety upgrades.
- OFFICE / RETAIL: base-building HVAC, roof, parking, common-area refresh, spec-suite TI packages ($65-120/SF), leasing commissions (embed separately if material), restroom/ADA, energy-efficiency upgrades.
- MIXED-USE / HOSPITALITY: keep unit + PIP scope separate; differentiate FF&E vs. Case Goods vs. soft goods.

RULES:
- Every item needs a realistic quantity and a unit of measure: "per unit", "per SF", "lump sum", "per bay", "per door".
- Cost_per_unit is the UNIT RATE, not the line total — the line total = quantity × cost_per_unit.
- Basis must cite the reason (age from year-built, scope tier tied to business plan, comp rent premium, OM red flag).
- Prioritize items that are either (a) capital-critical (roof, HVAC, envelope, parking) or (b) directly tied to the rent lift / re-tenanting thesis. Avoid noise like "miscellaneous repairs" — that belongs in operating reserves.
- Use a renovation-vintage lens: properties 15+ years past last capital event usually need envelope + MEP; 5-10 years out typically just cosmetic + targeted mechanical.

Return ONLY a JSON array, no explanation:
[
  {
    "label": "Roof Replacement",
    "quantity": 1,
    "unit": "lump sum",
    "cost_per_unit": 45000,
    "basis": "18,000 SF flat TPO roof, age >20 yrs per year-built, replacement at ~$14/SF incl. tear-off and insulation"
  },
  {
    "label": "HVAC Replacement — RTUs",
    "quantity": 4,
    "unit": "unit",
    "cost_per_unit": 8000,
    "basis": "4 rooftop package units at end-of-life (15+ yrs); $8k per 5-ton RTU installed"
  }
]`;
}
