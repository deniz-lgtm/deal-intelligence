import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, underwritingQueries, omAnalysisQueries, dealNoteQueries } from "@/lib/db";

const MODEL = "claude-sonnet-4-5";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  acq_ltc: number;
  acq_interest_rate: number;
  acq_amort_years: number;
  acq_io_years: number;
  has_refi: boolean;
  refi_year: number;
  refi_ltv: number;
  refi_rate: number;
  refi_amort_years: number;
  exit_cap_rate: number;
  hold_period_years: number;
  basis: string;
}

const FALLBACK: LoanSizeResult = {
  acq_ltc: 65,
  acq_interest_rate: 7.0,
  acq_amort_years: 30,
  acq_io_years: 0,
  has_refi: false,
  refi_year: 3,
  refi_ltv: 70,
  refi_rate: 6.5,
  refi_amort_years: 30,
  exit_cap_rate: 7.0,
  hold_period_years: 5,
  basis: "Unable to estimate",
};

/**
 * POST /api/deals/:id/loan-size
 * AI-generated financing term suggestions based on the deal's property type,
 * investment strategy, underwriting metrics, and current market conditions.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deal = await dealQueries.getById(params.id);
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    // Gather context from multiple sources
    const [analysis, uwRow, memoryText] = await Promise.all([
      omAnalysisQueries.getByDealId(params.id),
      underwritingQueries.getByDealId(params.id),
      dealNoteQueries.getMemoryText(params.id),
    ]);

    // Parse UW data the same way other endpoints do
    const uw = uwRow?.data
      ? typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data
      : null;

    // Compute key metrics from UW or deal-level fields
    const groups = uw?.unit_groups || [];
    const totalUnits = groups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0);
    const totalSF = groups.reduce((s: number, g: any) => s + (g.sf_per_unit || 0) * (g.unit_count || 0), 0);
    const purchasePrice = uw?.purchase_price || deal.asking_price || 0;

    const isMF = ["multifamily", "student_housing"].includes(deal.property_type || "");
    const isValueAdd = (deal.investment_strategy || "").toLowerCase().includes("value");

    // Build deal info context
    const dealInfo = [
      `Property Type: ${deal.property_type ?? "unknown"}`,
      deal.investment_strategy ? `Investment Strategy: ${deal.investment_strategy}` : null,
      totalUnits > 0 ? `Total Units: ${totalUnits}` : (deal.units ? `Total Units: ${deal.units}` : null),
      totalSF > 0 ? `Total SF: ${totalSF.toLocaleString()}` : (deal.square_footage ? `Total SF: ${deal.square_footage.toLocaleString()}` : null),
      deal.year_built ? `Year Built: ${deal.year_built}` : null,
      purchasePrice > 0 ? `Purchase Price / Value: $${Math.round(purchasePrice).toLocaleString()}` : null,
      [deal.city, deal.state].filter(Boolean).length
        ? `Location: ${[deal.city, deal.state].filter(Boolean).join(", ")}`
        : null,
    ].filter(Boolean).join("\n");

    // OM analysis context
    const omContext = analysis ? [
      analysis.noi ? `OM NOI: $${Number(analysis.noi).toLocaleString()}` : null,
      analysis.cap_rate ? `OM Cap Rate: ${(Number(analysis.cap_rate) * 100).toFixed(2)}%` : null,
      analysis.expense_ratio ? `OM Expense Ratio: ${(Number(analysis.expense_ratio) * 100).toFixed(1)}%` : null,
      analysis.vacancy_rate ? `OM Vacancy: ${(Number(analysis.vacancy_rate) * 100).toFixed(1)}%` : null,
      analysis.exit_cap_rate ? `OM Exit Cap Rate: ${analysis.exit_cap_rate}%` : null,
    ].filter(Boolean).join("\n") : "";

    // Existing UW financing assumptions (if any)
    const existingFinancing = uw ? [
      uw.acq_ltc ? `Current UW LTC: ${uw.acq_ltc}%` : null,
      uw.acq_interest_rate ? `Current UW Rate: ${uw.acq_interest_rate}%` : null,
      uw.exit_cap_rate ? `Current UW Exit Cap: ${uw.exit_cap_rate}%` : null,
      uw.hold_period_years ? `Current UW Hold Period: ${uw.hold_period_years} years` : null,
    ].filter(Boolean).join("\n") : "";

    // Existing UW opex / NOI context
    const uwMetrics = uw ? [
      uw.vacancy_rate != null ? `UW Vacancy Rate: ${uw.vacancy_rate}%` : null,
      uw.taxes_annual ? `UW Taxes: $${Number(uw.taxes_annual).toLocaleString()}/yr` : null,
      uw.insurance_annual ? `UW Insurance: $${Number(uw.insurance_annual).toLocaleString()}/yr` : null,
    ].filter(Boolean).join("\n") : "";

    const notesContext = memoryText ? `ANALYST NOTES:\n${memoryText}` : "";

    // Compute a rough NOI if available
    let noiEstimate = "";
    if (analysis?.noi) {
      noiEstimate = `Estimated NOI: $${Number(analysis.noi).toLocaleString()}`;
    }

    const prompt = `You are an expert commercial real estate debt broker and underwriter. Based on the property details below, suggest realistic financing terms that a lender would actually offer in the current market.

${dealInfo}
${omContext ? `\n${omContext}` : ""}
${uwMetrics ? `\nUNDERWRITING METRICS:\n${uwMetrics}` : ""}
${existingFinancing ? `\nCURRENT UW ASSUMPTIONS (for reference):\n${existingFinancing}` : ""}
${noiEstimate ? `\n${noiEstimate}` : ""}
${notesContext ? `\n${notesContext}` : ""}

CURRENT MARKET CONDITIONS (2024-2025 lending environment):
- The Fed has begun cutting rates but the 10-year Treasury is still 4.0-4.5%
- Bank lending has tightened; DSCR requirements are strict (1.25x minimum, many lenders require 1.30x+)
- Multifamily rates: 5.5-7.5% depending on leverage, sponsor, and property quality
- Commercial (industrial/office/retail) rates: 6.0-8.5% depending on asset class risk
- Bridge/value-add loans: typically higher rate (7-9%), shorter term, more IO
- Agency (Fannie/Freddie) for stabilized MF: 5.5-6.5%, 30yr amort, limited IO
- CMBS: 6.0-7.5%, 30yr amort, some IO available
- Debt funds / bridge lenders: 7.0-9.5%, interest-only, 2-3 year terms
- LTC for acquisitions: 60-75% (lower leverage in current environment)
- Refi LTV: 65-75% for stabilized assets
- Exit cap rates: typically 25-75 bps above going-in cap rate

FINANCING STRATEGY GUIDELINES:
- Core / stabilized: conventional loan, 65-75% LTC, 25-30yr amort, 0-1yr IO, may not need refi
- Value-add: bridge loan for acquisition (60-75% LTC, 2-3yr IO), refi into permanent debt at year 2-3 after stabilization, 3-5yr hold
- Opportunistic: higher leverage bridge, full IO, refi after repositioning, 3-7yr hold
- Student housing: similar to multifamily but slightly higher rates, 60-70% LTC
- Industrial: favorable terms in current market, 65-75% LTC, competitive rates

DSCR CONSTRAINT: The acquisition loan must support a minimum 1.25x DSCR at the suggested LTC and rate. If the NOI is known, verify the math works. If DSCR would be tight, reduce LTC or note the constraint.

Suggest financing terms and return ONLY a JSON object:
{
  "acq_ltc": 65,
  "acq_interest_rate": 7.0,
  "acq_amort_years": 30,
  "acq_io_years": 2,
  "has_refi": true,
  "refi_year": 3,
  "refi_ltv": 72,
  "refi_rate": 6.25,
  "refi_amort_years": 30,
  "exit_cap_rate": 7.25,
  "hold_period_years": 5,
  "basis": "Brief 2-3 sentence explanation of why these terms were chosen, referencing the property type, strategy, market conditions, and any DSCR considerations."
}

Rules:
- acq_ltc: loan-to-cost as whole-number percentage (65 = 65%). Typically 60-75%.
- acq_interest_rate: annual rate as a number (7.0 = 7.0%). Use current market rates for this asset class.
- acq_amort_years: amortization period in years (25 or 30 typical). Use 0 for interest-only bridge loans.
- acq_io_years: interest-only period in years (0-3). Value-add deals often have 1-3 years IO.
- has_refi: true if the strategy involves refinancing (typical for value-add), false for core/hold.
- refi_year: year in which to refinance (typically 2-3 for value-add). Ignored if has_refi is false, but still provide a reasonable default.
- refi_ltv: refi loan-to-value as percentage (70-75% typical for stabilized). Ignored if has_refi is false.
- refi_rate: refi interest rate (typically 25-75 bps below bridge rate for perm takeout). Ignored if has_refi is false.
- refi_amort_years: refi amortization (typically 30). Ignored if has_refi is false.
- exit_cap_rate: as whole-number percentage (7.25 = 7.25%). Typically 25-75 bps above going-in cap.
- hold_period_years: total hold period (3-7 typical). Match to investment strategy.
- basis: explain the reasoning in 2-3 sentences. Reference DSCR if relevant.
- Do NOT return null values — provide a reasonable estimate for every field.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const suggested = parseJson<LoanSizeResult>(raw, FALLBACK);

    return NextResponse.json({ data: suggested });
  } catch (error) {
    console.error("POST /api/deals/[id]/loan-size error:", error);
    return NextResponse.json({ error: "Loan sizing failed" }, { status: 500 });
  }
}
