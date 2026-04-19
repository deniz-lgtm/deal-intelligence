import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, underwritingQueries, documentQueries, checklistQueries, omAnalysisQueries, businessPlanQueries, devPhaseQueries, preDevCostQueries, compQueries, submarketMetricsQueries, locationIntelligenceQueries, marketReportsQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { summarizeAffordability } from "@/lib/affordability-summary";
import {
  buildUnderwritingSummary,
  buildOmSummary,
  buildMarketSummary,
} from "@/lib/deal-analytics-context";
import { fetchCapitalMarketsSnapshot } from "@/lib/capital-markets";
import { CONCISE_STYLE } from "@/lib/ai-style";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-6";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

const AUDIENCE_TONES: Record<string, string> = {
  lp_investor:
    "AUDIENCE: Institutional LPs (pensions, sovereigns, endowments, insurance, large family offices). They benchmark every deal against their entire portfolio.\n" +
    "VOICE: Formal, institutional, return-focused. Every return figure gets a matching downside in the same bullet. Risks get mitigants in the same bullet. No adjectives about the deal — only about the sponsor's realized track record.",
  investment_committee:
    "AUDIENCE: Internal IC at a top-tier manager (Blackstone / KKR / Starwood / Oaktree caliber). Readers have 15 minutes before a 45-minute discussion. They do not need education.\n" +
    "VOICE: Blunt, analytical, assumption-driven. Separate UNDERWRITTEN / VERIFIED / ASSUMED. Compare basis to comp-set spread in bps. Take a position — do not hedge. No marketing language.",
  lender:
    "AUDIENCE: Senior lender / debt capital markets (balance-sheet bank, debt fund, agency, life co). They underwrite collateral and sponsor, not equity return.\n" +
    "VOICE: Conservative, coverage-focused. Lead every bullet with LTV / LTC / DSCR / debt yield / recourse. Stress DSCR and debt yield against +100/+200 bps rate moves and −10% NOI.",
  internal_review:
    "AUDIENCE: Internal acquisitions team, pre-IC screen.\n" +
    "VOICE: Direct, engineer-style. Flag blockers first. State the bid, walk price, and re-trade triggers. If the deal is a pass, say so and list the three dispositive reasons.",
};

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  pitch_deck:
    "FORMAT: Board-ready slide.\n" +
    "- 3-6 bullets per section. Each bullet ≤ 15 words.\n" +
    "- Bullet 1 is the headline metric. Bullets 2+ are supporting evidence.\n" +
    "- Prefer numbers to adjectives. No run-on sentences. No filler.\n" +
    "- Markdown: `-` for bullets. `**bold**` only for the key metric inside a bullet. No `##` headers.",
  investment_memo:
    "FORMAT: Institutional investment memo.\n" +
    "- Each section: 1 bold takeaway sentence (≤ 20 words) + 4-8 bullets (≤ 20 words each).\n" +
    "- TABLES FIRST when the section context provides a markdown table (unit mix, sources & uses, comps). Paste the table verbatim; do NOT re-render its values in prose. Write analytical bullets AFTER the table.\n" +
    "- Every non-table bullet carries a specific number, source citation, or action. If it doesn't, delete it.\n" +
    "- NO multi-sentence paragraphs of prose. NO section recaps. NO transitional language between bullets.\n" +
    "- Cite sources inline in parentheses: (T-12), (CoStar Q3 '24), (broker OM), (internal UW). If the source is missing, tag the bullet UNVERIFIED.\n" +
    "- For returns/exit/risk sections, show base / downside / upside on one inline line each, not three paragraphs.",
  one_pager:
    "FORMAT: Single-page teaser.\n" +
    "- ≤ 350 words across ALL sections combined. Be ruthless.\n" +
    "- Each section: 1 headline sentence + up to 2 bullets. The bullets carry 3-4 numbers.\n" +
    "- Thesis, basis ($/unit or $/SF), going-in yield, stabilized yield, levered IRR, equity multiple, hold, equity check.\n" +
    "- No narrative. No adjectives. Numbers and thesis only.",
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

    // Guard: if the deal row is missing (deleted between the click and the
    // request) we want a clean error, not a crash on deal.context_notes.
    if (!deal) {
      return NextResponse.json(
        { error: "Deal not found — it may have been deleted" },
        { status: 404 }
      );
    }

    // Use deal notes for context instead of legacy context_notes
    deal.context_notes = await dealNoteQueries
      .getMemoryText(params.id)
      .catch(() => "") || null;

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
    // Wrapped defensively — a missing deal_notes row should never take the
    // whole generation down.
    const allDealNotes = await dealNoteQueries
      .getByDealId(params.id)
      .catch((err) => {
        console.warn("generate-all: dealNoteQueries.getByDealId failed:", err);
        return [] as Array<{ text: string; category: string }>;
      }) as Array<{ text: string; category: string }>;

    // Build the full computed UW / OM / market analytics blocks ONCE so
    // every section prompt sees the same NOI, cap rate, yield on cost,
    // DSCR, debt yield, loss-to-lease, OpEx build, comp-set averages, and
    // submarket demographics. Each helper is wrapped so a single bad field
    // (e.g. a corrupt numeric in the UW JSONB) can't 500 the whole route.
    const safe = <T>(fn: () => T, label: string, fallback: T): T => {
      try { return fn(); } catch (err) {
        console.error(`generate-all: ${label} threw —`, err);
        return fallback;
      }
    };
    const uwSummary = safe(() => buildUnderwritingSummary(uw, deal, allDealNotes), "buildUnderwritingSummary", "");
    const omSummary = safe(() => buildOmSummary(omAnalysis), "buildOmSummary", "");
    const capitalMarkets = await fetchCapitalMarketsSnapshot().catch((err) => {
      console.warn("generate-all: fetchCapitalMarketsSnapshot failed:", err);
      return null;
    });

    const marketSummary = safe(() => buildMarketSummary(
      submarketMetrics as AnyRecord | null,
      compsAll as AnyRecord[],
      locationIntelRows as AnyRecord[],
      marketReports as AnyRecord[],
      capitalMarkets
    ), "buildMarketSummary", "");

    // Build master deal context — now enriched with full UW + OM + market.
    const dealContext = safe(() => buildDealContext(
      deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[],
      photos, businessPlan as AnyRecord | null,
      uwSummary, omSummary, marketSummary
    ), "buildDealContext", "");

    // Build per-section context
    const sectionContexts: Record<string, string> = {};
    for (const sectionId of sections) {
      sectionContexts[sectionId] = safe(
        () => buildSectionContext(sectionId, deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[], photos, n, fc, businessPlan as AnyRecord | null, devPhases as AnyRecord[], preDevCosts as AnyRecord[], compsAll as AnyRecord[], submarketMetrics as AnyRecord | null, locationIntelRows as AnyRecord[]),
        `buildSectionContext(${sectionId})`,
        ""
      );
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

      const prompt = `${CONCISE_STYLE}

${audienceTone}

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
    // Surface the actual error text in the response so the UI toast shows
    // something actionable instead of an opaque "Generation failed".
    console.error("Generate-all error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Generation failed: ${message.slice(0, 300)}` },
      { status: 500 }
    );
  }
}

const SECTION_TITLES: Record<string, string> = {
  cover: "Cover Page",
  exec_summary: "Executive Summary & Investment Thesis",
  property_overview: "Property Overview",
  site_massing: "Site Plan, Massing & Buildable Program",
  location_market: "Market & Submarket Analysis",
  financial_summary: "Transaction Summary & Sources / Uses",
  // `affordability_strategy` was added on main while the feature branch
  // was being developed — keep it alongside the new IC-grade section set.
  unit_mix: "Unit Mix, Revenue & Loss-to-Lease",
  affordability_strategy: "Affordability & Incentives",
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

  // Affordability + incentive posture surfaced at the top-level context so
  // every section prompt sees it (exec summary, unit mix, risk, returns).
  const affSummary = summarizeAffordability({
    config: uw?.affordability_config as Parameters<
      typeof summarizeAffordability
    >[0]["config"],
    bonuses: Array.isArray(uw?.zoning_info?.density_bonuses)
      ? (uw!.zoning_info!.density_bonuses as Parameters<
          typeof summarizeAffordability
        >[0]["bonuses"])
      : [],
  });
  if (affSummary.enabled) {
    lines.push(`Affordability Posture: ${affSummary.headline}`);
  }

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

// Render a markdown table from a headers row + data rows. Pads cells with
// non-breaking alignment and writes the standard `| --- |` separator row so
// the shared markdownToDocx / markdownToPptxBlocks renderers recognize it.
// Deterministic — the memo model is told to paste this output verbatim.
function renderMarkdownTable(headers: string[], rows: string[][]): string {
  const cleanCell = (c: string) => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const headerLine = `| ${headers.map(cleanCell).join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((r) => `| ${r.map(cleanCell).join(" | ")} |`);
  return [headerLine, sepLine, ...rowLines].join("\n");
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

  // ── Shared: affordability + public-incentive summary ────────────────
  // Built once so every section that mentions rents, revenue, or risk
  // gets consistent affordability framing (instead of the LLM
  // hallucinating it from the raw config). Also exposed as its own
  // `affordability_strategy` section below.
  const affordabilitySummary = summarizeAffordability({
    config: uw?.affordability_config as Parameters<
      typeof summarizeAffordability
    >[0]["config"],
    bonuses: Array.isArray(uw?.zoning_info?.density_bonuses)
      ? (uw!.zoning_info!.density_bonuses as Parameters<
          typeof summarizeAffordability
        >[0]["bonuses"])
      : [],
    avgMarketRent: (() => {
      const marketRows = (unitGroups as AnyRecord[]).filter((g) => !g.is_affordable);
      const units = marketRows.reduce((s: number, g: AnyRecord) => s + n(g.unit_count), 0);
      if (units === 0) return undefined;
      const rev = marketRows.reduce((s: number, g: AnyRecord) => s + n(g.unit_count) * n(g.market_rent_per_unit), 0);
      return rev / units;
    })(),
  });
  const affSnippet = affordabilitySummary.enabled
    ? `Affordability & Incentives: ${affordabilitySummary.headline}\n${affordabilitySummary.bullets.map((b) => `  ${b}`).join("\n")}`
    : "";

  switch (sectionId) {
    case "exec_summary":
      return [
        bp ? `Investment Thesis: ${(bp.investment_theses || []).map((t: string) => THESIS_LABELS[t] || t).join(", ")}` : "",
        bp?.target_markets?.length ? `Target Markets: ${bp.target_markets.join(", ")}` : "",
        bp?.target_irr_min || bp?.target_irr_max ? `Target IRR: ${bp?.target_irr_min ?? "?"}–${bp?.target_irr_max ?? "?"}%` : "",
        om?.summary ? `OM Summary: ${om.summary}` : "",
        om?.score_reasoning ? `Score Reasoning: ${om.score_reasoning}` : "",
        deal.context_notes ? `Analyst Notes: ${deal.context_notes}` : "",
        affSnippet,
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
        "SHAPE: Bullets for GSF, NRSF, units, parking, lot coverage %, implied FAR. 1 bullet flagging density-bonus use. 1 bullet on parking ratio vs. submarket norm. If multiple massings, 1 bullet comparing base to alternative.",
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
      // Ground-up deals have Land + dev_budget_items. Acquisition deals have
      // Purchase Price + closing + capex. Both branches emit a single
      // Sources & Uses markdown table so the memo reads like the
      // Underwriting page's own sources/uses block.
      const isGroundUpFin = !!uw.development_mode;
      const devBudgetItems = Array.isArray(uw.dev_budget_items) ? uw.dev_budget_items : [];
      const devBudgetTotal = devBudgetItems.reduce((s: number, it: AnyRecord) => s + n(it.amount), 0);
      const hardTotal = devBudgetItems.filter((it: AnyRecord) => it.category === "hard").reduce((s: number, it: AnyRecord) => s + n(it.amount), 0);
      const softTotal = devBudgetItems.filter((it: AnyRecord) => it.category === "soft").reduce((s: number, it: AnyRecord) => s + n(it.amount), 0);
      const capex = (uw.capex_items || []).reduce((s: number, c: AnyRecord) => s + n(c.quantity) * n(c.cost_per_unit), 0);
      const closingCosts = n(uw.purchase_price) * (n(uw.closing_costs_pct) / 100);
      const landCost = n(uw.land_cost);
      const totalCost = isGroundUpFin
        ? landCost + devBudgetTotal
        : n(uw.purchase_price) + closingCosts + capex;
      const units = n(deal.units);
      const sf = n(deal.square_footage) || n(uw.max_gsf);
      const loanBasis = isGroundUpFin ? totalCost : n(uw.purchase_price);
      const loan = uw.has_financing ? loanBasis * (n(uw.acq_ltc) / 100) : 0;
      const equity = Math.max(0, totalCost - loan);

      // USES table — one row per major bucket with $, % of total, and
      // $/unit + $/SF (or $/GSF for ground-up).
      const usesRows: string[][] = [];
      const usesHeader = ["Use", "$", "% of Total", units > 0 ? "$/Unit" : "", sf > 0 ? (isGroundUpFin ? "$/GSF" : "$/SF") : ""].filter(Boolean);
      const pushUse = (label: string, amt: number) => {
        const pct = totalCost > 0 ? `${((amt / totalCost) * 100).toFixed(1)}%` : "—";
        const pu = units > 0 ? `$${Math.round(amt / units).toLocaleString()}` : "";
        const ps = sf > 0 ? `$${(amt / sf).toFixed(0)}` : "";
        usesRows.push([label, fc(amt), pct, pu, ps].filter((c, i) => i < usesHeader.length));
      };
      if (isGroundUpFin) {
        if (landCost > 0) pushUse("Land", landCost);
        if (hardTotal > 0) pushUse("Hard Costs", hardTotal);
        if (softTotal > 0) pushUse("Soft Costs", softTotal);
      } else {
        pushUse("Purchase Price", n(uw.purchase_price));
        if (closingCosts > 0) pushUse("Closing Costs", closingCosts);
        if (capex > 0) pushUse("CapEx", capex);
      }
      usesRows.push(
        [
          "**Total Uses**",
          `**${fc(totalCost)}**`,
          "**100%**",
          units > 0 ? `**$${Math.round(totalCost / units).toLocaleString()}**` : "",
          sf > 0 ? `**$${(totalCost / sf).toFixed(0)}**` : "",
        ].filter((c, i) => i < usesHeader.length)
      );
      const usesTable = renderMarkdownTable(usesHeader, usesRows);

      // SOURCES table — debt + equity split.
      const sourcesRows: string[][] = [];
      const sourcesHeader = ["Source", "$", "% of Total", "Terms"];
      if (uw.has_financing && loan > 0) {
        const terms = `${uw.acq_ltc}% LTC, ${uw.acq_interest_rate}% rate, ${uw.acq_amort_years}yr amort${n(uw.acq_io_years) > 0 ? `, ${uw.acq_io_years}yr I/O` : ""}`;
        sourcesRows.push(["Senior Debt", fc(loan), totalCost > 0 ? `${((loan / totalCost) * 100).toFixed(1)}%` : "—", terms]);
      }
      sourcesRows.push(["Equity", fc(equity), totalCost > 0 ? `${((equity / totalCost) * 100).toFixed(1)}%` : "—", uw.has_financing ? "Sponsor / LP" : "All-cash"]);
      sourcesRows.push(["**Total Sources**", `**${fc(totalCost)}**`, "**100%**", ""]);
      if (uw.has_refi) {
        sourcesRows.push([`Refi Year ${uw.refi_year}`, "—", "—", `${uw.refi_ltv}% LTV @ ${uw.refi_rate}%, ${uw.refi_amort_years}yr amort`]);
      }
      const sourcesTable = renderMarkdownTable(sourcesHeader, sourcesRows);

      // OPERATING ASSUMPTIONS table — vacancy / exit cap / hold.
      const opsHeader = ["Assumption", "Value"];
      const opsRows: string[][] = [];
      if (!isGroundUpFin) opsRows.push(["In-Place Vacancy", `${n(uw.in_place_vacancy_rate)}%`]);
      opsRows.push(["Pro Forma Vacancy", `${n(uw.vacancy_rate)}%`]);
      opsRows.push(["Exit Cap", `${n(uw.exit_cap_rate)}%`]);
      opsRows.push(["Hold Period", `${n(uw.hold_period_years)} years`]);
      const opsTable = renderMarkdownTable(opsHeader, opsRows);

      return [
        "### Uses",
        usesTable,
        "",
        "### Sources",
        sourcesTable,
        "",
        "### Operating Assumptions",
        opsTable,
        affSnippet,
        "",
        `SHAPE: 1 takeaway sentence (strategy, total cap, stabilized YoC, levered IRR, EM, hold). Paste all three tables above VERBATIM in the order shown. Then 2-3 analytical bullets: (1) basis $/unit or $/SF vs. sale-comp average (cite bps spread), (2) whether soft-cost % / closing costs / CapEx reserve look adequate, (3) DSCR or debt-yield cushion at current rates. No prose recap of the table numbers.`,
      ].filter(Boolean).join("\n");
    }

    case "unit_mix": {
      if (!unitGroups.length) return "No unit data available.";
      // Ground-up deals have no existing tenant base, so rendering an
      // "IP $0/mo" column reads as a data gap to the model. For ground-up
      // only show the stabilized (market) rent column.
      const isGroundUpUnits = !!uw?.development_mode;

      // Build a markdown table the memo renders verbatim. The model gets
      // told to PASTE this table unchanged and follow it with 2-3 analytical
      // bullets — no re-summarizing every row in prose. This mirrors how
      // the Underwriting and Programming pages present the mix.
      let table: string;
      if (isMF) {
        const totalUnits = unitGroups.reduce((s: number, g: AnyRecord) => s + n(g.unit_count), 0);
        const totalSF = unitGroups.reduce((s: number, g: AnyRecord) => s + n(g.unit_count) * n(g.sf_per_unit), 0);
        const avgMkt = totalUnits ? unitGroups.reduce((s: number, g: AnyRecord) => s + n(g.unit_count) * n(g.market_rent_per_unit), 0) / totalUnits : 0;
        const headers = isGroundUpUnits
          ? ["Unit Type", "Units", "Mix %", "BD/BA", "SF", "Stabilized Rent", "$/SF", "Notes"]
          : ["Unit Type", "Units", "Mix %", "BD/BA", "SF", "In-Place Rent", "Market Rent", "LTL"];
        const rows = unitGroups.map((g: AnyRecord) => {
          const units = n(g.unit_count);
          const mixPct = totalUnits ? `${((units / totalUnits) * 100).toFixed(1)}%` : "—";
          const sf = n(g.sf_per_unit);
          const aff = g.is_affordable ? `AFFORDABLE${g.ami_pct ? ` @ ${g.ami_pct}% AMI` : ""}` : "";
          if (isGroundUpUnits) {
            const mkt = n(g.market_rent_per_unit);
            const perSF = sf > 0 ? (mkt * 12 / sf).toFixed(2) : "—";
            return [g.label || "", units.toString(), mixPct, `${g.bedrooms ?? "—"}/${g.bathrooms ?? "—"}`, sf.toLocaleString(), `$${mkt.toLocaleString()}`, `$${perSF}`, aff];
          }
          const ip = n(g.current_rent_per_unit);
          const mkt = n(g.market_rent_per_unit);
          const ltl = mkt > 0 ? `${(((mkt - ip) / mkt) * 100).toFixed(1)}%` : "—";
          return [g.label || "", units.toString(), mixPct, `${g.bedrooms ?? "—"}/${g.bathrooms ?? "—"}`, sf.toLocaleString(), `$${ip.toLocaleString()}`, `$${mkt.toLocaleString()}`, ltl];
        });
        const totalRow = isGroundUpUnits
          ? ["**Total**", `**${totalUnits}**`, "100%", "—", `**${totalSF.toLocaleString()}**`, `**$${Math.round(avgMkt).toLocaleString()}** avg`, "—", ""]
          : ["**Total**", `**${totalUnits}**`, "100%", "—", `**${totalSF.toLocaleString()}**`, "—", `**$${Math.round(avgMkt).toLocaleString()}** avg`, "—"];
        table = renderMarkdownTable(headers, [...rows, totalRow]);
      } else {
        // Commercial / by-SF deals
        const totalUnits = unitGroups.reduce((s: number, g: AnyRecord) => s + n(g.unit_count), 0);
        const totalSF = unitGroups.reduce((s: number, g: AnyRecord) => s + n(g.unit_count) * n(g.sf_per_unit), 0);
        const headers = isGroundUpUnits
          ? ["Type", "Count", "SF", "Stabilized $/SF"]
          : ["Type", "Count", "SF", "In-Place $/SF", "Market $/SF"];
        const rows = unitGroups.map((g: AnyRecord) => {
          const units = n(g.unit_count);
          const sf = n(g.sf_per_unit);
          if (isGroundUpUnits) {
            return [g.label || "", units.toString(), sf.toLocaleString(), `$${n(g.market_rent_per_sf).toFixed(2)}`];
          }
          return [g.label || "", units.toString(), sf.toLocaleString(), `$${n(g.current_rent_per_sf).toFixed(2)}`, `$${n(g.market_rent_per_sf).toFixed(2)}`];
        });
        const totalRow = isGroundUpUnits
          ? ["**Total**", `**${totalUnits}**`, `**${totalSF.toLocaleString()}**`, "—"]
          : ["**Total**", `**${totalUnits}**`, `**${totalSF.toLocaleString()}**`, "—", "—"];
        table = renderMarkdownTable(headers, [...rows, totalRow]);
      }

      return [
        table,
        "",
        `SHAPE: Paste the unit-mix table above VERBATIM (do not re-render values in prose). Then write 2-3 bullets commenting on what the mix implies: biggest cohort by count or NOI, loss-to-lease spread if acquisition, comp fit if ground-up. No per-row narration.`,
        affSnippet,
      ].filter(Boolean).join("\n");
    }

    case "affordability_strategy": {
      if (!affordabilitySummary.enabled) {
        return "No affordability tiers, tax exemptions, or density-bonus programs configured. Project is underwritten as 100% market-rate.";
      }
      // Hand the LLM the programmatic narrative + supporting data. The
      // prompt asks the model to polish for the target audience; we
      // still feed the raw bullets so it stays quantitatively anchored.
      return [
        `Headline: ${affordabilitySummary.headline}`,
        "",
        "Key data points:",
        ...affordabilitySummary.bullets.map((b) => `  ${b}`),
        "",
        "Draft narrative (polish for audience/format):",
        affordabilitySummary.narrative,
      ].join("\n");
    }

    case "rent_comps": {
      // Two sources merged into one rent-comp table:
      //   1. Legacy uw.rent_comps (AI-generated, selected via selected_comp_ids).
      //   2. Comps table rows with comp_type="rent" and selected !== false.
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
      const allRent = [
        ...legacySelected.map((c: AnyRecord) => ({ ...c, _src: "uw" })),
        ...tableRentComps.map((c: AnyRecord) => ({ ...c, _src: "market" })),
      ];
      const saleComps = compsAll.filter(
        (c: AnyRecord) => c.comp_type === "sale" && c.selected !== false
      );

      if (allRent.length === 0 && saleComps.length === 0) {
        return "No rent or sale comp data available.";
      }

      const blocks: string[] = [];

      if (allRent.length > 0) {
        const headers = ["Property", "Dist", "Yr", "Units", "Occ %", "$/Unit", "$/SF", "Notes"];
        const rows = allRent.map((c: AnyRecord) => {
          const dist = c.distance_mi != null ? `${Number(c.distance_mi).toFixed(1)} mi` : "—";
          const year = c.year_built || "—";
          const units = c.units ? String(c.units) : "—";
          const occ = c.occupancy_pct != null ? `${c.occupancy_pct}%` : "—";
          const ppu = c.rent_per_unit != null ? `$${Math.round(Number(c.rent_per_unit)).toLocaleString()}` : "—";
          const ppsf = c.rent_per_sf != null ? `$${Number(c.rent_per_sf).toFixed(2)}` : "—";
          const notes = c.source_note || c.notes || "";
          const name = [c.name, c.address].filter(Boolean).join(", ") || "—";
          return [name, dist, String(year), units, occ, ppu, ppsf, notes];
        });
        // Averages row
        const rpu = allRent.map((c: AnyRecord) => Number(c.rent_per_unit)).filter((v) => !isNaN(v) && v > 0);
        const rpsf = allRent.map((c: AnyRecord) => Number(c.rent_per_sf)).filter((v) => !isNaN(v) && v > 0);
        const occs = allRent.map((c: AnyRecord) => Number(c.occupancy_pct)).filter((v) => !isNaN(v) && v > 0);
        const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
        const avgPPU = avg(rpu);
        const avgPSF = avg(rpsf);
        const avgOcc = avg(occs);
        rows.push([
          "**Average**",
          "—",
          "—",
          "—",
          avgOcc ? `**${avgOcc.toFixed(1)}%**` : "—",
          avgPPU ? `**$${Math.round(avgPPU).toLocaleString()}**` : "—",
          avgPSF ? `**$${avgPSF.toFixed(2)}**` : "—",
          "",
        ]);
        blocks.push(`### Rent Comps (${allRent.length})`);
        blocks.push(renderMarkdownTable(headers, rows));
      }

      if (saleComps.length > 0) {
        const headers = ["Property", "Dist", "Sale $", "Cap", "$/Unit", "$/SF", "Date"];
        const rows = saleComps.slice(0, 15).map((c: AnyRecord) => {
          const dist = c.distance_mi != null ? `${Number(c.distance_mi).toFixed(1)} mi` : "—";
          const sale = c.sale_price != null ? fc(Number(c.sale_price)) : "—";
          const cap = c.cap_rate != null ? `${Number(c.cap_rate).toFixed(2)}%` : "—";
          const ppu = c.price_per_unit != null ? `$${Math.round(Number(c.price_per_unit)).toLocaleString()}` : "—";
          const psf = c.price_per_sf != null ? `$${Number(c.price_per_sf).toFixed(0)}` : "—";
          const date = c.sale_date ? new Date(c.sale_date).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—";
          const name = [c.name, c.address].filter(Boolean).join(", ") || "—";
          return [name, dist, sale, cap, ppu, psf, date];
        });
        const caps = saleComps.map((c: AnyRecord) => Number(c.cap_rate)).filter((v) => !isNaN(v) && v > 0);
        const pus = saleComps.map((c: AnyRecord) => Number(c.price_per_unit)).filter((v) => !isNaN(v) && v > 0);
        const psfs = saleComps.map((c: AnyRecord) => Number(c.price_per_sf)).filter((v) => !isNaN(v) && v > 0);
        const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
        rows.push([
          "**Average**",
          "—",
          "—",
          caps.length ? `**${avg(caps).toFixed(2)}%**` : "—",
          pus.length ? `**$${Math.round(avg(pus)).toLocaleString()}**` : "—",
          psfs.length ? `**$${avg(psfs).toFixed(0)}**` : "—",
          "—",
        ]);
        blocks.push("");
        blocks.push(`### Sale Comps (${saleComps.length})`);
        blocks.push(renderMarkdownTable(headers, rows));
      }

      blocks.push("");
      blocks.push(
        `SHAPE: Paste the comp tables above VERBATIM. Then 2-3 bullets: (1) where subject rent sits vs. comp average and in what direction, (2) which 1-2 comps most resemble the subject (call out by name), (3) any vintage / occupancy / class outliers that qualify the average.`
      );
      return blocks.join("\n");
    }

    case "value_add": {
      // Ground-up vs. acquisition split. Ground-up reads dev_budget_items
      // (hard + soft categories) and shows the programmed site + massing.
      // Acquisition reads capex_items and renovation scope.
      const isGroundUp = deal.investment_strategy === "ground_up" || !!uw?.development_mode;
      const capexItems: AnyRecord[] = uw?.capex_items || [];
      const devBudgetItems: AnyRecord[] = Array.isArray(uw?.dev_budget_items) ? uw!.dev_budget_items : [];
      const devBudgetTotal = devBudgetItems.reduce((s: number, it: AnyRecord) => s + n(it.amount), 0);
      const hardTotal = devBudgetItems.filter((it: AnyRecord) => it.category === "hard").reduce((s: number, it: AnyRecord) => s + n(it.amount), 0);
      const softTotal = devBudgetItems.filter((it: AnyRecord) => it.category === "soft").reduce((s: number, it: AnyRecord) => s + n(it.amount), 0);
      const renos = unitGroups.filter((g: AnyRecord) => g.will_renovate);
      const totalCapex = capexItems.reduce((s: number, c: AnyRecord) => s + n(c.quantity) * n(c.cost_per_unit), 0);
      const units = n(deal.units);
      const sf = n(deal.square_footage) || n(uw?.max_gsf);
      const capexPerUnit = units > 0 && totalCapex > 0 ? Math.round(totalCapex / units) : 0;
      const siteMassing = isGroundUp ? summarizeSiteAndMassing(uw) : "";

      const budgetBlock = isGroundUp
        ? (devBudgetItems.length > 0
            ? `Development Budget (${devBudgetItems.length} line items, ${fc(devBudgetTotal)} total):\n  Hard Costs: ${fc(hardTotal)}${sf > 0 ? ` ($${(hardTotal / sf).toFixed(0)}/GSF)` : ""}\n  Soft Costs: ${fc(softTotal)}${hardTotal > 0 ? ` (${((softTotal / hardTotal) * 100).toFixed(1)}% of hard)` : ""}\n${devBudgetItems.slice(0, 12).map((it: AnyRecord) => `  - ${it.label || it.subcategory || "Item"} [${it.category}]: ${fc(n(it.amount))}`).join("\n")}`
            : "Development budget not yet populated.")
        : (capexItems.length > 0
            ? `CapEx Line Items (${capexItems.length}):\n${capexItems.map((c: AnyRecord) => `  - ${c.label}: ${n(c.quantity)} x ${fc(n(c.cost_per_unit))} = ${fc(n(c.quantity) * n(c.cost_per_unit))}`).join("\n")}\nTotal CapEx: ${fc(totalCapex)}${capexPerUnit ? ` ($${capexPerUnit.toLocaleString()}/unit)` : ""}`
            : "CapEx scope not yet populated.");

      return [
        bp ? `Business Plan: ${bp.name}. ${(bp.investment_theses || []).map((t: string) => THESIS_LABELS[t] || t).join(", ")}` : "",
        bp?.description ? `Strategy Narrative: ${bp.description}` : "",
        deal.investment_strategy ? `Deal-level Strategy: ${deal.investment_strategy}` : "",
        !isGroundUp && renos.length > 0 ? `Unit Renovation Scope: ${renos.length} unit types flagged. ${renos.map((r: AnyRecord) => r.label).join(", ")}` : "",
        budgetBlock,
        siteMassing ? `\n[GROUND-UP PROGRAM]\n${siteMassing}` : "",
        deal.context_notes ? `\nAnalyst Strategy Notes: ${deal.context_notes}` : "",
        ``,
        isGroundUp
          ? `SHAPE: Program bullets (buildable GSF, units, parking, use mix). Then critical-path milestone bullets (entitlement, permit, GMP, start, TCO, stabilization). Then budget bullets (hard $/GSF, soft % of hard, contingency). Then 1 bullet quantifying dev yield-on-cost vs. exit cap in bps.`
          : `SHAPE: 3 thesis bullets (what's broken + specific interventions + resulting NOI lift). Then bullets for CapEx $/unit, expected rent lift $/unit, implied ROC on CapEx, timing to stabilization.`,
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
        `SHAPE: 3 one-line scenarios on consecutive bullets (labels inline, not paragraphs):\n- Base: <IRR / EM / YoC / DSCR> at model assumptions\n- Downside: +50bps exit cap, rent growth -150bps — <new IRR / EM>\n- Upside: -50bps exit cap, rent growth +150bps — <new IRR / EM>\nThen 2 bullets: the two variables returns are most sensitive to, with break-even on each. Then 1 bullet on whether base case hits bottom/middle/top of the business-plan band.`,
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
        `SHAPE:\n- Bullet: exit cap vs. trailing-12 comp-set average, spread in bps (expansion or compression).\n- Bullet: expected buyer profile (core / value-add follow-on / private capital / 1031).\n- Bullet: optionality — refi/recap at year N, partial sale, partnership buyout.\n- Bullet: break-glass stressed exit at +100bps cap.\nNever assume exit cap < going-in without naming the rate-environment catalyst.`,
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
        // Affordability commitments are a risk-factor input: covenant
        // periods, AMI rent caps, and program-specific labor / filing
        // requirements all shape the downside case.
        affSnippet,
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
