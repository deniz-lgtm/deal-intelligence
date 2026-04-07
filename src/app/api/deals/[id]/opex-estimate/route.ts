import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, dealNoteQueries, omAnalysisQueries, underwritingQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { CONCISE_STYLE } from "@/lib/ai-style";

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

interface OpexEstimate {
  vacancy_rate: number;
  management_fee_pct: number;
  taxes_annual: number;
  insurance_annual: number;
  repairs_annual: number;
  utilities_annual: number;
  ga_annual: number;
  marketing_annual: number;
  reserves_annual: number;
  other_expenses_annual: number;
  basis: string;
}

const FALLBACK: OpexEstimate = {
  vacancy_rate: 5, management_fee_pct: 5,
  taxes_annual: 0, insurance_annual: 0, repairs_annual: 0,
  utilities_annual: 0, ga_annual: 0, marketing_annual: 0,
  reserves_annual: 0, other_expenses_annual: 0,
  basis: "Unable to estimate",
};

/**
 * POST /api/deals/:id/opex-estimate
 * AI-generated operating expense estimates based on property characteristics,
 * market data, and any available deal context.
 *
 * Uses property type, location, size, age, and comparable market data to
 * generate realistic per-category opex figures.
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

    // Gather context from multiple sources
    const [analysis, uwRow, memoryText] = await Promise.all([
      omAnalysisQueries.getByDealId(params.id),
      underwritingQueries.getByDealId(params.id),
      dealNoteQueries.getMemoryText(params.id),
    ]);

    // Parse UW data for current unit/SF counts
    const uw = uwRow?.data
      ? typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data
      : null;

    const groups = uw?.unit_groups || [];
    const totalUnits = groups.reduce((s: number, g: any) => s + (g.unit_count || 0), 0);
    const totalSF = groups.reduce((s: number, g: any) => s + (g.sf_per_unit || 0) * (g.unit_count || 0), 0);
    const purchasePrice = uw?.purchase_price || deal.asking_price || 0;

    const isMF = ["multifamily", "student_housing"].includes(deal.property_type || "");

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
      analysis.expense_ratio ? `OM Expense Ratio: ${(Number(analysis.expense_ratio) * 100).toFixed(1)}%` : null,
      analysis.vacancy_rate ? `OM Vacancy: ${(Number(analysis.vacancy_rate) * 100).toFixed(1)}%` : null,
    ].filter(Boolean).join("\n") : "";

    // Existing in-place opex from UW (if any)
    const existingOpex = uw ? [
      uw.ip_taxes_annual ? `Current Taxes: $${uw.ip_taxes_annual.toLocaleString()}` : null,
      uw.ip_insurance_annual ? `Current Insurance: $${uw.ip_insurance_annual.toLocaleString()}` : null,
      uw.ip_repairs_annual ? `Current R&M: $${uw.ip_repairs_annual.toLocaleString()}` : null,
      uw.ip_utilities_annual ? `Current Utilities: $${uw.ip_utilities_annual.toLocaleString()}` : null,
    ].filter(Boolean).join("\n") : "";

    const notesContext = memoryText ? `ANALYST NOTES:\n${memoryText}` : "";

    const prompt = `${CONCISE_STYLE}

You are an expert commercial real estate underwriter. Estimate pro forma operating expenses for this property using realistic 2024-2025 market data for the location and property type.

${dealInfo}
${omContext ? `\n${omContext}` : ""}
${existingOpex ? `\nCURRENT IN-PLACE EXPENSES (use as reference, pro forma may differ):\n${existingOpex}` : ""}
${notesContext ? `\n${notesContext}` : ""}

Generate ANNUAL pro forma operating expense estimates for each category. Use these guidelines:

${isMF ? `MULTIFAMILY / STUDENT HOUSING:
- Property Taxes: typically 1.0-2.5% of purchase price/assessed value, varies by state/county
- Insurance: typically $400-800/unit/year for standard, higher in coastal/flood zones
- Repairs & Maintenance: typically $500-1,200/unit/year depending on age/condition
- Utilities: $0 if tenants pay all, $800-2,000/unit/year if owner-paid (water/sewer/trash common)
- General & Admin: typically $200-500/unit/year (accounting, legal, admin)
- Marketing / Leasing: typically $100-400/unit/year
- Reserves: typically $250-500/unit/year for replacement reserves
- Other: misc items not covered above` : `COMMERCIAL (Industrial / Office / Retail):
- Property Taxes: typically 1.0-2.5% of purchase price/assessed value
- Insurance: typically $0.50-1.50/SF/year
- Repairs & Maintenance: typically $0.50-2.00/SF/year depending on age
- Utilities: $0 for NNN, $2-5/SF for gross lease
- General & Admin: typically $0.15-0.50/SF/year
- Marketing / Leasing: typically $0.10-0.30/SF/year, higher with vacancy
- Reserves: typically $0.15-0.40/SF/year
- Other: misc items`}

- Management Fee: as a percentage of EGI (typically 3-8%, higher for smaller properties)
- Vacancy Rate: market-appropriate stabilized vacancy (NOT current if in lease-up)

Return ONLY a JSON object:
{
  "vacancy_rate": 5,
  "management_fee_pct": 5,
  "taxes_annual": 85000,
  "insurance_annual": 18000,
  "repairs_annual": 24000,
  "utilities_annual": 12000,
  "ga_annual": 8000,
  "marketing_annual": 6000,
  "reserves_annual": 10000,
  "other_expenses_annual": 0,
  "basis": "Brief 1-2 sentence explanation of what drove the estimates (e.g. tax rate, market benchmarks, property age)"
}

Rules:
- All dollar values as annual amounts, plain integers (no $ or commas)
- vacancy_rate and management_fee_pct as whole-number percentages (5 = 5%)
- Base estimates on the specific location, property type, size, and age
- If in-place expenses are available, use them as a floor/reference but adjust for pro forma (stabilized) assumptions
- Do NOT return null values — estimate every category even if small`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const estimated = parseJson<OpexEstimate>(raw, FALLBACK);

    return NextResponse.json({ data: estimated });
  } catch (error) {
    console.error("POST /api/deals/[id]/opex-estimate error:", error);
    return NextResponse.json({ error: "OpEx estimation failed" }, { status: 500 });
  }
}
