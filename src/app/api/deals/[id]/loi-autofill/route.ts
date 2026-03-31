import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  dealQueries,
  underwritingQueries,
  omAnalysisQueries,
  dealNoteQueries,
} from "@/lib/db";
import type { LOIData, UnderwritingData } from "@/lib/types";

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

/**
 * POST /api/deals/:id/loi-autofill
 *
 * Fetches the deal, underwriting data, OM analysis, and deal notes, then
 * auto-fills LOI fields from underwriting metrics and uses Claude to generate
 * appropriate additional terms.
 *
 * Returns a JSON object matching the LOIData interface.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const dealId = params.id;

    // ── Fetch all required data in parallel ──────────────────────────────────
    const [deal, uwRow, omAnalysis, notes] = await Promise.all([
      dealQueries.getById(dealId),
      underwritingQueries.getByDealId(dealId),
      omAnalysisQueries.getByDealId(dealId),
      dealNoteQueries.getByDealId(dealId),
    ]);

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // ── Parse underwriting data ──────────────────────────────────────────────
    let uw: Partial<UnderwritingData> = {};
    if (uwRow?.data) {
      try {
        uw = typeof uwRow.data === "string" ? JSON.parse(uwRow.data) : uwRow.data;
      } catch {
        /* ignore parse errors */
      }
    }

    // ── Determine purchase price ─────────────────────────────────────────────
    const purchasePrice =
      uw.purchase_price ??
      (omAnalysis?.asking_price ? Number(omAnalysis.asking_price) : null) ??
      deal.asking_price ??
      null;

    // ── Earnest money: 1% for deals >= $5M, 2% for smaller deals ────────────
    let earnestMoney: number | null = null;
    if (purchasePrice) {
      const pct = purchasePrice >= 5_000_000 ? 0.01 : 0.02;
      earnestMoney = Math.round(purchasePrice * pct);
    }

    // ── Due diligence days: base on property type / complexity ────────────────
    const complexTypes = ["office", "retail", "industrial"];
    const dueDiligenceDays = complexTypes.includes(deal.property_type) ? 45 : 30;

    // ── Financing contingency days ───────────────────────────────────────────
    const financingContingencyDays = uw.has_financing ? 30 : 21;

    // ── Closing days: larger / more complex deals get longer ─────────────────
    const closingDays =
      purchasePrice && purchasePrice >= 10_000_000
        ? 60
        : complexTypes.includes(deal.property_type)
        ? 45
        : 30;

    // ── Has financing contingency ────────────────────────────────────────────
    const hasFinancingContingency = uw.has_financing ?? true;

    // ── Build notes context for Claude ───────────────────────────────────────
    const notesText = Array.isArray(notes)
      ? notes
          .slice(0, 10)
          .map((n: { text: string; category: string }) => `[${n.category}] ${n.text}`)
          .join("\n")
      : "";

    // ── Use Claude to generate additional_terms ──────────────────────────────
    const prompt = `You are a commercial real estate acquisitions attorney drafting LOI terms.

DEAL CONTEXT:
- Property: ${deal.name}, ${deal.address}, ${deal.city}, ${deal.state} ${deal.zip}
- Property type: ${deal.property_type}
- Investment strategy: ${deal.investment_strategy ?? "not specified"}
- Purchase price: ${purchasePrice ? `$${purchasePrice.toLocaleString()}` : "TBD"}
- Units: ${deal.units ?? "unknown"}
- Square footage: ${deal.square_footage ?? "unknown"}
- Year built: ${deal.year_built ?? "unknown"}

${omAnalysis ? `OM ANALYSIS:
- NOI: ${omAnalysis.noi ? `$${Number(omAnalysis.noi).toLocaleString()}` : "unknown"}
- Cap rate: ${omAnalysis.cap_rate ? `${(Number(omAnalysis.cap_rate) * 100).toFixed(2)}%` : "unknown"}
- Vacancy: ${omAnalysis.vacancy_rate ? `${(Number(omAnalysis.vacancy_rate) * 100).toFixed(1)}%` : "unknown"}
` : ""}

${notesText ? `DEAL NOTES:\n${notesText}\n` : ""}

Generate 3-5 standard additional terms appropriate for this deal type, property type, and investment strategy. These should be practical, protective terms commonly included in LOIs for this type of CRE transaction.

Consider terms like (pick the most relevant, do not use all):
- Seller to provide trailing 12-month operating statements (T-12)
- Seller to provide current rent roll and all lease abstracts
- Seller to provide tenant estoppel certificates
- Buyer's right to freely assign the contract to an affiliated entity
- Buyer and its agents to have access to the property for inspections during due diligence
- Seller to continue normal operations and maintenance during due diligence
- Seller representations regarding environmental condition
- Seller to provide all service contracts and warranties
- No material changes to tenancy or operations without buyer consent during contract period
- Seller to provide all property tax records and appeals history

Return ONLY a JSON object in this format:
{
  "additional_terms": "1. First term here.\\n2. Second term here.\\n3. Third term here."
}

The terms should be numbered, separated by newlines. Be specific to the deal type. Respond with ONLY the JSON object.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "{}";
    const aiResult = parseJson<{ additional_terms: string }>(raw, {
      additional_terms: "",
    });

    // ── Build the LOIData response ───────────────────────────────────────────
    const loiData: LOIData = {
      // Parties (left blank for user to fill)
      buyer_entity: "",
      buyer_contact: "",
      buyer_address: "",
      seller_name: "",
      seller_address: "",
      // Financial terms
      purchase_price: purchasePrice,
      earnest_money: earnestMoney,
      earnest_money_hard_days: 30,
      // Timeline
      due_diligence_days: dueDiligenceDays,
      financing_contingency_days: financingContingencyDays,
      closing_days: closingDays,
      // Financing
      has_financing_contingency: hasFinancingContingency,
      lender_name: "",
      // Other
      as_is: true,
      broker_name: "",
      broker_commission: "",
      additional_terms: aiResult.additional_terms,
      loi_date: new Date().toISOString().split("T")[0],
    };

    return NextResponse.json({ data: loiData });
  } catch (error) {
    console.error("POST /api/deals/[id]/loi-autofill error:", error);
    return NextResponse.json(
      { error: "LOI autofill failed" },
      { status: 500 }
    );
  }
}
