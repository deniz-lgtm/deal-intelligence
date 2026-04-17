import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, underwritingQueries, documentQueries, checklistQueries, omAnalysisQueries, businessPlanQueries, devPhaseQueries, preDevCostQueries, compQueries, submarketMetricsQueries, locationIntelligenceQueries, marketReportsQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import {
  buildUnderwritingSummary,
  buildOmSummary,
  buildMarketSummary,
} from "@/lib/deal-analytics-context";

const MODEL = "claude-sonnet-4-6";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

const AUDIENCE_TONES: Record<string, string> = {
  lp_investor:
    "AUDIENCE: Institutional Limited Partners (public pensions, sovereigns, endowments, insurance co's, large family offices). They evaluate dozens of funds and deals per quarter and will benchmark this investment against their entire portfolio.\n" +
    "VOICE: Formal, institutional, return-focused — but not promotional. Lead with the thesis in one sentence. Emphasize gross/net returns, DPI/MOIC pacing, downside protection, alignment (GP co-invest, fee structure), sponsor track record with specific prior realizations, and exit optionality. Every return figure gets a matching downside scenario. Risk is addressed head-on with mitigants — never buried. Use $-denominated numbers, bps, and comps. No adjectives (no 'irreplaceable', 'premier', 'world-class').",
  investment_committee:
    "AUDIENCE: Internal Investment Committee at a top-tier institutional manager (Blackstone / KKR / Starwood / Oaktree caliber). Readers include Managing Directors, the Head of Acquisitions, a Chief Investment Officer, and Risk. They have 15 minutes with this memo before a 45-minute discussion. They do not need education — they need the sharp edges.\n" +
    "VOICE: Analytical, blunt, assumption-driven. Open with the deal in ONE sentence (strategy / size / basis / yield on cost / IRR / hold). Follow with the three reasons this deal works and the three reasons it could fail. Separate UNDERWRITTEN from VERIFIED from ASSUMED. Show a base / downside / upside sensitivity on the two most important variables (rent growth and exit cap for stabilized; cost and lease-up for ground-up). Quantify every risk in dollars or bps. Compare basis to recent submarket comps and flag the spread. Take a position — do not hedge. No marketing language. No 'important to note'.",
  lender:
    "AUDIENCE: Senior lender / debt capital markets counterparty (balance-sheet bank, debt fund, agency, life co). They underwrite the collateral and the sponsor, not the equity return.\n" +
    "VOICE: Conservative, coverage-focused. Lead with: loan request, LTV/LTC, DSCR at stabilization, debt yield, recourse posture. Emphasize collateral quality, in-place cash flow stability, rent roll granularity, tenant credit (if commercial), environmental/physical condition, and sponsor guarantee capacity. Stress test DSCR and debt yield against +100/+200 bps rate moves and -10% NOI. Address any prior workouts or modifications on sponsor's portfolio directly.",
  internal_review:
    "AUDIENCE: Internal acquisitions / asset management team doing initial screen. Purpose is a pre-IC go/no-go.\n" +
    "VOICE: Direct, efficient, engineer-style. Flag blockers in the first paragraph. State the bid strategy, the walk price, and the re-trade triggers. Polish is not needed — signal is. If the deal is a pass, say so and list the three dispositive reasons.",
};

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  pitch_deck:
    "FORMAT: Board-ready slide deck.\n" +
    "- 3-6 bullet points per slide, each bullet ≤ 15 words.\n" +
    "- Lead bullet is the takeaway / headline metric. Supporting bullets are evidence.\n" +
    "- Use markdown: `## Subheader` (max 2 per slide), `-` for bullets, `**bold**` for the key metric inside each bullet.\n" +
    "- Prefer numbers to adjectives. Never write 'strong demand' — write 'Submarket vacancy 4.8%, 130 bps below MSA'.\n" +
    "- No paragraphs, no run-on sentences, no filler.",
  investment_memo:
    "FORMAT: Institutional investment memo (Word / PDF).\n" +
    "- Open each section with a 1-sentence bottom-line / takeaway in bold.\n" +
    "- Follow with 2-4 focused paragraphs (3-5 sentences each) of supporting analysis. Each paragraph makes ONE point.\n" +
    "- Mix prose with tight bullet lists when showing metrics, comps, or sensitivities — don't bury numbers in prose.\n" +
    "- Use markdown `##` for section headers, `###` for sub-topics (e.g. 'Supply Pipeline', 'Rent Growth Drivers').\n" +
    "- Cite sources inline: '(per T-12)', '(CoStar Q3 2024)', '(broker OM)'. If the source is missing, flag it as 'UNVERIFIED'.\n" +
    "- Always show base case with at least one downside sensitivity for the numbers that matter.",
  one_pager:
    "FORMAT: Single-page teaser / executive summary.\n" +
    "- Total length ≤ 350 words across ALL sections combined.\n" +
    "- Each section = 1 headline sentence + at most 2 bullets with the 3-4 numbers that matter.\n" +
    "- Focus: thesis, basis ($/unit or $/SF), going-in and stabilized yield, levered IRR, equity multiple, hold, total equity check.\n" +
    "- No narrative. No adjectives. Just the numbers and the thesis.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface GenerateRequest {
  audience: string;
  format: string;
  sections: string[];
  existingNotes?: Record<string, string[]>; // sectionId -> user notes
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body: GenerateRequest = await req.json();
    const { audience, format, sections, existingNotes = {} } = body;

    // Fetch ALL deal data in parallel
    const [deal, uwRow, omAnalysis, docs, checklist, photosRes, devPhases, preDevCosts, compsAll, submarketMetrics, locationIntelRows, marketReports] = await Promise.all([
      dealQueries.getById(params.id),
      underwritingQueries.getByDealId(params.id),
      omAnalysisQueries.getByDealId(params.id),
      documentQueries.getByDealId(params.id),
      checklistQueries.getByDealId(params.id),
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/deals/${params.id}/photos`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => ({ data: [] })),
      devPhaseQueries.getByDealId(params.id).catch(() => []),
      preDevCostQueries.getByDealId(params.id).catch(() => []),
      compQueries.getByDealId(params.id).catch(() => []),
      submarketMetricsQueries.getByDealId(params.id).catch(() => null),
      locationIntelligenceQueries.getByDealId(params.id).catch(() => []),
      marketReportsQueries.getByDealId(params.id).catch(() => []),
    ]);

    // Use deal notes for context instead of legacy context_notes
    deal.context_notes = await dealNoteQueries.getMemoryText(params.id) || null;

    // Fetch linked business plan if set
    const businessPlan = deal.business_plan_id
      ? await businessPlanQueries.getById(deal.business_plan_id)
      : null;

    const uw: AnyRecord | null = uwRow?.data
      ? (typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data)
      : null;
    const photos = photosRes?.data || [];
    const n = (v: unknown) => typeof v === "number" ? v : 0;
    const fc = (v: number) => `$${Math.round(v).toLocaleString()}`;

    // Pull analyst deal notes so they can flow into the UW summary (thesis,
    // risk, context buckets) instead of only landing in the section prompts.
    const allDealNotes = await dealNoteQueries.getByDealId(params.id) as Array<{ text: string; category: string }>;

    // Build the full computed UW / OM / market analytics blocks ONCE so
    // every section prompt sees the same NOI, cap rate, yield on cost,
    // DSCR, debt yield, loss-to-lease, OpEx build, comp-set averages, and
    // submarket demographics. Previously the investment-package prompts
    // only saw raw inputs and had to re-derive returns themselves, which
    // the model did inconsistently section-to-section.
    const uwSummary = buildUnderwritingSummary(uw, deal, allDealNotes);
    const omSummary = buildOmSummary(omAnalysis);
    const marketSummary = buildMarketSummary(
      submarketMetrics as AnyRecord | null,
      compsAll as AnyRecord[],
      locationIntelRows as AnyRecord[],
      marketReports as AnyRecord[]
    );

    // Build master deal context — now enriched with full UW + OM + market.
    const dealContext = buildDealContext(
      deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[],
      photos, businessPlan as AnyRecord | null,
      uwSummary, omSummary, marketSummary
    );

    // Build per-section context
    const sectionContexts: Record<string, string> = {};
    for (const sectionId of sections) {
      sectionContexts[sectionId] = buildSectionContext(sectionId, deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[], photos, n, fc, businessPlan as AnyRecord | null, devPhases as AnyRecord[], preDevCosts as AnyRecord[], compsAll as AnyRecord[], submarketMetrics as AnyRecord | null, locationIntelRows as AnyRecord[]);
    }

    const audienceTone = AUDIENCE_TONES[audience] || AUDIENCE_TONES.investment_committee;
    const formatInstr = FORMAT_INSTRUCTIONS[format] || FORMAT_INSTRUCTIONS.investment_memo;

    // Generate all sections
    const results: Array<{ id: string; content: string; generated_at: string }> = [];

    for (const sectionId of sections) {
      // Skip sections that don't need AI
      if (sectionId === "photos" || sectionId === "appendix") {
        results.push({ id: sectionId, content: sectionContexts[sectionId] || "", generated_at: new Date().toISOString() });
        continue;
      }

      const userNotes = existingNotes[sectionId]?.filter(n => n.trim()) || [];
      const sectionCtx = sectionContexts[sectionId] || "";

      const prompt = `${audienceTone}

${formatInstr}

DEAL CONTEXT:
${dealContext}

SECTION-SPECIFIC DATA:
${sectionCtx}

${userNotes.length > 0 ? `THE ANALYST HAS PROVIDED THESE KEY POINTS TO INCORPORATE:\n${userNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n` : ""}
Write the "${SECTION_TITLES[sectionId] || sectionId}" section. Use the deal data provided — be specific with numbers. All percentage values are already in percent form (5 = 5%, not 0.05). Do not include the section title as a header — just the content.`;

      try {
        const response = await getClient().messages.create({
          model: MODEL,
          max_tokens: format === "one_pager" ? 500 : format === "pitch_deck" ? 1500 : 2500,
          messages: [{ role: "user", content: prompt }],
        });
        const text = response.content[0].type === "text" ? response.content[0].text : "";
        results.push({ id: sectionId, content: text, generated_at: new Date().toISOString() });
      } catch (err) {
        console.error(`Failed to generate section ${sectionId}:`, err);
        results.push({ id: sectionId, content: `*Generation failed for this section.*`, generated_at: new Date().toISOString() });
      }
    }

    return NextResponse.json({ data: results });
  } catch (error) {
    console.error("Generate-all error:", error);
    return NextResponse.json({ error: "Generation failed" }, { status: 500 });
  }
}

const SECTION_TITLES: Record<string, string> = {
  cover: "Cover Page",
  exec_summary: "Executive Summary & Investment Thesis",
  property_overview: "Property Overview",
  site_massing: "Site Plan, Massing & Buildable Program",
  location_market: "Market & Submarket Analysis",
  financial_summary: "Transaction Summary & Sources / Uses",
  unit_mix: "Unit Mix, Revenue & Loss-to-Lease",
  rent_comps: "Rent & Sales Comp Analysis",
  value_add: "Business Plan & Value Creation",
  operating_plan: "Operating Plan & OpEx Build-Up",
  capital_structure: "Capital Structure & Debt Strategy",
  returns_analysis: "Returns & Sensitivity Analysis",
  exit_strategy: "Exit Strategy & Residual Value",
  development_schedule: "Development Schedule & Critical Path",
  predev_budget: "Pre-Development Budget & Approvals",
  risk_factors: "Risk Factors & Mitigants",
  photos: "Property Photos",
  appendix: "Appendix",
};

const THESIS_LABELS: Record<string, string> = {
  value_add: "Value-Add",
  ground_up: "Ground-Up Development",
  core: "Core",
  core_plus: "Core-Plus",
  opportunistic: "Opportunistic",
};

// ── Site Plan + Massing summary helper ──────────────────────────────────────
// The site plan lives at uw.site_plan and the massing/building program at
// uw.building_program. Both are JSONB blobs shaped per src/lib/types.ts.
// We produce a compact, IC-ready text summary so Claude can reference the
// actual drawn parcel, footprint, floor stack, unit mix, and parking.
function summarizeSiteAndMassing(uw: AnyRecord | null): string {
  if (!uw) return "";
  const sp = (uw.site_plan || {}) as AnyRecord;
  const bp = (uw.building_program || {}) as AnyRecord;
  const lines: string[] = [];

  // Site plan scenarios (parcel + building footprints drawn on satellite)
  const scenarios: AnyRecord[] = Array.isArray(sp.scenarios) ? sp.scenarios : [];
  const active = scenarios.find(s => s.is_base_case)
    || scenarios.find(s => s.id === sp.active_scenario_id)
    || scenarios[0];
  if (active) {
    const parcelAc = active.parcel_area_sf ? (Number(active.parcel_area_sf) / 43560).toFixed(2) : null;
    const bldgs: AnyRecord[] = Array.isArray(active.buildings) ? active.buildings : [];
    const totalFootprint = bldgs.reduce((s, b) => s + Number(b.area_sf || 0), 0);
    const cov = (active.parcel_area_sf && totalFootprint)
      ? ((totalFootprint / Number(active.parcel_area_sf)) * 100).toFixed(1)
      : null;
    lines.push(`Site Plan (base case "${active.name || "Massing 1"}"):`);
    if (active.parcel_area_sf) lines.push(`  Parcel: ${Number(active.parcel_area_sf).toLocaleString()} SF (${parcelAc} ac)`);
    if (bldgs.length) {
      lines.push(`  Buildings drawn: ${bldgs.length} | Combined footprint: ${totalFootprint.toLocaleString()} SF${cov ? ` (${cov}% lot coverage)` : ""}`);
      for (const b of bldgs.slice(0, 6)) {
        lines.push(`    - ${b.label || "Building"}: ${Number(b.area_sf || 0).toLocaleString()} SF footprint${b.cutouts?.length ? ` (${b.cutouts.length} cutout${b.cutouts.length > 1 ? "s" : ""})` : ""}`);
      }
    }
    if (active.frontage_length_ft) lines.push(`  Street frontage: ${Math.round(active.frontage_length_ft).toLocaleString()} LF`);
    if (scenarios.length > 1) lines.push(`  Alternative massings drawn: ${scenarios.length - 1}`);
  }

  // Building program / massing scenarios (the floor stack)
  const massings: AnyRecord[] = Array.isArray(bp.scenarios) ? bp.scenarios : [];
  const baseMassing = massings.find(m => m.is_baseline) || massings.find(m => m.id === bp.active_scenario_id) || massings[0];
  if (baseMassing) {
    const floors: AnyRecord[] = Array.isArray(baseMassing.floors) ? baseMassing.floors : [];
    const above = floors.filter(f => !f.is_below_grade);
    const below = floors.filter(f => f.is_below_grade);
    const totalGSF = floors.reduce((s, f) => s + Number(f.floor_plate_sf || 0), 0);
    const totalNRSF = floors.reduce((s, f) => s + Math.round(Number(f.floor_plate_sf || 0) * (Number(f.efficiency_pct || 0) / 100)), 0);
    const totalUnits = floors.reduce((s, f) => s + Number(f.units_on_floor || 0), 0);
    const heightFt = above.reduce((s, f) => s + Number(f.floor_to_floor_ft || 0), 0);

    const byUse: Record<string, number> = {};
    for (const f of floors) {
      const u = String(f.use_type || "other");
      byUse[u] = (byUse[u] || 0) + Number(f.floor_plate_sf || 0);
    }
    const useMix = Object.entries(byUse)
      .sort((a, b) => b[1] - a[1])
      .map(([u, sf]) => `${u} ${Math.round(sf).toLocaleString()} SF`)
      .join(", ");

    const parkSF = byUse.parking || 0;
    const parkSpaces = Math.floor(parkSF / (Number(baseMassing.parking_sf_per_space) || 350));

    lines.push(`Massing (base case "${baseMassing.name || "Massing 1"}"):`);
    lines.push(`  ${above.length} above-grade + ${below.length} below-grade floors | ~${Math.round(heightFt)} ft total height`);
    lines.push(`  Total GSF: ${totalGSF.toLocaleString()} | Total NRSF: ${totalNRSF.toLocaleString()} | Efficiency: ${totalGSF ? Math.round((totalNRSF / totalGSF) * 100) : 0}%`);
    if (totalUnits) lines.push(`  Residential Units: ${totalUnits}`);
    if (parkSpaces) lines.push(`  Parking: ~${parkSpaces.toLocaleString()} spaces (${Math.round(parkSF).toLocaleString()} SF parking GSF)`);
    if (useMix) lines.push(`  Program Mix (GSF by use): ${useMix}`);

    // Unit mix
    const unitMix: AnyRecord[] = Array.isArray(baseMassing.unit_mix) ? baseMassing.unit_mix : [];
    if (unitMix.length && totalUnits) {
      const mixLines = unitMix.map(u => {
        const ct = Math.round((Number(u.allocation_pct || 0) / 100) * totalUnits);
        return `${u.type_label || "?"}: ${u.allocation_pct || 0}% (~${ct}u, avg ${u.avg_sf || 0} SF)`;
      });
      lines.push(`  Unit Mix: ${mixLines.join(" | ")}`);
    }

    if (baseMassing.density_bonus_applied) {
      lines.push(`  Density Bonus Applied: ${baseMassing.density_bonus_applied} (+${Number(baseMassing.density_bonus_far_increase || 0) * 100}% FAR, +${baseMassing.density_bonus_height_increase_ft || 0} ft)`);
    }
    if (baseMassing.ai_template_label) lines.push(`  Stack Template: ${baseMassing.ai_template_label}`);
    if (massings.length > 1) lines.push(`  Alternative floor stacks modeled: ${massings.length - 1}`);
  }

  return lines.join("\n");
}

function buildDealContext(
  deal: AnyRecord,
  uw: AnyRecord | null,
  om: AnyRecord | null,
  docs: AnyRecord[],
  checklist: AnyRecord[],
  photos: AnyRecord[],
  bp: AnyRecord | null,
  uwSummary?: string,
  omSummary?: string,
  marketSummary?: string
): string {
  const lines: string[] = [];
  lines.push(`Deal: ${deal.name}`);
  lines.push(`Address: ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}`);
  lines.push(`Type: ${deal.property_type} | Status: ${deal.status}`);
  lines.push(`Asking: ${deal.asking_price ? `$${Number(deal.asking_price).toLocaleString()}` : "TBD"} | Units: ${deal.units ?? "N/A"} | SF: ${deal.square_footage?.toLocaleString() ?? "N/A"} | Year Built: ${deal.year_built ?? "N/A"}`);

  // Site plan + massing (ground-up / redevelopment context)
  const siteMassing = summarizeSiteAndMassing(uw);
  if (siteMassing) lines.push(siteMassing);

  // Business Plan context
  if (bp) {
    const bpLines: string[] = [`Business Plan: ${bp.name}`];
    const theses = bp.investment_theses || [];
    if (theses.length > 0) bpLines.push(`Investment Thesis: ${theses.map((t: string) => THESIS_LABELS[t] || t).join(", ")}`);
    const markets = bp.target_markets || [];
    if (markets.length > 0) bpLines.push(`Target Markets: ${markets.join(", ")}`);
    const propTypes = bp.property_types || [];
    if (propTypes.length > 0) bpLines.push(`Target Property Types: ${propTypes.join(", ")}`);
    if (bp.target_irr_min || bp.target_irr_max) bpLines.push(`Target IRR: ${bp.target_irr_min ?? "?"}% – ${bp.target_irr_max ?? "?"}%`);
    if (bp.target_equity_multiple_min || bp.target_equity_multiple_max) bpLines.push(`Target Equity Multiple: ${bp.target_equity_multiple_min ?? "?"}x – ${bp.target_equity_multiple_max ?? "?"}x`);
    if (bp.hold_period_min || bp.hold_period_max) bpLines.push(`Hold Period: ${bp.hold_period_min ?? "?"}–${bp.hold_period_max ?? "?"} years`);
    if (bp.description?.trim()) bpLines.push(`Strategy Notes: ${bp.description.trim()}`);
    lines.push(bpLines.join("\n"));
  }

  if (deal.context_notes) lines.push(`\nAnalyst Memory: ${deal.context_notes}`);
  lines.push(`Documents: ${docs.length} uploaded | Photos: ${photos.length} | Checklist: ${checklist.length} items`);

  // Full computed underwriting (stabilized NOI, cap rate, yield on cost,
  // exit value, DSCR, debt yield, loss-to-lease, per-unit basis). Every
  // section prompt receives this so sections like exec_summary and
  // returns_analysis can cite the actual model outputs instead of trying
  // to re-derive them from scratch.
  if (uwSummary) lines.push(`\n━━━ INTERNAL UNDERWRITING MODEL ━━━\n${uwSummary}`);

  // Seller's representations from the OM — useful for highlighting any
  // delta between pitched metrics and our internal view.
  if (omSummary) lines.push(`\n━━━ OM ANALYSIS (SELLER'S REPRESENTATIONS) ━━━\n${omSummary}`);

  // Submarket metrics + sale / rent comp averages + demographics + growth
  // projections, so sections (location_market, exec_summary, exit_strategy,
  // risk_factors) can contextualize the deal against the actual market.
  if (marketSummary) lines.push(`\n━━━ MARKET & SUBMARKET CONTEXT ━━━\n${marketSummary}`);

  return lines.join("\n");
}

function buildSectionContext(
  sectionId: string, deal: AnyRecord, uw: AnyRecord | null, om: AnyRecord | null,
  docs: AnyRecord[], checklist: AnyRecord[], photos: AnyRecord[],
  n: (v: unknown) => number, fc: (v: number) => string, bp?: AnyRecord | null,
  devPhases: AnyRecord[] = [], preDevCosts: AnyRecord[] = [],
  compsAll: AnyRecord[] = [], submarketMetrics: AnyRecord | null = null,
  locationIntel: AnyRecord[] = []
): string {
  const isMF = deal.property_type === "multifamily" || deal.property_type === "sfr" || deal.property_type === "student_housing";
  const unitGroups = uw?.unit_groups || [];

  switch (sectionId) {
    case "exec_summary":
      return [
        bp ? `Investment Thesis: ${(bp.investment_theses || []).map((t: string) => THESIS_LABELS[t] || t).join(", ")}` : "",
        bp?.target_markets?.length ? `Target Markets: ${bp.target_markets.join(", ")}` : "",
        bp?.target_irr_min || bp?.target_irr_max ? `Target IRR: ${bp?.target_irr_min ?? "?"}–${bp?.target_irr_max ?? "?"}%` : "",
        om?.summary ? `OM Summary: ${om.summary}` : "",
        om?.score_reasoning ? `Score Reasoning: ${om.score_reasoning}` : "",
        deal.context_notes ? `Analyst Notes: ${deal.context_notes}` : "",
      ].filter(Boolean).join("\n");

    case "property_overview": {
      const siteMassing = summarizeSiteAndMassing(uw);
      return [
        `Name: ${deal.name}`,
        `Address: ${[deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ")}`,
        `Type: ${deal.property_type} | Year Built: ${deal.year_built} | Units: ${deal.units} | SF: ${deal.square_footage?.toLocaleString()}`,
        om?.property_type ? `OM Property Type: ${om.property_type}` : "",
        siteMassing ? `\n[SITE PLAN & MASSING — drawn to scale on satellite imagery + programmed floor stack]\n${siteMassing}` : "",
        ...docs.filter((d: AnyRecord) => d.ai_summary && (d.category === "om" || d.category === "marketing")).map((d: AnyRecord) => `Doc (${d.name}): ${d.ai_summary}`),
      ].filter(Boolean).join("\n");
    }

    case "site_massing": {
      const siteMassing = summarizeSiteAndMassing(uw);
      if (!siteMassing) return "No site plan or massing has been drawn for this deal. If this is a ground-up or redevelopment project, note that the physical program has not yet been formally drawn/programmed and the buildable envelope is an assumption.";
      const strategy = deal.investment_strategy ? `Investment Strategy: ${deal.investment_strategy}` : "";
      return [
        strategy,
        "",
        "[Drawn Site Plan — parcel polygon, building footprints, and frontage have been traced on to-scale satellite imagery.]",
        "[Programmed Massing — floor stack with primary + secondary uses per floor, unit mix, efficiency, and parking ratio is modeled.]",
        "",
        siteMassing,
        "",
        "GUIDANCE: Treat GSF / NRSF / unit count / parking as the BUILDABLE PROGRAM driving the underwriting. Call out lot coverage, FAR implied by above-grade GSF / parcel SF, any density-bonus assumptions, and whether parking ratio is in line with submarket norms for the product type. If more than one massing exists, compare the base case to the alternatives.",
      ].filter(Boolean).join("\n");
    }

    case "location_market": {
      const lines: string[] = [];
      if (deal.context_notes) lines.push(`Market Intel: ${deal.context_notes}`);

      // Submarket metrics (from the new Comps & Market tab)
      if (submarketMetrics) {
        const sm = submarketMetrics;
        const smLines: string[] = [];
        if (sm.submarket_name) smLines.push(`Submarket: ${sm.submarket_name}`);
        if (sm.msa) smLines.push(`MSA: ${sm.msa}`);
        if (sm.market_cap_rate != null) smLines.push(`Market Cap Rate: ${sm.market_cap_rate}%`);
        if (sm.market_vacancy != null) smLines.push(`Market Vacancy: ${sm.market_vacancy}%`);
        if (sm.market_rent_growth != null) smLines.push(`Market Rent Growth: ${sm.market_rent_growth}%/yr`);
        if (sm.absorption_units != null) smLines.push(`Absorption: ${sm.absorption_units} units/yr`);
        if (sm.deliveries_units != null) smLines.push(`Deliveries: ${sm.deliveries_units} units/yr`);
        if (smLines.length) lines.push("Submarket Metrics:\n  " + smLines.join("\n  "));
        if (sm.narrative) lines.push(`Market Narrative: ${sm.narrative}`);
      }

      // Sale comps (selected only) — summarized for market positioning
      const saleComps = compsAll.filter((c: AnyRecord) => c.comp_type === "sale" && c.selected !== false);
      if (saleComps.length > 0) {
        const compLines = saleComps.slice(0, 10).map((c: AnyRecord) => {
          const parts: string[] = [];
          if (c.name) parts.push(c.name);
          if (c.address) parts.push(c.address);
          if (c.sale_price != null) parts.push(`Sale: $${Number(c.sale_price).toLocaleString()}`);
          if (c.cap_rate != null) parts.push(`Cap: ${c.cap_rate}%`);
          if (c.price_per_unit != null) parts.push(`$${Math.round(Number(c.price_per_unit)).toLocaleString()}/unit`);
          if (c.price_per_sf != null) parts.push(`$${Number(c.price_per_sf).toFixed(0)}/SF`);
          if (c.sale_date) parts.push(new Date(c.sale_date).toLocaleDateString());
          return "  " + parts.join(" | ");
        });
        lines.push(`Sale Comparables (${saleComps.length}):\n${compLines.join("\n")}`);
      }

      // Location Intelligence data (demographics, housing, employment)
      if (locationIntel && locationIntel.length > 0) {
        // Use the best available radius (prefer 3mi, then smallest available)
        const sorted = [...locationIntel].sort((a, b) => {
          if (Number(a.radius_miles) === 3) return -1;
          if (Number(b.radius_miles) === 3) return 1;
          return Number(a.radius_miles) - Number(b.radius_miles);
        });
        const li = sorted[0];
        const data = typeof li.data === "string" ? JSON.parse(li.data) : (li.data || {});
        const proj = typeof li.projections === "string" ? JSON.parse(li.projections) : (li.projections || {});

        const demoLines: string[] = [];
        demoLines.push(`[${li.radius_miles}-Mile Radius Demographics — ${li.data_source === "census_acs" ? `Census ACS ${li.source_year || ""}` : "User-provided data"}]`);
        if (data.total_population != null) demoLines.push(`Population: ${Number(data.total_population).toLocaleString()}`);
        if (data.median_household_income != null) demoLines.push(`Median HH Income: $${Number(data.median_household_income).toLocaleString()}`);
        if (data.median_age != null) demoLines.push(`Median Age: ${data.median_age}`);
        if (data.bachelors_degree_pct != null) demoLines.push(`Bachelor's Degree+: ${data.bachelors_degree_pct}%`);
        if (data.median_home_value != null) demoLines.push(`Median Home Value: $${Number(data.median_home_value).toLocaleString()}`);
        if (data.median_gross_rent != null) demoLines.push(`Median Rent: $${Number(data.median_gross_rent).toLocaleString()}/mo`);
        if (data.owner_occupied_pct != null) demoLines.push(`Owner-Occupied: ${data.owner_occupied_pct}% | Renter: ${data.renter_occupied_pct ?? "—"}%`);
        if (data.unemployment_rate != null) demoLines.push(`Unemployment Rate: ${data.unemployment_rate}%`);
        if (data.labor_force != null) demoLines.push(`Labor Force: ${Number(data.labor_force).toLocaleString()}`);
        if (data.top_industries?.length) {
          demoLines.push(`Top Industries: ${data.top_industries.slice(0, 5).map((i: AnyRecord) => `${i.name} (${i.share_pct}%)`).join(", ")}`);
        }
        // Growth projections
        const projLines: string[] = [];
        if (proj.population_growth_5yr_pct != null) projLines.push(`Population Growth (5yr): ${proj.population_growth_5yr_pct}%`);
        if (proj.job_growth_5yr_pct != null) projLines.push(`Job Growth (5yr): ${proj.job_growth_5yr_pct}%`);
        if (proj.home_value_growth_5yr_pct != null) projLines.push(`Home Value Growth (5yr): ${proj.home_value_growth_5yr_pct}%`);
        if (proj.rent_growth_5yr_pct != null) projLines.push(`Rent Growth (5yr): ${proj.rent_growth_5yr_pct}%`);
        if (proj.new_units_pipeline != null) projLines.push(`New Units Pipeline: ${Number(proj.new_units_pipeline).toLocaleString()} units`);
        if (proj.notes) projLines.push(`Projection Notes: ${proj.notes}`);
        if (projLines.length) demoLines.push("Growth Projections:\n  " + projLines.join("\n  "));

        if (demoLines.length > 1) lines.push(demoLines.join("\n  "));
      }

      // Market-category documents
      const marketDocs = docs.filter((d: AnyRecord) => d.ai_summary && d.category === "market");
      for (const d of marketDocs) {
        lines.push(`Market Doc (${d.name}): ${d.ai_summary}`);
      }

      return lines.filter(Boolean).join("\n");
    }

    case "financial_summary": {
      if (!uw) return "No underwriting data available.";
      const capex = (uw.capex_items || []).reduce((s: number, c: AnyRecord) => s + n(c.quantity) * n(c.cost_per_unit), 0);
      const closingCosts = n(uw.purchase_price) * (n(uw.closing_costs_pct) / 100);
      const totalCost = n(uw.purchase_price) + closingCosts + capex;
      const units = n(deal.units);
      const sf = n(deal.square_footage) || n(uw.max_gsf);
      const perUnit = units > 0 ? Math.round(totalCost / units) : 0;
      const perSF = sf > 0 ? (totalCost / sf) : 0;
      const ppUnit = units > 0 ? Math.round(n(uw.purchase_price) / units) : 0;
      const ppSF = sf > 0 ? (n(uw.purchase_price) / sf) : 0;
      const loan = uw.has_financing ? n(uw.purchase_price) * (n(uw.acq_ltc) / 100) : 0;
      const equity = Math.max(0, totalCost - loan);
      return [
        `[BASIS]`,
        `Purchase Price: ${fc(n(uw.purchase_price))}${ppUnit ? ` | $${ppUnit.toLocaleString()}/unit` : ""}${ppSF ? ` | $${ppSF.toFixed(0)}/SF` : ""}`,
        `Closing Costs: ${n(uw.closing_costs_pct)}% (${fc(closingCosts)})`,
        `Total CapEx / Development: ${fc(capex)}`,
        `Total Capitalization: ${fc(totalCost)}${perUnit ? ` | $${perUnit.toLocaleString()}/unit` : ""}${perSF ? ` | $${perSF.toFixed(0)}/SF` : ""}`,
        ``,
        `[SOURCES & USES]`,
        uw.has_financing ? `Senior Debt: ${fc(loan)} @ ${uw.acq_ltc}% LTC / ${uw.acq_interest_rate}% / ${uw.acq_amort_years}yr amort${n(uw.acq_io_years) > 0 ? ` / ${uw.acq_io_years}yr I/O` : ""}` : "Senior Debt: NONE — all-cash basis",
        `Equity Check: ${fc(equity)}`,
        uw.has_refi ? `Refi Year ${uw.refi_year}: ${uw.refi_ltv}% LTV @ ${uw.refi_rate}% / ${uw.refi_amort_years}yr amort` : "",
        ``,
        `[OPERATING ASSUMPTIONS]`,
        `Vacancy: ${uw.vacancy_rate}% pro forma | ${uw.in_place_vacancy_rate}% in-place`,
        `Exit Cap: ${uw.exit_cap_rate}% | Hold: ${uw.hold_period_years} years`,
        ``,
        `[GUIDANCE FOR WRITER]`,
        `Open with the one-sentence trade: strategy, size, basis, stabilized yield on cost, levered IRR, equity multiple, hold. Then show the sources-and-uses and total cap in a clean list. Compare implied basis ($/unit or $/SF) to the selected sale comps and state the spread. Flag whether closing costs, CapEx reserve, and financing fees are adequately reserved.`,
      ].filter(l => l !== undefined && l !== null).join("\n");
    }

    case "unit_mix": {
      if (!unitGroups.length) return "No unit data available.";
      const lines = unitGroups.map((g: AnyRecord) => {
        if (isMF) return `${g.label}: ${g.unit_count} units, ${g.bedrooms}BD/${g.bathrooms}BA, ${g.sf_per_unit}SF, IP $${n(g.current_rent_per_unit)}/mo, Mkt $${n(g.market_rent_per_unit)}/mo`;
        return `${g.label}: ${g.unit_count} units, ${g.sf_per_unit}SF, IP $${n(g.current_rent_per_sf).toFixed(2)}/SF, Mkt $${n(g.market_rent_per_sf).toFixed(2)}/SF`;
      });
      return lines.join("\n");
    }

    case "rent_comps": {
      // Merge two sources:
      // 1. Legacy: rent_comps embedded in the underwriting JSONB (populated by
      //    the existing /api/deals/[id]/rent-comps AI generator).
      // 2. New: rows in the `comps` table with comp_type='rent' from the
      //    Comps & Market tab (paste-mode extraction).
      const legacyRentComps: AnyRecord[] = uw?.rent_comps || [];
      const selectedLegacyIds = new Set(
        uw?.selected_comp_ids || legacyRentComps.map((_: unknown, i: number) => i)
      );
      const legacySelected = legacyRentComps.filter((_: unknown, i: number) =>
        selectedLegacyIds.has(i)
      );
      const tableRentComps = compsAll.filter(
        (c: AnyRecord) => c.comp_type === "rent" && c.selected !== false
      );

      if (legacySelected.length === 0 && tableRentComps.length === 0) {
        return "No rent comp data available.";
      }

      const lines: string[] = [];

      if (legacySelected.length > 0) {
        const legacyLines = legacySelected.map((c: AnyRecord) => {
          const parts = [`${c.name} — ${c.address}`];
          if (c.distance_mi) parts.push(`${c.distance_mi}mi away`);
          if (c.year_built) parts.push(`Built ${c.year_built}`);
          if (c.units) parts.push(`${c.units} units`);
          if (c.total_sf) parts.push(`${Number(c.total_sf).toLocaleString()} SF`);
          if (c.occupancy_pct) parts.push(`${c.occupancy_pct}% occ`);
          if (c.rent_per_sf) parts.push(`$${Number(c.rent_per_sf).toFixed(2)}/SF`);
          if (c.lease_type) parts.push(c.lease_type);
          if (Array.isArray(c.unit_types)) {
            const rents = c.unit_types
              .map((ut: AnyRecord) => `${ut.type}: $${ut.rent}/mo (${ut.sf}SF)`)
              .join(", ");
            parts.push(`Rents: ${rents}`);
          }
          if (c.notes) parts.push(`Notes: ${c.notes}`);
          return "  " + parts.join(" | ");
        });
        lines.push(`Rent Comps (${legacySelected.length}):\n${legacyLines.join("\n")}`);
      }

      if (tableRentComps.length > 0) {
        const tableLines = tableRentComps.map((c: AnyRecord) => {
          const parts: string[] = [];
          if (c.name) parts.push(c.name);
          if (c.address) parts.push(c.address);
          if (c.distance_mi != null) parts.push(`${Number(c.distance_mi).toFixed(1)}mi`);
          if (c.year_built) parts.push(`Built ${c.year_built}`);
          if (c.units) parts.push(`${c.units} units`);
          if (c.total_sf) parts.push(`${Number(c.total_sf).toLocaleString()} SF`);
          if (c.occupancy_pct != null) parts.push(`${c.occupancy_pct}% occ`);
          if (c.rent_per_unit != null) parts.push(`$${Math.round(Number(c.rent_per_unit)).toLocaleString()}/unit/mo`);
          if (c.rent_per_sf != null) parts.push(`$${Number(c.rent_per_sf).toFixed(2)}/SF`);
          if (c.rent_per_bed != null) parts.push(`$${Math.round(Number(c.rent_per_bed)).toLocaleString()}/bed/mo`);
          if (c.lease_type) parts.push(c.lease_type);
          if (c.source_note) parts.push(`Notes: ${c.source_note}`);
          return "  " + parts.join(" | ");
        });
        lines.push(
          `Rent Comps from Comps & Market tab (${tableRentComps.length}):\n${tableLines.join("\n")}`
        );
      }

      return lines.join("\n\n");
    }

    case "value_add": {
      const capexItems = uw?.capex_items || [];
      const renos = unitGroups.filter((g: AnyRecord) => g.will_renovate);
      const totalCapex = capexItems.reduce((s: number, c: AnyRecord) => s + n(c.quantity) * n(c.cost_per_unit), 0);
      const units = n(deal.units);
      const isGroundUp = deal.investment_strategy === "ground_up";
      const capexPerUnit = units > 0 && totalCapex > 0 ? Math.round(totalCapex / units) : 0;
      const siteMassing = isGroundUp ? summarizeSiteAndMassing(uw) : "";
      return [
        bp ? `Business Plan: ${bp.name} — ${(bp.investment_theses || []).map((t: string) => THESIS_LABELS[t] || t).join(", ")}` : "",
        bp?.description ? `Strategy Narrative: ${bp.description}` : "",
        deal.investment_strategy ? `Deal-level Strategy: ${deal.investment_strategy}` : "",
        renos.length > 0 ? `Unit Renovation Scope: ${renos.length} unit types flagged for renovation — ${renos.map((r: AnyRecord) => r.label).join(", ")}` : "",
        capexItems.length > 0 ? `CapEx / Development Line Items (${capexItems.length}):\n${capexItems.map((c: AnyRecord) => `  - ${c.label}: ${n(c.quantity)} × ${fc(n(c.cost_per_unit))} = ${fc(n(c.quantity) * n(c.cost_per_unit))}`).join("\n")}` : "",
        totalCapex > 0 ? `Total CapEx / Development Budget: ${fc(totalCapex)}${capexPerUnit ? ` ($${capexPerUnit.toLocaleString()}/unit)` : ""}` : "",
        siteMassing ? `\n[GROUND-UP PROGRAM]\n${siteMassing}` : "",
        deal.context_notes ? `\nAnalyst Strategy Notes: ${deal.context_notes}` : "",
        ``,
        `[GUIDANCE FOR WRITER]`,
        isGroundUp
          ? `This is a ground-up development. Open with the program (buildable GSF, unit count, parking, use mix from the massing). Then lay out the critical-path milestones (entitlement, permit, GMP, construction start, TCO, stabilization) and the budget (hard $/GSF, soft as % of hard, contingency). Quantify the value-creation spread: development yield on cost vs. exit cap, implied untrended spread in bps, and the comp basis that prices the finished product.`
          : `Lay out the value-creation thesis in 3 steps: (1) what we're buying and what's broken / under-managed, (2) the specific interventions (capex, re-tenanting, re-branding, operational lift), and (3) the resulting NOI lift and yield-on-cost uplift. Quantify $/unit in CapEx, expected rent lift $/unit, implied ROC on CapEx, and timing to stabilization.`,
      ].filter(Boolean).join("\n");
    }

    case "operating_plan":
      if (!uw) return "";
      return [
        `Management Fee: ${uw.management_fee_pct}% of EGI`,
        `Taxes: ${fc(n(uw.taxes_annual))}/yr | Insurance: ${fc(n(uw.insurance_annual))}/yr`,
        `Repairs: ${fc(n(uw.repairs_annual))}/yr | Utilities: ${fc(n(uw.utilities_annual))}/yr`,
        n(uw.ga_annual) > 0 ? `G&A: ${fc(n(uw.ga_annual))}/yr` : "",
        n(uw.marketing_annual) > 0 ? `Marketing: ${fc(n(uw.marketing_annual))}/yr` : "",
      ].filter(Boolean).join("\n");

    case "capital_structure":
      if (!uw?.has_financing) return "All-cash acquisition — no debt assumed.";
      return [
        `LTC: ${uw.acq_ltc}% | Rate: ${uw.acq_interest_rate}% | Amort: ${uw.acq_amort_years}yr`,
        n(uw.acq_io_years) > 0 ? `I/O Period: ${uw.acq_io_years} years` : "",
        uw.has_refi ? `Refi in Year ${uw.refi_year}: ${uw.refi_ltv}% LTV, ${uw.refi_rate}% rate, ${uw.refi_amort_years}yr amort` : "",
      ].filter(Boolean).join("\n");

    case "returns_analysis": {
      if (!uw) return "";
      const targetIrr = bp?.target_irr_min || bp?.target_irr_max
        ? `Target IRR per business plan: ${bp?.target_irr_min ?? "?"}–${bp?.target_irr_max ?? "?"}%`
        : "";
      const targetEM = bp?.target_equity_multiple_min || bp?.target_equity_multiple_max
        ? `Target Equity Multiple per business plan: ${bp?.target_equity_multiple_min ?? "?"}x–${bp?.target_equity_multiple_max ?? "?"}x`
        : "";
      return [
        `[MODEL INPUTS DRIVING RETURNS]`,
        `Exit Cap: ${uw.exit_cap_rate}% | Hold: ${uw.hold_period_years} years`,
        uw.has_financing ? `Leverage: ${uw.acq_ltc}% LTC @ ${uw.acq_interest_rate}%${n(uw.acq_io_years) > 0 ? `, ${uw.acq_io_years}yr I/O` : ""}` : "Unlevered / all-cash",
        uw.vacancy_rate != null ? `Stabilized Vacancy: ${uw.vacancy_rate}%` : "",
        targetIrr,
        targetEM,
        deal.context_notes ? `Analyst Context: ${deal.context_notes}` : "",
        ``,
        `[GUIDANCE FOR WRITER]`,
        `Present returns in a BASE / DOWNSIDE / UPSIDE frame. Base = model output. Downside = 50 bps exit cap expansion AND rent growth 150 bps below plan. Upside = 50 bps cap compression AND rent growth 150 bps above plan. For each scenario list: levered IRR, equity multiple, stabilized yield-on-cost, and DSCR at stabilization. Identify the TWO variables the return is most sensitive to and quantify the break-even on each. If business-plan targets are set, state whether the base case hits the bottom, middle, or top of that band.`,
      ].filter(Boolean).join("\n");
    }

    case "exit_strategy": {
      if (!uw) return "";
      const saleComps = compsAll.filter((c: AnyRecord) => c.comp_type === "sale" && c.selected !== false);
      const avgCompCap = saleComps.length
        ? saleComps.filter(c => c.cap_rate != null).reduce((s: number, c: AnyRecord, _i, arr) => s + Number(c.cap_rate) / arr.length, 0)
        : 0;
      const avgCompPPU = saleComps.length
        ? saleComps.filter(c => c.price_per_unit != null).reduce((s: number, c: AnyRecord, _i, arr) => s + Number(c.price_per_unit) / arr.length, 0)
        : 0;
      return [
        `Underwritten Exit Cap Rate: ${uw.exit_cap_rate}% | Hold Period: ${uw.hold_period_years} years`,
        avgCompCap ? `Sale Comp Average Cap: ${avgCompCap.toFixed(2)}% (across ${saleComps.length} selected comps)` : "",
        avgCompPPU ? `Sale Comp Average $/Unit: $${Math.round(avgCompPPU).toLocaleString()}` : "",
        ``,
        `[GUIDANCE FOR WRITER]`,
        `Frame exit with: (1) underwritten exit cap vs. trailing-12 comp-set average (state the spread in bps — expansion or compression), (2) expected buyer profile (institutional core, value-add follow-on, private capital, 1031), (3) optionality — refi/recap at year N, partial sale, partnership buyout. Always include one "break-in-case-of-emergency" exit at a stressed cap. Never assume exit cap < going-in cap without explicit rate-environment justification.`,
      ].filter(Boolean).join("\n");
    }

    case "development_schedule": {
      if (devPhases.length === 0) {
        return "No development phases defined yet.";
      }
      const phaseLines = devPhases.map((p) => {
        const start = p.start_date ? new Date(p.start_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "TBD";
        const end = p.end_date ? new Date(p.end_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "TBD";
        return `- ${p.label}: ${start} → ${end} | ${p.pct_complete || 0}% complete | Status: ${p.status}${p.notes ? ` | ${p.notes}` : ""}`;
      });
      // Calculate total duration
      const allDates = devPhases.flatMap((p) => [p.start_date, p.end_date]).filter(Boolean).sort();
      const totalDuration = allDates.length >= 2
        ? `${Math.round((new Date(allDates[allDates.length - 1]).getTime() - new Date(allDates[0]).getTime()) / (1000 * 60 * 60 * 24 * 30))} months`
        : "TBD";
      return [
        `Total Project Duration: ${totalDuration}`,
        `Number of Phases: ${devPhases.length}`,
        `Phases Complete: ${devPhases.filter((p) => p.status === "complete").length}`,
        "",
        "PHASE DETAIL:",
        ...phaseLines,
      ].join("\n");
    }

    case "predev_budget": {
      if (preDevCosts.length === 0) {
        return "No pre-development costs tracked yet.";
      }
      // Group by category
      const byCategory: Record<string, AnyRecord[]> = {};
      for (const c of preDevCosts) {
        if (!byCategory[c.category]) byCategory[c.category] = [];
        byCategory[c.category].push(c);
      }
      const totalCommitted = preDevCosts
        .filter((c) => c.status === "committed" || c.status === "incurred" || c.status === "paid")
        .reduce((s, c) => s + n(c.amount), 0);
      const totalEstimated = preDevCosts.reduce((s, c) => s + n(c.amount), 0);
      const totalPaid = preDevCosts.filter((c) => c.status === "paid").reduce((s, c) => s + n(c.amount), 0);

      // Approval thresholds
      const settings = deal.predev_settings || { thresholds: [] };
      const thresholds: Array<{ amount: number; label: string }> = settings.thresholds || [];
      const sortedThresholds = [...thresholds].sort((a, b) => a.amount - b.amount);
      const passedThresholds = sortedThresholds.filter((t) => t.amount <= totalCommitted);
      const nextThreshold = sortedThresholds.find((t) => t.amount > totalCommitted);

      const categoryLines = Object.entries(byCategory).map(([cat, items]) => {
        const catTotal = items.reduce((s, c) => s + n(c.amount), 0);
        const itemsList = items.map((c) => `    - ${c.description}${c.vendor ? ` (${c.vendor})` : ""}: ${fc(n(c.amount))} [${c.status}]`).join("\n");
        return `  ${cat}: ${fc(catTotal)}\n${itemsList}`;
      });

      return [
        `Total Committed/Spent: ${fc(totalCommitted)}`,
        `Total Estimated: ${fc(totalEstimated)}`,
        `Total Paid: ${fc(totalPaid)}`,
        settings.total_budget ? `Pre-Dev Budget: ${fc(settings.total_budget)}` : "",
        "",
        "APPROVAL STATUS:",
        ...passedThresholds.map((t) => `  ✓ Passed: ${t.label} (${fc(t.amount)})`),
        nextThreshold ? `  → Next gate: ${nextThreshold.label} (${fc(nextThreshold.amount)}, ${fc(nextThreshold.amount - totalCommitted)} headroom remaining)` : "  ✓ All approval gates passed",
        "",
        "COSTS BY CATEGORY:",
        ...categoryLines,
      ].filter(Boolean).join("\n");
    }

    case "risk_factors": {
      const flags = om?.red_flags || [];
      const issues = checklist.filter((c: AnyRecord) => c.status === "issue");
      return [
        flags.length > 0 ? `OM Red Flags: ${flags.map((f: AnyRecord) => `[${f.severity}] ${f.description}`).join("; ")}` : "",
        issues.length > 0 ? `Checklist Issues: ${issues.map((i: AnyRecord) => `${i.item}${i.notes ? ` — ${i.notes}` : ""}`).join("; ")}` : "",
      ].filter(Boolean).join("\n");
    }

    case "photos":
      return photos.length > 0 ? `${photos.length} property photos available.` : "No photos uploaded yet.";

    case "appendix":
      return docs.map((d: AnyRecord) => `- ${d.name} (${d.category})${d.ai_summary ? `: ${d.ai_summary}` : ""}`).join("\n");

    default:
      return "";
  }
}
