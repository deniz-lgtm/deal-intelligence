import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, underwritingQueries, omAnalysisQueries, dealNoteQueries } from "@/lib/db";

const MODEL = "claude-sonnet-4-5";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}

interface LoanSizeResult {
  acq_pp_ltv: number;
  acq_capex_ltv: number;
  acq_interest_rate: number;
  acq_amort_years: number;
  acq_io_years: number;
  acq_narrative: string;
  has_refi: boolean;
  refi_year: number;
  refi_ltv: number;
  refi_rate: number;
  refi_amort_years: number;
  refi_narrative: string;
  exit_cap_rate: number;
  hold_period_years: number;
}

const FALLBACK: LoanSizeResult = {
  acq_pp_ltv: 70,
  acq_capex_ltv: 100,
  acq_interest_rate: 7.0,
  acq_amort_years: 30,
  acq_io_years: 0,
  acq_narrative: "",
  has_refi: false,
  refi_year: 3,
  refi_ltv: 70,
  refi_rate: 6.5,
  refi_amort_years: 30,
  refi_narrative: "",
  exit_cap_rate: 7.0,
  hold_period_years: 5,
};

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deal = await dealQueries.getById(params.id);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const [analysis, uwRow, memoryText] = await Promise.all([
      omAnalysisQueries.getByDealId(params.id),
      underwritingQueries.getByDealId(params.id),
      dealNoteQueries.getMemoryText(params.id),
    ]);

    const uw = uwRow?.data
      ? typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data
      : null;

    const groups = uw?.unit_groups || [];
    const capexItems = uw?.capex_items || [];
    const totalUnits = groups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0);
    const totalSF = groups.reduce((s: number, g: any) => s + (g.sf_per_unit || 0) * (g.unit_count || 0), 0);
    const purchasePrice = uw?.purchase_price || deal.asking_price || 0;
    const capexTotal = capexItems.reduce((s: number, c: any) => s + (c.quantity || 0) * (c.cost_per_unit || 0), 0);
    const closingCosts = purchasePrice * ((uw?.closing_costs_pct || 2) / 100);
    const totalCost = purchasePrice + closingCosts + capexTotal;

    const dealInfo = [
      `Property Type: ${deal.property_type ?? "unknown"}`,
      deal.investment_strategy ? `Investment Strategy: ${deal.investment_strategy}` : null,
      totalUnits > 0 ? `Total Units: ${totalUnits}` : (deal.units ? `Total Units: ${deal.units}` : null),
      totalSF > 0 ? `Total SF: ${totalSF.toLocaleString()}` : (deal.square_footage ? `Total SF: ${deal.square_footage.toLocaleString()}` : null),
      deal.year_built ? `Year Built: ${deal.year_built}` : null,
      purchasePrice > 0 ? `Purchase Price: $${Math.round(purchasePrice).toLocaleString()}` : null,
      capexTotal > 0 ? `CapEx Budget: $${Math.round(capexTotal).toLocaleString()}` : null,
      closingCosts > 0 ? `Closing Costs: $${Math.round(closingCosts).toLocaleString()}` : null,
      totalCost > 0 ? `Total Cost Basis: $${Math.round(totalCost).toLocaleString()}` : null,
      [deal.city, deal.state].filter(Boolean).length
        ? `Location: ${[deal.city, deal.state].filter(Boolean).join(", ")}`
        : null,
    ].filter(Boolean).join("\n");

    const omContext = analysis ? [
      analysis.noi ? `OM NOI: $${Number(analysis.noi).toLocaleString()}` : null,
      analysis.cap_rate ? `OM Cap Rate: ${(Number(analysis.cap_rate) * 100).toFixed(2)}%` : null,
      analysis.vacancy_rate ? `OM Vacancy: ${(Number(analysis.vacancy_rate) * 100).toFixed(1)}%` : null,
    ].filter(Boolean).join("\n") : "";

    const notesContext = memoryText ? `ANALYST NOTES:\n${memoryText}` : "";

    const prompt = `You are an expert CRE debt broker. Size BOTH an acquisition loan and a refinance loan for this deal. Provide separate narratives for each.

${dealInfo}
${omContext ? `\n${omContext}` : ""}
${notesContext ? `\n${notesContext}` : ""}

CURRENT MARKET (2024-2025):
- 10yr Treasury: 4.0-4.5%. DSCR minimum 1.25x.
- Bridge/value-add: 7-9%, short-term, full IO, higher leverage on capex
- Agency permanent (stabilized MF): 5.5-6.5%, 30yr amort
- CMBS: 6.0-7.5%, 30yr amort
- Conventional: 6.0-8.0%, 25-30yr amort

IMPORTANT — SPLIT LEVERAGE:
Lenders typically finance purchase price and capex at DIFFERENT leverage levels:
- Purchase price: 65-75% LTV (lower for riskier assets)
- CapEx/renovation: 80-100% of budgeted costs (lenders often fund most/all of rehab)
This creates a blended loan-to-cost. Return the split percentages.

ACQUISITION LOAN: Short-term bridge/construction for value-add or opportunistic. Higher rate, IO period, 2-3 year term. For core/stabilized, use conventional permanent debt.

REFINANCE LOAN: Permanent takeout after stabilization. Lower rate, full amortization, 7-10 year term. Only if strategy involves repositioning.

Return ONLY a JSON object:
{
  "acq_pp_ltv": 70,
  "acq_capex_ltv": 100,
  "acq_interest_rate": 7.5,
  "acq_amort_years": 0,
  "acq_io_years": 3,
  "acq_narrative": "2-3 sentences about the acquisition loan: loan type (bridge/conventional), why this rate and leverage, term structure, DSCR implications. Reference specific market conditions.",
  "has_refi": true,
  "refi_year": 3,
  "refi_ltv": 72,
  "refi_rate": 6.0,
  "refi_amort_years": 30,
  "refi_narrative": "2-3 sentences about the refinance: permanent takeout type (agency/CMBS/conventional), why these terms, expected proceeds vs acquisition debt, how this fits the exit strategy.",
  "exit_cap_rate": 6.5,
  "hold_period_years": 5
}

Rules:
- acq_pp_ltv: % of purchase price + closing costs financed (65-75%)
- acq_capex_ltv: % of capex budget financed (80-100%, lenders often fund most rehab)
- acq_amort_years: 0 for IO-only bridge loans, 25-30 for conventional
- acq_io_years: IO period (0-3 years)
- acq_narrative: explain the acquisition debt strategy
- refi_narrative: explain the permanent debt takeout (or "N/A" if no refi)
- exit_cap_rate: as percentage (6.5 = 6.5%), typically going-in + 25-75 bps
- All rates as percentages (7.5 = 7.5%, not 0.075)`;

    const response = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }).messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const suggested = parseJson<LoanSizeResult>(raw, FALLBACK);

    // Compute blended LTC for reference
    const ppLoan = (purchasePrice + closingCosts) * ((suggested.acq_pp_ltv || 70) / 100);
    const capexLoan = capexTotal * ((suggested.acq_capex_ltv || 100) / 100);
    const blendedLtc = totalCost > 0 ? ((ppLoan + capexLoan) / totalCost * 100) : 0;

    return NextResponse.json({
      data: {
        ...suggested,
        blended_ltc: Math.round(blendedLtc * 10) / 10,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/loan-size error:", error);
    return NextResponse.json({ error: "Loan sizing failed" }, { status: 500 });
  }
}
