import Anthropic from "@anthropic-ai/sdk";
import { DocumentCategory, DOCUMENT_CATEGORIES } from "./types";
import { CONCISE_STYLE } from "./ai-style";
import { getSetting } from "./admin-helpers";
import { aiPromptQueries } from "./db";

const DEFAULT_MODEL = "claude-sonnet-4-5";

/**
 * Returns the Claude model the admin has configured (or the default).
 * Cached briefly to avoid hammering the DB.
 */
let _modelCache: { value: string; expires: number } | null = null;
export async function getActiveModel(): Promise<string> {
  if (_modelCache && _modelCache.expires > Date.now()) return _modelCache.value;
  const value = await getSetting<string>("ai.model", DEFAULT_MODEL);
  _modelCache = { value, expires: Date.now() + 30_000 };
  return value;
}

/**
 * Returns the admin-edited system prompt for the given key, falling back to
 * the provided default. Seeds the DB row with the default on first read.
 */
const _promptCache: Record<string, { value: string; expires: number }> = {};
export async function getPrompt(
  key: string,
  label: string,
  defaultPrompt: string,
  description?: string
): Promise<string> {
  const cached = _promptCache[key];
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    await aiPromptQueries.upsertDefault({ key, label, default_prompt: defaultPrompt, description });
    const row = await aiPromptQueries.get(key);
    const value = row?.prompt ?? defaultPrompt;
    _promptCache[key] = { value, expires: Date.now() + 30_000 };
    return value;
  } catch {
    return defaultPrompt;
  }
}

/** Bust caches after admin edits. */
export function clearAiConfigCache(): void {
  _modelCache = null;
  for (const k of Object.keys(_promptCache)) delete _promptCache[k];
}

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ─── PDF to Images ──────────────────────────────────────────────────────────

/**
 * Convert a PDF buffer into an array of base64 PNG images (one per page).
 * Uses pdf2pic + sharp. Returns up to maxPages images.
 */
export async function pdfToImages(
  pdfBuffer: Buffer,
  maxPages = 10,
  dpi = 200
): Promise<string[]> {
  const { fromBuffer } = await import("pdf2pic");
  const { randomUUID } = await import("crypto");
  const fs = await import("fs/promises");
  const pathMod = await import("path");

  // Use a unique per-invocation saveFilename + directory so concurrent PDF
  // conversions (e.g. simultaneous OM uploads) don't clobber each other's
  // on-disk page files, which previously caused one upload's analysis to be
  // run against another upload's pages.
  const runId = randomUUID();
  const savePath = pathMod.join("/tmp", `pdf2pic-${runId}`);
  await fs.mkdir(savePath, { recursive: true });

  const converter = fromBuffer(pdfBuffer, {
    density: dpi,
    format: "png",
    width: 1600,
    height: 2200,
    saveFilename: "page",
    savePath,
  });

  const images: string[] = [];
  try {
    for (let i = 1; i <= maxPages; i++) {
      try {
        const result = await converter(i, { responseType: "base64" });
        if (result.base64) {
          images.push(result.base64);
        } else {
          break; // no more pages
        }
      } catch {
        break; // past end of document
      }
    }
  } finally {
    // Best-effort cleanup of temp page files
    try {
      await fs.rm(savePath, { recursive: true, force: true });
    } catch {}
  }
  return images;
}

/**
 * Build Claude message content blocks from PDF page images.
 */
export function imageContentBlocks(
  base64Images: string[]
): Anthropic.ImageBlockParam[] {
  return base64Images.map((data) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/png" as const,
      data,
    },
  }));
}

// ─── Document Classification ─────────────────────────────────────────────────

export async function classifyDocument(
  fileName: string,
  contentText: string
): Promise<{
  category: DocumentCategory;
  summary: string;
  tags: string[];
}> {
  const categories = Object.entries(DOCUMENT_CATEGORIES)
    .map(([key, val]) => `- ${key}: ${val.label} — ${val.description}`)
    .join("\n");

  const contentSection = contentText.trim()
    ? `Content preview (first 3000 chars):\n${contentText.slice(0, 3000)}`
    : `No extractable text content (binary or image file). Use the filename to infer the document type.`;

  const prompt = `You are a real estate due diligence expert. Analyze this document and classify it.

Document name: ${fileName}
${contentSection}

Available categories:
${categories}

Respond with valid JSON only (no markdown):
{
  "category": "<category_key>",
  "summary": "<1-2 sentence summary of what this document contains>",
  "tags": ["<tag1>", "<tag2>", "<tag3>"]
}`;

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const result = JSON.parse(cleaned);
    return {
      category: (result.category || "other") as DocumentCategory,
      summary: result.summary || "",
      tags: Array.isArray(result.tags) ? result.tags : [],
    };
  } catch (err) {
    console.error("classifyDocument JSON parse failed:", err, "raw response:", response.content[0]);
    return { category: "other", summary: "", tags: [] };
  }
}

// ─── Rent Roll Extraction ───────────────────────────────────────────────────

export interface RentRollSummary {
  total_units: number | null;
  total_sf: number | null;
  total_monthly_rent: number | null;
  avg_rent_per_sf_annual: number | null;
  occupancy_pct: number | null;
}

const RENT_ROLL_PROMPT = `You are a commercial real estate analyst. This document is a rent roll — a standard output from property management software (e.g. Yardi, AppFolio, RealPage, Buildium).

Extract summary totals from it. The document typically has columns like: Unit, Tenant, Sqft, Rent, Deposit, Lease From/To.

Extract and return ONLY a JSON object with these fields. Use null if not determinable:

{
  "total_units": 34,
  "total_sf": 32375,
  "total_monthly_rent": 40425,
  "avg_rent_per_sf_annual": 15.00,
  "occupancy_pct": 95.0
}

Rules:
- total_units: count of distinct leasable units/suites/bays (exclude common areas, headers, subtotals)
- total_sf: sum of all unit square footages. Look for a "Total" row at the bottom, or sum the Sqft column.
- total_monthly_rent: sum of all current monthly rents. Look for a "Total" row, or sum the Rent column.
- avg_rent_per_sf_annual: (total_monthly_rent × 12) / total_sf. Null if no SF data.
- occupancy_pct: percentage of units that are occupied/leased. Units with $0.00 rent or no tenant are likely vacant.
- All dollar values as plain numbers (no $ signs, no commas)
- IMPORTANT: Use the totals row at the bottom of the rent roll if available — it's the most accurate source.

Respond with ONLY the JSON object, no explanation.`;

export async function extractRentRollSummary(
  contentText: string,
  pdfBuffer?: Buffer
): Promise<RentRollSummary | null> {
  if (!contentText && !pdfBuffer) return null;

  try {
    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

    // Convert PDF to images for reliable table parsing
    if (pdfBuffer) {
      try {
        const images = await pdfToImages(pdfBuffer, 8);
        if (images.length > 0) {
          content.push(...imageContentBlocks(images));
        }
      } catch (err) {
        console.error("PDF to image conversion failed, using text fallback:", err);
      }
    }

    // Fallback to text if no images were produced
    if (content.length === 0 && contentText) {
      content.push({ type: "text", text: `RENT ROLL TEXT:\n${contentText.slice(0, 16000)}` });
    }

    if (content.length === 0) return null;
    content.push({ type: "text", text: RENT_ROLL_PROMPT });

    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 512,
      messages: [{ role: "user", content }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as RentRollSummary;
  } catch (err) {
    console.error("extractRentRollSummary failed:", err);
    return null;
  }
}

// ─── Comp Extraction (Paste Mode) ────────────────────────────────────────────
//
// Extract a single structured comp record from pasted listing text. The user
// is expected to have viewed the source themselves — we do NOT fetch any URL
// server-side (see src/lib/web-allowlist.ts and FEATURE_ROADMAP_BACKLOG.md).
// The URL field is stored as a reference only.

export interface ExtractedCompDraft {
  comp_type: "sale" | "rent";
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  property_type: string | null;
  year_built: number | null;
  units: number | null;
  total_sf: number | null;
  // Sale
  sale_price: number | null;
  sale_date: string | null;
  cap_rate: number | null;
  noi: number | null;
  price_per_unit: number | null;
  price_per_sf: number | null;
  // Rent
  rent_per_unit: number | null;
  rent_per_sf: number | null;
  rent_per_bed: number | null;
  occupancy_pct: number | null;
  lease_type: string | null;
  // Meta
  distance_mi: number | null;
  confidence: number; // 0-1, Claude's self-assessment
  notes: string | null;
}

const COMP_EXTRACTION_PROMPT = `You are a commercial real estate analyst extracting a single comparable property from unstructured listing text that an analyst pasted in. The analyst already viewed the source themselves.

Decide whether this is a SALE comp (a transaction or asking-price listing for acquisition) or a RENT comp (a rental listing or lease comp). Extract whatever structured fields you can find. Use null for anything not clearly stated. Do NOT fabricate values.

Return ONLY a single JSON object with exactly these fields (null for unknown):

{
  "comp_type": "sale" | "rent",
  "name": "Property name or null",
  "address": "Street address or null",
  "city": "City or null",
  "state": "2-letter state code or null",
  "property_type": "multifamily | office | retail | industrial | mixed_use | hospitality | land | other | null",
  "year_built": 1995,
  "units": 120,
  "total_sf": 85000,
  "sale_price": 12500000,
  "sale_date": "2024-06-15",
  "cap_rate": 5.5,
  "noi": 687500,
  "price_per_unit": 104167,
  "price_per_sf": 147.06,
  "rent_per_unit": 1850,
  "rent_per_sf": 32.50,
  "rent_per_bed": null,
  "occupancy_pct": 95,
  "lease_type": "NNN | MG | Gross | Modified Gross | null",
  "distance_mi": null,
  "confidence": 0.85,
  "notes": "Any useful qualitative context from the listing (tenants, amenities, recent renovations, etc.)"
}

Rules:
- Numbers as plain JSON numbers (no $, no commas, no %).
- cap_rate, occupancy_pct, rent_per_sf are percentages / per-SF values — use the number shown (e.g. 5.5 not 0.055).
- rent_per_unit is MONTHLY.
- rent_per_sf is ANNUAL.
- sale_date must be ISO YYYY-MM-DD or null.
- If you compute price_per_unit or price_per_sf from other fields, mark confidence lower.
- confidence is your honest 0-1 estimate of how well the listing supported your extraction.
- Respond with ONLY the JSON object. No markdown fences, no explanation.`;

export async function extractCompFromText(
  pastedText: string,
  opts: { expectedType?: "sale" | "rent"; sourceUrl?: string } = {}
): Promise<ExtractedCompDraft | null> {
  if (!pastedText || pastedText.trim().length < 20) return null;

  try {
    const header = opts.expectedType
      ? `The analyst indicated this should be a ${opts.expectedType.toUpperCase()} comp.\n`
      : "";
    const sourceLine = opts.sourceUrl
      ? `Source URL (reference only, do not attempt to access): ${opts.sourceUrl}\n`
      : "";

    const userContent =
      `${header}${sourceLine}PASTED LISTING TEXT:\n"""\n${pastedText.slice(0, 12000)}\n"""\n\n${COMP_EXTRACTION_PROMPT}`;

    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 1024,
      messages: [{ role: "user", content: userContent }],
    });

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as ExtractedCompDraft;

    // Basic sanity: force comp_type, clamp confidence
    if (parsed.comp_type !== "sale" && parsed.comp_type !== "rent") {
      parsed.comp_type = opts.expectedType ?? "sale";
    }
    if (
      typeof parsed.confidence !== "number" ||
      parsed.confidence < 0 ||
      parsed.confidence > 1
    ) {
      parsed.confidence = 0.5;
    }
    return parsed;
  } catch (err) {
    console.error("extractCompFromText failed:", err);
    return null;
  }
}

// ─── Comp Extraction from Market Document ───────────────────────────────────
//
// Market studies, appraisals, broker comp reports typically contain MULTIPLE
// comparables — a rent comp grid with 8 properties, a sale comp block with
// 5 properties, etc. This extractor returns an array, not a single comp.

export interface ExtractedCompsBatch {
  comps: ExtractedCompDraft[];
  summary: string;
}

const COMPS_FROM_DOC_PROMPT = `You are a commercial real estate analyst extracting ALL comparable properties from a market-category document (market study, appraisal, broker comp report, rent survey, etc.).

The document may contain multiple sale comps, multiple rent comps, or a mix of both. Extract EVERY comparable property you can find. Do not summarize or dedupe — return all of them as distinct objects.

For each comp, decide whether it's a SALE comp or a RENT comp. Extract whatever structured fields you can find. Use null for anything not clearly stated. Do NOT fabricate values.

Return ONLY a single JSON object with exactly this shape:

{
  "summary": "Brief 1-sentence summary of what was found (e.g. '5 sale comps and 8 rent comps extracted from this market study').",
  "comps": [
    {
      "comp_type": "sale" | "rent",
      "name": "Property name or null",
      "address": "Street address or null",
      "city": "City or null",
      "state": "2-letter state code or null",
      "property_type": "multifamily | office | retail | industrial | mixed_use | hospitality | land | other | null",
      "year_built": 1995,
      "units": 120,
      "total_sf": 85000,
      "sale_price": 12500000,
      "sale_date": "2024-06-15",
      "cap_rate": 5.5,
      "noi": 687500,
      "price_per_unit": 104167,
      "price_per_sf": 147.06,
      "rent_per_unit": 1850,
      "rent_per_sf": 32.50,
      "rent_per_bed": null,
      "occupancy_pct": 95,
      "lease_type": "NNN | MG | Gross | Modified Gross | null",
      "distance_mi": null,
      "confidence": 0.85,
      "notes": "Source section / page reference, tenant info, amenities, etc."
    }
  ]
}

Rules:
- Numbers as plain JSON numbers (no $, no commas, no %).
- cap_rate, occupancy_pct, rent_per_sf are displayed values (5.5 not 0.055).
- rent_per_unit is MONTHLY. rent_per_sf is ANNUAL.
- sale_date must be ISO YYYY-MM-DD or null.
- confidence is your honest 0-1 estimate per-comp.
- If the document has NO comps at all, return { "summary": "No comparable properties found in this document", "comps": [] }.
- Respond with ONLY the JSON object. No markdown fences, no explanation.`;

export async function extractCompsFromDocument(
  contentText: string,
  opts: { documentName?: string } = {}
): Promise<ExtractedCompsBatch | null> {
  if (!contentText || contentText.trim().length < 40) return null;

  try {
    const header = opts.documentName
      ? `Document name: ${opts.documentName}\n\n`
      : "";
    const userContent =
      `${header}DOCUMENT CONTENT:\n"""\n${contentText.slice(0, 40000)}\n"""\n\n${COMPS_FROM_DOC_PROMPT}`;

    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 8000,
      messages: [{ role: "user", content: userContent }],
    });

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as ExtractedCompsBatch;

    if (!Array.isArray(parsed.comps)) {
      return { summary: parsed.summary ?? "No comps found", comps: [] };
    }

    // Sanity-clean each comp
    for (const c of parsed.comps) {
      if (c.comp_type !== "sale" && c.comp_type !== "rent") {
        c.comp_type = "sale";
      }
      if (
        typeof c.confidence !== "number" ||
        c.confidence < 0 ||
        c.confidence > 1
      ) {
        c.confidence = 0.5;
      }
    }

    return parsed;
  } catch (err) {
    console.error("extractCompsFromDocument failed:", err);
    return null;
  }
}

// ─── Diligence Chat ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function chatWithDiligence(
  dealName: string,
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>,
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .map(
      (d) =>
        `### ${d.name} (${d.category})\nSummary: ${d.ai_summary || "N/A"}\n${
          d.content_text
            ? `Content:\n${d.content_text.slice(0, 2000)}`
            : ""
        }`
    )
    .join("\n\n---\n\n");

  const promptTemplate = await getPrompt(
    "diligence_chat",
    "Diligence Chat",
    `You are a real estate due diligence assistant for the deal: "{{deal_name}}".

You have access to the following uploaded documents:

{{doc_context}}

Answer questions accurately based on the documents. If information isn't in the documents, say so clearly. Be concise but thorough. Use bullet points for lists. Flag any risks or issues you notice.`,
    "System prompt for the diligence Q&A assistant. Supports {{deal_name}} and {{doc_context}}."
  );

  const systemPrompt = promptTemplate
    .replace(/\{\{deal_name\}\}/g, dealName)
    .replace(/\{\{doc_context\}\}/g, docContext || "No documents uploaded yet.");

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

// ─── Deal Intelligence Chat (Tool Use) ───────────────────────────────────────

export interface ChatAction {
  type: "context_saved" | "deal_updated" | "underwriting_updated";
  note?: string;
  fields?: Record<string, unknown>;
  display: string;
}

const DEAL_CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "save_context",
    description:
      "Save important deal context, intel, or notes to persistent memory. Use this whenever the user provides factual information about the deal — seller motivation, broker intel, physical issues, market conditions, negotiation context, etc. This memory flows into the checklist, DD abstract, and other analyses.",
    input_schema: {
      type: "object" as const,
      properties: {
        note: {
          type: "string",
          description:
            "The context to save. Write as clear, complete sentences. Include who said it, when if relevant, and why it matters.",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "update_underwriting",
    description:
      "Update underwriting financial assumptions when the user provides specific numbers for the pro forma model. Use for purchase price overrides, rent assumptions, operating expenses, vacancy, cap rates, hold period, financing terms.",
    input_schema: {
      type: "object" as const,
      properties: {
        fields: {
          type: "object",
          description: "Underwriting model fields to update",
          properties: {
            purchase_price: { type: "number", description: "Purchase price in dollars" },
            vacancy_rate: { type: "number", description: "Vacancy as a whole number (5 = 5%)" },
            management_fee_pct: { type: "number", description: "Management fee as whole number %" },
            taxes_annual: { type: "number", description: "Annual property taxes in dollars" },
            insurance_annual: { type: "number", description: "Annual insurance in dollars" },
            repairs_annual: { type: "number", description: "Annual repairs/maintenance in dollars" },
            utilities_annual: { type: "number", description: "Annual utilities in dollars" },
            other_expenses_annual: { type: "number", description: "Other annual expenses in dollars" },
            exit_cap_rate: { type: "number", description: "Exit cap rate as whole number (7.5 = 7.5%)" },
            hold_period_years: { type: "number", description: "Hold period in years" },
            acq_ltc: { type: "number", description: "Acquisition loan-to-cost as whole number %" },
            acq_interest_rate: { type: "number", description: "Acquisition interest rate as whole number %" },
            acq_amort_years: { type: "number", description: "Acquisition amortization in years" },
            closing_costs_pct: { type: "number", description: "Closing costs as whole number %" },
          },
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "update_deal_fields",
    description:
      "Update structured fields on the deal record when the user provides specific factual data (price, SF, units, status, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "object",
          description: "Key-value pairs of fields to update",
          properties: {
            name: { type: "string" },
            asking_price: { type: "number", description: "Price in dollars" },
            square_footage: { type: "number" },
            units: { type: "integer" },
            year_built: { type: "integer" },
            address: { type: "string" },
            city: { type: "string" },
            state: { type: "string", description: "2-letter state code" },
            zip: { type: "string" },
            property_type: {
              type: "string",
              enum: ["industrial", "office", "retail", "multifamily", "student_housing", "mixed_use", "land", "hospitality", "other"],
            },
            status: {
              type: "string",
              enum: ["sourcing", "screening", "loi", "under_contract", "diligence", "closing", "closed", "dead"],
            },
          },
        },
      },
      required: ["updates"],
    },
  },
];

export async function chatWithDealIntelligence(
  deal: { id: string; name: string; context_notes?: string | null },
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>,
  history: ChatMessage[],
  userMessage: string
): Promise<{ response: string; actions: ChatAction[] }> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .slice(0, 20)
    .map(
      (d) =>
        `### ${d.name} (${d.category})\n${d.ai_summary || ""}\n${
          d.content_text ? d.content_text.slice(0, 1500) : ""
        }`
    )
    .join("\n\n---\n\n");

  const memorySection = deal.context_notes?.trim()
    ? `## Deal Memory (saved context)\n${deal.context_notes}`
    : "## Deal Memory\nNo context saved yet.";

  const promptTemplate = await getPrompt(
    "deal_intelligence_chat",
    "Deal Intelligence Chat",
    `You are a deal intelligence assistant for "{{deal_name}}".

{{memory_section}}

## Uploaded Documents
{{doc_context}}

## Your capabilities
1. Answer questions about the deal based on documents and saved memory
2. Save context when the user shares new intel, issues, seller info, market conditions, etc.
3. Update structured deal fields when the user provides specific data

When users share new information about the deal, always use save_context to preserve it.
When users provide structured data (price, SF, status changes), use update_deal_fields.
Always reply with a helpful text response in addition to any tool use.`,
    "System prompt for the per-deal chat assistant. Supports {{deal_name}}, {{memory_section}}, {{doc_context}} placeholders."
  );

  const systemPrompt = promptTemplate
    .replace(/\{\{deal_name\}\}/g, deal.name)
    .replace(/\{\{memory_section\}\}/g, memorySection)
    .replace(/\{\{doc_context\}\}/g, docContext || "No documents uploaded yet.");

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userMessage },
  ];

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 2048,
    system: systemPrompt,
    tools: DEAL_CHAT_TOOLS,
    messages,
  });

  // Extract text response
  let responseText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n")
    .trim();

  if (!responseText) responseText = "Done.";

  // Extract tool calls → actions
  const actions: ChatAction[] = [];
  const toolUses = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];

  for (const tool of toolUses) {
    if (tool.name === "save_context") {
      const input = tool.input as { note: string };
      actions.push({
        type: "context_saved",
        note: input.note,
        display: `Saved to memory: "${input.note.slice(0, 80)}${input.note.length > 80 ? "…" : ""}"`,
      });
    } else if (tool.name === "update_deal_fields") {
      const input = tool.input as { updates: Record<string, unknown> };
      const fieldNames = Object.keys(input.updates).join(", ");
      actions.push({
        type: "deal_updated",
        fields: input.updates,
        display: `Updated deal: ${fieldNames}`,
      });
    } else if (tool.name === "update_underwriting") {
      const input = tool.input as { fields: Record<string, unknown> };
      const fieldNames = Object.keys(input.fields).join(", ");
      actions.push({
        type: "underwriting_updated",
        fields: input.fields,
        display: `Updated underwriting: ${fieldNames}`,
      });
    }
  }

  return { response: responseText, actions };
}

// ─── Checklist Auto-fill ─────────────────────────────────────────────────────

export interface ChecklistFillResult {
  category: string;
  item: string;
  status: "complete" | "pending" | "na" | "issue";
  notes: string;
  source_document_names: string[];
}

// Map checklist categories → relevant document categories
const CHECKLIST_DOC_CATEGORIES: Record<string, string[]> = {
  "Title & Ownership": ["title_ownership"],
  "Environmental": ["environmental"],
  "Zoning & Entitlements": ["zoning_entitlements"],
  "Financial": ["financial"],
  "Leases": ["leases"],
  "Physical Inspections": ["surveys_engineering", "inspections"],
  "Legal & Contracts": ["legal"],
  "Utilities & Infrastructure": ["other", "utilities"],
  "Permits & Compliance": ["zoning_entitlements", "legal", "permits"],
  "Market & Valuation": ["financial", "market"],
  "Insurance": ["insurance"],
};

export async function autoFillChecklist(
  dealName: string,
  documents: Array<{
    id: string;
    name: string;
    original_name?: string;
    category: string;
    content_text: string | null;
    ai_summary: string | null;
  }>,
  checklistItems: Array<{ id: string; category: string; item: string }>,
  contextNotes?: string | null
): Promise<ChecklistFillResult[]> {
  if (documents.length === 0 || checklistItems.length === 0) return [];

  // Group checklist items by category
  const categories = Array.from(new Set(checklistItems.map((i) => i.category)));

  // Build per-category context: pair relevant docs with their checklist items
  const categoryBlocks = categories.map((cat) => {
    const items = checklistItems.filter((i) => i.category === cat);
    const relevantDocCats = CHECKLIST_DOC_CATEGORIES[cat] || [];

    // Primary docs: match by document category
    const primaryDocs = documents.filter((d) => relevantDocCats.includes(d.category));
    // Secondary docs: all others (may still contain relevant info)
    const secondaryDocs = documents.filter((d) => !relevantDocCats.includes(d.category));

    const formatDoc = (d: typeof documents[0], maxChars: number) => {
      const name = d.original_name || d.name;
      const summary = d.ai_summary ? `Summary: ${d.ai_summary}` : "";
      const content = d.content_text ? d.content_text.slice(0, maxChars) : "";
      return `  [${name}] (category: ${d.category}):\n  ${summary}\n  ${content}`;
    };

    // Give primary docs much more content space
    const primaryContext = primaryDocs.map((d) => formatDoc(d, 10000)).join("\n\n");
    // Give secondary docs just summary + short content
    const secondaryContext = secondaryDocs.map((d) => formatDoc(d, 1500)).join("\n\n");

    const itemsList = items.map((i) => `  - ${i.item}`).join("\n");

    return `
=== CATEGORY: ${cat} ===
CHECKLIST ITEMS:
${itemsList}

PRIMARY DOCUMENTS (directly relevant):
${primaryContext || "  (none uploaded)"}

OTHER DOCUMENTS (may contain relevant info):
${secondaryContext || "  (none)"}`;
  }).join("\n\n");

  const memorySection = contextNotes?.trim()
    ? `\nDEAL MEMORY (additional context):\n${contextNotes}\n`
    : "";

  // Document inventory for the AI
  const docInventory = documents.map(d => `- "${d.original_name || d.name}" (category: ${d.category})`).join("\n");

  const prompt = `You are a real estate due diligence expert reviewing documents for deal: "${dealName}".
${memorySection}
UPLOADED DOCUMENTS INVENTORY:
${docInventory}

${categoryBlocks}

INSTRUCTIONS:
You must assess EVERY checklist item and return a result for each one.

For each checklist item, carefully review the documents — especially the PRIMARY documents for that category. Pay close attention to:
1. Document NAMES — a document named "Preliminary Title Report" or "PRELIM" IS the preliminary title report. If it exists and has content, that item should be "complete".
2. Document CONTENT — look for specific information that addresses the checklist item.
3. Document SUMMARIES — the AI summary may confirm what the document covers.

IMPORTANT STATUS RULES:
- "complete": A relevant document EXISTS and contains information that addresses this item. If a preliminary title report document is uploaded, "Preliminary title report reviewed" is COMPLETE. If title documents exist, "Chain of title confirmed" should be assessed from their content. Be generous — if the document is present and relevant, mark complete with a note about what was found.
- "issue": The document reveals a specific problem, red flag, lien, encumbrance, or concern. Always explain what the issue is.
- "na": Clearly not applicable to this deal/property type.
- "pending": ONLY use this when no relevant document exists at all or the document truly does not address this item. Do NOT default to pending when a relevant document is present.

For notes: Reference the SPECIFIC document name and what you found (or didn't find). Be concise but specific. Example: "PRELIM-as of 10.1.25.PDF — Standard preliminary title report present, shows vesting in [entity name]."

Respond with valid JSON array only (no markdown, no code fences):
[
  {
    "category": "<exact category text from above>",
    "item": "<exact item text from above>",
    "status": "complete" | "pending" | "na" | "issue",
    "notes": "<brief explanation referencing specific document names>",
    "source_document_names": ["<exact document name as shown in inventory>"]
  }
]`;

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "[]";
    // Strip any markdown code fences the model might add
    const cleaned = text.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}

// ─── Deal Field Extraction ───────────────────────────────────────────────────

export interface ExtractedDealFields {
  asking_price?: number;
  square_footage?: number;
  units?: number;
  bedrooms?: number;
  year_built?: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  property_type?: string;
}

export async function extractDealFields(
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>
): Promise<ExtractedDealFields> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .slice(0, 10)
    .map((d) => `[${d.name}]\nSummary: ${d.ai_summary || ""}\n${d.content_text ? d.content_text.slice(0, 2000) : ""}`)
    .join("\n\n---\n\n");

  if (!docContext) return {};

  const prompt = `You are a real estate data extraction expert. Extract key property facts from these documents.

DOCUMENTS:
${docContext}

Extract only values you are confident about from the documents. Return valid JSON only (no markdown):
{
  "asking_price": <number in dollars, no commas, or null>,
  "square_footage": <total building SF as number, or null>,
  "units": <number of units/apartments, or null>,
  "bedrooms": <total bedrooms if residential, or null>,
  "year_built": <4-digit year, or null>,
  "address": <street address only, or null>,
  "city": <city name, or null>,
  "state": <2-letter state code, or null>,
  "zip": <5-digit zip, or null>,
  "property_type": <one of: industrial|office|retail|multifamily|student_housing|mixed_use|land|hospitality|other, or null>
}`;

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const result = JSON.parse(cleaned);
    // Strip null values so we only patch fields that were actually found
    return Object.fromEntries(
      Object.entries(result).filter(([, v]) => v !== null && v !== undefined)
    ) as ExtractedDealFields;
  } catch {
    return {};
  }
}

// ─── DD Abstract ─────────────────────────────────────────────────────────────

export interface UnderwritingSnapshot {
  proforma?: {
    irr?: number | null;
    yoc?: number | null;
    equity_multiple?: number | null;
    max_pp?: number | null;
    dscr?: number | null;
    noi_stabilized?: number | null;
    refi_proceeds?: number | null;
  } | null;
  uwData?: Record<string, unknown> | null;
}

const SECTION_PROMPTS: Record<string, string> = {
  executive_summary: "**Executive Summary** (2-3 sentences synthesizing the deal thesis)",
  property_overview: "**Property Overview** (key facts from all sources)",
  underwriting_summary: "**Underwriting Summary** (use the COMPUTED RETURNS from the internal model — show cap rate, NOI, yield on cost, financing terms, CapEx budget, hold period, exit assumptions. Note: all percentage values are already in percent form, do NOT multiply by 100)",
  revenue_expense: "**Revenue & Expense Analysis** (unit mix, in-place vs market rents, operating expenses breakdown)",
  document_review: "**Document Review Status** (what's been received, what's outstanding)",
  key_findings: "**Key Findings** (organized by category — title, environmental, financial, physical, legal)",
  red_flags: "**Red Flags & Issues** (anything requiring attention, including checklist items marked as issues)",
  outstanding_items: "**Outstanding Items** (what's still needed to complete diligence)",
  recommendation: "**Recommendation** (proceed / proceed with conditions / do not proceed — with brief rationale)",
};

function buildSectionInstructions(sections?: string[]): string {
  const ids = sections && sections.length > 0
    ? sections
    : Object.keys(SECTION_PROMPTS);
  return ids
    .filter(id => SECTION_PROMPTS[id])
    .map((id, i) => `${i + 1}. ${SECTION_PROMPTS[id]}`)
    .join("\n");
}

export async function generateDDAbstract(
  deal: { name: string; address: string; city: string; state: string; property_type: string; status: string; asking_price: number | null; square_footage: number | null; units: number | null; year_built: number | null },
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null; ai_tags: string | null }>,
  checklist: Array<{ category: string; item: string; status: string; notes: string | null }>,
  underwritingSummary?: string,
  contextNotes?: string | null,
  sections?: string[]
): Promise<string> {
  const docContext = documents
    .filter((d) => d.ai_summary)
    .map((d) => `- **${d.name}** (${d.category}): ${d.ai_summary}`)
    .join("\n");

  const checklistSummary = (() => {
    const byCategory: Record<string, { complete: number; pending: number; issue: number; na: number; notes: string[] }> = {};
    for (const item of checklist) {
      if (!byCategory[item.category]) byCategory[item.category] = { complete: 0, pending: 0, issue: 0, na: 0, notes: [] };
      const cat = byCategory[item.category];
      cat[item.status as "complete" | "pending" | "issue" | "na"]++;
      if (item.notes) {
        cat.notes.push(`[${item.status}] ${item.item}: ${item.notes}`);
      }
    }
    return Object.entries(byCategory)
      .map(([cat, s]) => {
        let line = `${cat}: ${s.complete} complete, ${s.pending} pending, ${s.issue} issues`;
        if (s.notes.length > 0) line += `\n  Notes: ${s.notes.join("; ")}`;
        return line;
      })
      .join("\n");
  })();

  const uwSection = underwritingSummary?.trim()
    ? `\nINTERNAL UNDERWRITING MODEL:\n${underwritingSummary}\n`
    : "";

  const memorySection = contextNotes?.trim()
    ? `\nDEAL MEMORY (analyst notes & intel):\n${contextNotes}\n`
    : "";

  const prompt = `${CONCISE_STYLE}

You are a senior real estate investment analyst conducting critical due diligence review. Your tone should be SKEPTICAL, ANALYTICAL, and CRITICAL — identify weaknesses, flag assumptions that seem aggressive, question gaps in data, and highlight risks prominently. This memo is for internal decision-makers who need an honest, unvarnished assessment — not a sales pitch. Err on the side of caution and be direct about concerns. Within each section use bullet points (markdown "-") instead of paragraphs.

Write a comprehensive due diligence abstract memo that synthesizes ALL available deal information — the OM analysis, the underwriting model, document reviews, checklist progress, and analyst notes.
${memorySection}
DEAL: ${deal.name}
Address: ${[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}
Type: ${deal.property_type} | Status: ${deal.status}
Asking Price: ${deal.asking_price ? `$${deal.asking_price.toLocaleString()}` : "TBD"} | SF: ${deal.square_footage ?? "Unknown"} | Units: ${deal.units ?? "N/A"} | Year Built: ${deal.year_built ?? "Unknown"}
${uwSection}
DOCUMENTS UPLOADED (${documents.length} total):
${docContext || "No documents with summaries yet."}

DILIGENCE CHECKLIST STATUS:
${checklistSummary || "Checklist not yet completed."}

Write a professional due diligence abstract in markdown format with ONLY the following requested sections:
${buildSectionInstructions(sections)}

IMPORTANT: Use the actual underwriting data provided. All rates (vacancy, cap rate, interest rate, etc.) are already expressed as percentages — do NOT multiply them by 100. For example, a vacancy_rate of 5 means 5%, not 500%.
Be factual, concise, and investment-focused. If information is missing, note it as outstanding.`;

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 5000,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}

// ─── Streaming Chat ──────────────────────────────────────────────────────────

export async function streamChatWithDiligence(
  dealName: string,
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>,
  history: ChatMessage[],
  userMessage: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .slice(0, 20) // limit to 20 docs to avoid token limits
    .map(
      (d) =>
        `### ${d.name} (${d.category})\n${d.ai_summary || ""}\n${
          d.content_text ? d.content_text.slice(0, 1500) : ""
        }`
    )
    .join("\n\n---\n\n");

  const promptTemplate = await getPrompt(
    "diligence_chat_streaming",
    "Diligence Chat (streaming)",
    `You are a real estate due diligence assistant for the deal: "{{deal_name}}".

You have access to the following uploaded documents:
{{doc_context}}

Answer questions accurately based on the documents. If information isn't available, say so clearly. Flag risks or issues. Use markdown formatting for readability.`,
    "Streaming variant of the diligence chat prompt. Supports {{deal_name}} and {{doc_context}}."
  );

  const systemPrompt = promptTemplate
    .replace(/\{\{deal_name\}\}/g, dealName)
    .replace(/\{\{doc_context\}\}/g, docContext || "No documents uploaded yet.");

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  let fullText = "";

  const stream = getClient().messages.stream({
    model: await getActiveModel(),
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      fullText += chunk.delta.text;
      onChunk(chunk.delta.text);
    }
  }

  return fullText;
}

// ─── Zoning Analysis ──────────────────────────────────────────────────────────

export interface ZoningAnalysis {
  structured: {
    zoning_designation: string;
    far: number | null;
    max_height_ft: number | null;
    max_height_stories: number | null;
    lot_coverage_pct: number | null;
    setbacks: { front: number; side: number; rear: number } | null;
    permitted_uses: string[];
    overlays: string[];
    density_bonuses: Array<{ source: string; description: string; additional_density: string }>;
    parking_requirements: string;
  };
  narrative: string;
  sources: string[];
}

export async function analyzeZoning(
  dealName: string,
  address: string,
  city: string,
  state: string,
  propertyType: string,
  investmentStrategy: string | null,
  documents: Array<{
    name: string;
    content_text: string | null;
    ai_summary: string | null;
  }>
): Promise<ZoningAnalysis> {
  const docContext = documents
    .filter((d) => d.content_text || d.ai_summary)
    .map(
      (d) =>
        `[${d.name}]: ${d.ai_summary || ""}\n${
          d.content_text ? d.content_text.slice(0, 3000) : ""
        }`
    )
    .join("\n\n");

  const fullAddress = [address, city, state].filter(Boolean).join(", ");

  const prompt = `${CONCISE_STYLE}

You are a real estate zoning and entitlements expert. Analyze the zoning for this property.

PROPERTY:
- Deal: ${dealName}
- Address: ${fullAddress}
- Property Type: ${propertyType}
- Investment Strategy: ${investmentStrategy || "Not specified"}

${docContext ? `UPLOADED ZONING DOCUMENTS:\n${docContext}\n` : "No zoning documents uploaded yet."}

INSTRUCTIONS:
1. Based on the address, research what you know about the jurisdiction's zoning codes for this location.
2. If zoning documents were provided, cross-reference them with your knowledge.
3. Identify the zoning district/designation for this address.
4. Extract dimensional standards: FAR, height limits, lot coverage, setbacks, parking.
5. Identify any overlay districts that apply.
6. Research state-level density bonus programs or legislation that could allow additional density (e.g., California AB 2011, Texas Chapter 245, Florida Live Local Act, etc.).
7. Flag any use restrictions that conflict with the intended property type (${propertyType}).

Respond with valid JSON only (no markdown):
{
  "structured": {
    "zoning_designation": "<zoning code/district, e.g. M-1, PD-123, C-2>",
    "far": <number or null if unknown>,
    "max_height_ft": <number or null>,
    "max_height_stories": <number or null>,
    "lot_coverage_pct": <number 0-100 or null>,
    "setbacks": { "front": <ft>, "side": <ft>, "rear": <ft> } or null,
    "permitted_uses": ["<use1>", "<use2>"],
    "overlays": ["<overlay1>"],
    "density_bonuses": [
      { "source": "<legislation or program name>", "description": "<what it allows>", "additional_density": "<e.g. +35% FAR>" }
    ],
    "parking_requirements": "<brief summary>"
  },
  "narrative": "<detailed markdown-formatted zoning memo covering: zoning designation, dimensional standards, permitted uses, overlays, density bonuses, potential conflicts, recommendations for the developer>",
  "sources": ["<source description or URL>"]
}

Be thorough in the narrative. Include specific code references where possible. If you're uncertain about specific values, note that in the narrative and provide your best estimate with caveats.`;

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "{}";
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      structured: {
        zoning_designation: "Unknown",
        far: null,
        max_height_ft: null,
        max_height_stories: null,
        lot_coverage_pct: null,
        setbacks: null,
        permitted_uses: [],
        overlays: [],
        density_bonuses: [],
        parking_requirements: "Unknown",
      },
      narrative: "Failed to parse zoning analysis. Please try again.",
      sources: [],
    };
  }
}
