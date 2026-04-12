import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, underwritingQueries, documentQueries, checklistQueries, omAnalysisQueries, businessPlanQueries, devPhaseQueries, preDevCostQueries, compQueries, submarketMetricsQueries, locationIntelligenceQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth, requireDealAccess } from "@/lib/auth";

const MODEL = "claude-sonnet-4-5";
let _client: Anthropic | null = null;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

const AUDIENCE_TONES: Record<string, string> = {
  lp_investor: "Your audience is Limited Partners / outside equity investors. Tone: formal, return-focused, highlight risk mitigants, institutional quality. Emphasize projected returns, downside protection, and sponsor track record.",
  investment_committee: "Your audience is an internal Investment Committee. Tone: analytical, balanced risk/return, assumption-driven, concise. Focus on deal thesis, key assumptions, and sensitivity analysis.",
  lender: "Your audience is a lender or debt partner. Tone: conservative, coverage-focused, emphasize collateral value, stable cash flows, and debt service coverage. Highlight property quality and market stability.",
  internal_review: "Your audience is internal team for deal screening. Tone: direct, efficient, flag concerns prominently, less polish needed. Focus on go/no-go factors.",
};

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  pitch_deck: "Format: Slide deck / pitch presentation. Keep content bullet-heavy, visual, concise. Each section should be 3-6 key bullet points with supporting detail. Suitable for PowerPoint slides.",
  investment_memo: "Format: Narrative investment memo. Write in full prose with detailed analysis. Each section should be 3-5 paragraphs. Suitable for Word/PDF document.",
  one_pager: "Format: One-page teaser / executive summary. Extremely concise — 2-3 sentences per topic. Focus on headline metrics and investment thesis only.",
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
    const [deal, uwRow, omAnalysis, docs, checklist, photosRes, devPhases, preDevCosts, compsAll, submarketMetrics, locationIntelRows] = await Promise.all([
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

    // Build master deal context
    const dealContext = buildDealContext(deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[], photos, businessPlan as AnyRecord | null);

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
  cover: "Cover Page", exec_summary: "Executive Summary", property_overview: "Property Overview",
  location_market: "Location & Market Analysis", financial_summary: "Financial Summary",
  unit_mix: "Unit Mix & Revenue", rent_comps: "Rent Comp Analysis", value_add: "Value-Add Strategy",
  operating_plan: "Operating Plan", capital_structure: "Capital Structure",
  returns_analysis: "Returns Analysis", exit_strategy: "Exit Strategy",
  risk_factors: "Risk Factors & Mitigants", photos: "Property Photos", appendix: "Appendix",
};

const THESIS_LABELS: Record<string, string> = {
  value_add: "Value-Add",
  ground_up: "Ground-Up Development",
  core: "Core",
  core_plus: "Core-Plus",
  opportunistic: "Opportunistic",
};

function buildDealContext(deal: AnyRecord, uw: AnyRecord | null, om: AnyRecord | null, docs: AnyRecord[], checklist: AnyRecord[], photos: AnyRecord[], bp: AnyRecord | null): string {
  const lines: string[] = [];
  lines.push(`Deal: ${deal.name}`);
  lines.push(`Address: ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}`);
  lines.push(`Type: ${deal.property_type} | Status: ${deal.status}`);
  lines.push(`Asking: ${deal.asking_price ? `$${Number(deal.asking_price).toLocaleString()}` : "TBD"} | Units: ${deal.units ?? "N/A"} | SF: ${deal.square_footage?.toLocaleString() ?? "N/A"} | Year Built: ${deal.year_built ?? "N/A"}`);

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

  if (uw?.purchase_price) lines.push(`Purchase Price: $${Number(uw.purchase_price).toLocaleString()}`);
  if (om?.summary) lines.push(`OM Summary: ${om.summary}`);
  if (deal.context_notes) lines.push(`Analyst Notes: ${deal.context_notes}`);
  lines.push(`Documents: ${docs.length} uploaded | Photos: ${photos.length} | Checklist: ${checklist.length} items`);

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
  const isMF = deal.property_type === "multifamily" || deal.property_type === "student_housing";
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

    case "property_overview":
      return [
        `Name: ${deal.name}`,
        `Address: ${[deal.address, deal.city, deal.state, deal.zip].filter(Boolean).join(", ")}`,
        `Type: ${deal.property_type} | Year Built: ${deal.year_built} | Units: ${deal.units} | SF: ${deal.square_footage?.toLocaleString()}`,
        om?.property_type ? `OM Property Type: ${om.property_type}` : "",
        ...docs.filter((d: AnyRecord) => d.ai_summary && (d.category === "om" || d.category === "marketing")).map((d: AnyRecord) => `Doc (${d.name}): ${d.ai_summary}`),
      ].filter(Boolean).join("\n");

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
      return [
        `Purchase Price: ${fc(n(uw.purchase_price))}`,
        `Closing Costs: ${n(uw.closing_costs_pct)}% (${fc(closingCosts)})`,
        `Total CapEx: ${fc(capex)}`,
        `Total Investment: ${fc(totalCost)}`,
        `Vacancy: ${uw.vacancy_rate}% (pro forma) | ${uw.in_place_vacancy_rate}% (in-place)`,
        `Exit Cap: ${uw.exit_cap_rate}% | Hold: ${uw.hold_period_years} years`,
        uw.has_financing ? `Financing: ${uw.acq_ltc}% LTC, ${uw.acq_interest_rate}% rate, ${uw.acq_amort_years}yr amort` : "All cash basis",
      ].join("\n");
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
      return [
        bp ? `Business Plan: ${bp.name} — ${(bp.investment_theses || []).map((t: string) => THESIS_LABELS[t] || t).join(", ")}` : "",
        bp?.description ? `Strategy: ${bp.description}` : "",
        renos.length > 0 ? `Renovating ${renos.length} unit types` : "",
        capexItems.length > 0 ? `CapEx items: ${capexItems.map((c: AnyRecord) => `${c.label}: ${n(c.quantity)} × ${fc(n(c.cost_per_unit))}`).join(", ")}` : "",
        deal.context_notes ? `Strategy notes: ${deal.context_notes}` : "",
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

    case "returns_analysis":
      return [
        uw ? `Exit Cap: ${uw.exit_cap_rate}% | Hold: ${uw.hold_period_years} years` : "",
        deal.context_notes ? `Context: ${deal.context_notes}` : "",
      ].filter(Boolean).join("\n");

    case "exit_strategy":
      return uw ? `Exit Cap Rate: ${uw.exit_cap_rate}% | Hold Period: ${uw.hold_period_years} years` : "";

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
