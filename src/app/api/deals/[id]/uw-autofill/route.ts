import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { dealQueries, omAnalysisQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

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

interface CommercialUnitGroupResult {
  label: string;
  unit_count: number;
  sf_per_unit: number;
  current_rent_per_sf: number;
  market_rent_per_sf: number;
  lease_type: "NNN" | "MG" | "Gross" | "Modified Gross";
  expense_reimbursement_per_sf: number;
}

interface MFUnitGroupResult {
  label: string;
  unit_count: number;
  beds_per_unit: number;
  current_rent_per_bed: number;  // monthly $/bed
  market_rent_per_bed: number;   // monthly $/bed
}

type UnitGroupResult = CommercialUnitGroupResult | MFUnitGroupResult;

interface AutofillResult {
  purchase_price: number | null;
  unit_groups: UnitGroupResult[];
  vacancy_rate: number | null;
  taxes_annual: number | null;
  insurance_annual: number | null;
  repairs_annual: number | null;
  utilities_annual: number | null;
  other_expenses_annual: number | null;
  exit_cap_rate: number | null;
}

interface DocRow {
  original_name: string;
  content_text: string;
  ai_tags: string[] | null;
}

/**
 * POST /api/deals/:id/uw-autofill
 * Extract rent roll and operating data from the deal's uploaded documents
 * (OM + any dedicated rent roll files) and return it in the underwriting
 * model format.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    // Optional: caller can restrict which documents to use
    let docIds: string[] | null = null;
    try {
      const body = await req.json();
      if (Array.isArray(body?.doc_ids) && body.doc_ids.length > 0) {
        docIds = body.doc_ids as string[];
      }
    } catch { /* body may be empty */ }

    const deal = await dealQueries.getById(params.id);
    const isMF = deal.property_type === "multifamily" || deal.property_type === "student_housing";

    // ── Gather all documents that might contain rent roll / financial data ────
    // Priority order: dedicated rent roll > OM > other financial docs
    const pool = getPool();
    const docRes = await pool.query<DocRow>(
      `SELECT original_name, content_text, ai_tags
       FROM documents
       WHERE deal_id = $1
         AND content_text IS NOT NULL
         AND content_text != ''
         ${docIds ? `AND id = ANY($2::text[])` : ""}
       ORDER BY
         -- rent roll documents first
         CASE WHEN lower(original_name) LIKE '%rent%roll%' THEN 0
              WHEN lower(original_name) LIKE '%rent roll%' THEN 0
              WHEN lower(original_name) LIKE '%rentroll%' THEN 0
              WHEN ai_tags::text LIKE '%rent%' THEN 1
              WHEN ai_tags::text LIKE '%offering-memorandum%' THEN 2
              ELSE 3
         END,
         uploaded_at DESC`,
      docIds ? [params.id, docIds] : [params.id]
    );

    const analysis = await omAnalysisQueries.getByDealId(params.id);

    if (docRes.rows.length === 0 && !analysis) {
      return NextResponse.json(
        {
          error:
            "No documents found. Upload an OM or rent roll on the Documents or OM Analysis tab first.",
        },
        { status: 404 }
      );
    }

    // ── Build combined document text, labelled by source ─────────────────────
    // Budget ~14 000 chars total; give rent roll docs more room
    const MAX_TOTAL = 16000;
    const sections: string[] = [];
    let remaining = MAX_TOTAL;

    for (const row of docRes.rows) {
      if (remaining <= 0) break;
      const isRentRoll = /rent.?roll/i.test(row.original_name);
      const isOm =
        Array.isArray(row.ai_tags) && row.ai_tags.includes("offering-memorandum");
      const label = isRentRoll
        ? "RENT ROLL DOCUMENT"
        : isOm
        ? "OFFERING MEMORANDUM"
        : "FINANCIAL DOCUMENT";

      const allotment = isRentRoll ? Math.min(remaining, 8000) : Math.min(remaining, 5000);
      const snippet = row.content_text.slice(0, allotment);
      sections.push(`--- ${label}: ${row.original_name} ---\n${snippet}`);
      remaining -= snippet.length;
    }

    const combinedText = sections.join("\n\n");
    const sourceNames = docRes.rows.map((r) => r.original_name);

    // ── Build context from structured analysis if available ───────────────────
    const analysisContext = analysis
      ? `
KNOWN EXTRACTED METRICS (from prior OM analysis):
- Asking price: ${analysis.asking_price ? `$${Number(analysis.asking_price).toLocaleString()}` : "unknown"}
- NOI: ${analysis.noi ? `$${Number(analysis.noi).toLocaleString()}` : "unknown"}
- Cap rate: ${analysis.cap_rate ? `${(Number(analysis.cap_rate) * 100).toFixed(2)}%` : "unknown"}
- Vacancy rate: ${analysis.vacancy_rate ? `${(Number(analysis.vacancy_rate) * 100).toFixed(1)}%` : "unknown"}
- Expense ratio: ${analysis.expense_ratio ? `${(Number(analysis.expense_ratio) * 100).toFixed(1)}%` : "unknown"}
- Property type: ${analysis.property_type ?? "unknown"}
- SF: ${analysis.sf ?? "unknown"}
- Unit count: ${analysis.unit_count ?? "unknown"}
- Exit cap rate assumption: ${analysis.exit_cap_rate ?? "unknown"}
`
      : "";

    const isSH = deal.property_type === "student_housing";

    const unitGroupFormat = isSH
      ? `    {
      "label": "4BR/2BA",
      "unit_count": 10,
      "beds_per_unit": 4,
      "current_rent_per_bed": 800,
      "market_rent_per_bed": 900
    }`
      : isMF
      ? `    {
      "label": "1BR/1BA",
      "unit_count": 10,
      "current_rent_per_unit": 1200,
      "market_rent_per_unit": 1350
    }`
      : `    {
      "label": "Flex Bay — Suite 101",
      "unit_count": 1,
      "sf_per_unit": 5000,
      "current_rent_per_sf": 18.50,
      "market_rent_per_sf": 22.00,
      "lease_type": "NNN",
      "expense_reimbursement_per_sf": 0
    }`;

    const unitGroupRules = isSH
      ? `- unit_groups: one entry per distinct bedroom/unit type (e.g. "2BR/1BA", "4BR/2BA").
- beds_per_unit: number of beds in this unit type.
- current_rent_per_bed: current contracted monthly rent PER BED. If only rent per unit is given, divide by beds_per_unit.
- market_rent_per_bed: market-rate monthly rent per bed. If not stated, set equal to current_rent_per_bed.`
      : isMF
      ? `- unit_groups: one entry per distinct unit type (e.g. "Studio", "1BR/1BA", "2BR/2BA", "3BR/2BA").
- current_rent_per_unit: current contracted monthly rent PER UNIT. Convert annual → monthly ÷12 if needed.
- market_rent_per_unit: market-rate monthly rent per unit. If not stated, set equal to current_rent_per_unit.`
      : `- unit_groups: one entry per distinct tenant, suite, unit type, or space. If multiple identical units exist, set unit_count > 1.
- current_rent_per_sf: contracted rent per SF per YEAR. Convert monthly → annual ×12. If only total annual rent given, divide by SF.
- market_rent_per_sf: broker's pro forma / market estimate per SF per year. If not stated, set equal to current_rent_per_sf.
- lease_type: "NNN", "MG", "Gross", or "Modified Gross". Default to "NNN" for industrial/flex.
- expense_reimbursement_per_sf: annual NNN CAM/tax/insurance pass-through per SF. Use 0 if gross lease or unknown.`;

    const prompt = `You are a commercial real estate underwriter. Extract rent roll and operating expense data from the documents below to populate a pro forma underwriting model.

Property type: ${deal.property_type ?? "unknown"}
${analysisContext}
DOCUMENTS:
${combinedText || "(No document text — use the known extracted metrics only)"}

Extract and return ONLY a JSON object in this exact format:

{
  "purchase_price": 5500000,
  "unit_groups": [
${unitGroupFormat}
  ],
  "vacancy_rate": 5,
  "taxes_annual": 45000,
  "insurance_annual": 12000,
  "repairs_annual": 15000,
  "utilities_annual": 0,
  "other_expenses_annual": 0,
  "exit_cap_rate": 7.5
}

Rules:
${unitGroupRules}
- vacancy_rate: as a whole-number percentage (5 = 5%), NOT a decimal.
- exit_cap_rate: as a whole-number percentage (7.5 = 7.5%), NOT a decimal.
- taxes_annual, insurance_annual etc.: full annual dollar amounts, no commas.
- Set a field to null ONLY if it is genuinely unavailable — do not guess wildly.
- Vacant building with no tenants: return unit_groups as [] and note vacancy_rate as 100.

Respond with ONLY the JSON object, no explanation.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const extracted = parseJson<AutofillResult>(raw, {
      purchase_price: null,
      unit_groups: [],
      vacancy_rate: null,
      taxes_annual: null,
      insurance_annual: null,
      repairs_annual: null,
      utilities_annual: null,
      other_expenses_annual: null,
      exit_cap_rate: null,
    });

    return NextResponse.json({
      data: extracted,
      sources: sourceNames,
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/uw-autofill error:", error);
    return NextResponse.json({ error: "Autofill failed" }, { status: 500 });
  }
}
