import { NextRequest, NextResponse } from "next/server";
import { dealQueries, dealNoteQueries, underwritingQueries, documentQueries, checklistQueries, omAnalysisQueries, businessPlanQueries } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

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
    const body: GenerateRequest = await req.json();
    const { audience, format, sections, existingNotes = {} } = body;

    // Fetch ALL deal data in parallel
    const [deal, uwRow, omAnalysis, docs, checklist, photosRes] = await Promise.all([
      dealQueries.getById(params.id),
      underwritingQueries.getByDealId(params.id),
      omAnalysisQueries.getByDealId(params.id),
      documentQueries.getByDealId(params.id),
      checklistQueries.getByDealId(params.id),
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/deals/${params.id}/photos`).then(r => r.json()).catch(() => ({ data: [] })),
    ]);

    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

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
      sectionContexts[sectionId] = buildSectionContext(sectionId, deal, uw, omAnalysis, docs as AnyRecord[], checklist as AnyRecord[], photos, n, fc, businessPlan as AnyRecord | null);
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
  n: (v: unknown) => number, fc: (v: number) => string, bp?: AnyRecord | null
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

    case "location_market":
      return [
        deal.context_notes ? `Market Intel: ${deal.context_notes}` : "",
        ...docs.filter((d: AnyRecord) => d.ai_summary && d.category === "market").map((d: AnyRecord) => `Market Doc: ${d.ai_summary}`),
      ].filter(Boolean).join("\n");

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
      const rentComps = uw?.rent_comps || [];
      if (!rentComps.length) return "No rent comp data available.";
      const selectedIds = new Set(uw?.selected_comp_ids || rentComps.map((_: unknown, i: number) => i));
      const selected = rentComps.filter((_: unknown, i: number) => selectedIds.has(i));
      const compLines = selected.map((c: AnyRecord) => {
        const parts = [`${c.name} — ${c.address}`];
        if (c.distance_mi) parts.push(`${c.distance_mi}mi away`);
        if (c.year_built) parts.push(`Built ${c.year_built}`);
        if (c.units) parts.push(`${c.units} units`);
        if (c.total_sf) parts.push(`${Number(c.total_sf).toLocaleString()} SF`);
        if (c.occupancy_pct) parts.push(`${c.occupancy_pct}% occ`);
        if (c.rent_per_sf) parts.push(`$${Number(c.rent_per_sf).toFixed(2)}/SF`);
        if (c.lease_type) parts.push(c.lease_type);
        if (Array.isArray(c.unit_types)) {
          const rents = c.unit_types.map((ut: AnyRecord) => `${ut.type}: $${ut.rent}/mo (${ut.sf}SF)`).join(", ");
          parts.push(`Rents: ${rents}`);
        }
        if (c.notes) parts.push(`Notes: ${c.notes}`);
        return parts.join(" | ");
      });
      return `${selected.length} Comparable Properties:\n${compLines.join("\n")}`;
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

    case "risk_factors": {
      const flags = om?.red_flags || [];
      const issues = checklist.filter((c: AnyRecord) => c.status === "issue");
      return [
        flags.length > 0 ? `OM Red Flags: ${flags.map((f: AnyRecord) => `[${f.severity}] ${f.flag}`).join("; ")}` : "",
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
