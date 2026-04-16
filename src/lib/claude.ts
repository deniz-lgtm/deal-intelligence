import Anthropic from "@anthropic-ai/sdk";
import { DocumentCategory, DOCUMENT_CATEGORIES } from "./types";
import { CONCISE_STYLE } from "./ai-style";
import { getSetting } from "./admin-helpers";
import { aiPromptQueries } from "./db";

const DEFAULT_MODEL = "claude-sonnet-4-6";

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

// ─── Detailed Rent Roll Extraction (Unit-Level) ──────────────────────────────
//
// Returns per-unit rows for structured diffing between rent roll versions.
// Heavier than extractRentRollSummary (which only returns totals); used by
// the Doc Intelligence Pipeline when comparing two rent roll versions.

export interface RentRollUnit {
  unit: string;
  tenant: string | null;
  sf: number | null;
  monthly_rent: number | null;
  lease_start: string | null;
  lease_end: string | null;
  status: "occupied" | "vacant" | "unknown";
}

export interface DetailedRentRoll {
  units: RentRollUnit[];
  summary: RentRollSummary;
}

const DETAILED_RENT_ROLL_PROMPT = `You are a CRE analyst extracting unit-level data from a rent roll.

Extract EVERY leasable unit/suite/bay as a row. Also compute the summary totals.

Return ONLY a JSON object:

{
  "units": [
    {
      "unit": "101",
      "tenant": "John Smith" or null,
      "sf": 850,
      "monthly_rent": 1200,
      "lease_start": "2024-01-01" or null,
      "lease_end": "2025-01-01" or null,
      "status": "occupied" | "vacant" | "unknown"
    }
  ],
  "summary": {
    "total_units": 34,
    "total_sf": 32375,
    "total_monthly_rent": 40425,
    "avg_rent_per_sf_annual": 15.00,
    "occupancy_pct": 95.0
  }
}

Rules:
- Numbers as plain JSON numbers (no $, no commas)
- Dates as YYYY-MM-DD or null
- status: "occupied" if tenant/rent present, "vacant" if $0 rent or no tenant, "unknown" otherwise
- Skip header/subtotal/total rows — only include actual leasable units
- Cap at 200 units (for very large properties, include the first 200)
- JSON only, no markdown fences`;

export async function extractDetailedRentRoll(
  contentText: string,
  pdfBuffer?: Buffer
): Promise<DetailedRentRoll | null> {
  if (!contentText && !pdfBuffer) return null;

  try {
    const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

    if (pdfBuffer) {
      try {
        const images = await pdfToImages(pdfBuffer, 8);
        if (images.length > 0) {
          content.push(...imageContentBlocks(images));
        }
      } catch {
        // fallback to text
      }
    }

    if (content.length === 0 && contentText) {
      content.push({
        type: "text",
        text: `RENT ROLL TEXT:\n${contentText.slice(0, 20000)}`,
      });
    }

    if (content.length === 0) return null;
    content.push({ type: "text", text: DETAILED_RENT_ROLL_PROMPT });

    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 8000,
      messages: [{ role: "user", content }],
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

    const parsed = JSON.parse(match[0]) as DetailedRentRoll;
    if (!Array.isArray(parsed.units)) parsed.units = [];
    return parsed;
  } catch (err) {
    console.error("extractDetailedRentRoll failed:", err);
    return null;
  }
}

// ─── Structured Diff for Rent Rolls ──────────────────────────────────────
//
// Compares two DetailedRentRoll objects and returns a structured diff
// showing new units, removed units, and changed fields per unit. Pure JS —
// no Claude call needed for the structured comparison.

export interface RentRollDiffResult {
  summary: string;
  new_units: RentRollUnit[];
  removed_units: RentRollUnit[];
  changed_units: Array<{
    unit: string;
    changes: Array<{
      field: string;
      before: string | number | null;
      after: string | number | null;
    }>;
  }>;
  summary_delta: {
    total_units: { before: number | null; after: number | null };
    total_monthly_rent: { before: number | null; after: number | null };
    occupancy_pct: { before: number | null; after: number | null };
  };
}

export function diffRentRolls(
  prev: DetailedRentRoll,
  curr: DetailedRentRoll
): RentRollDiffResult {
  const prevMap = new Map(prev.units.map((u) => [u.unit, u]));
  const currMap = new Map(curr.units.map((u) => [u.unit, u]));

  const newUnits = curr.units.filter((u) => !prevMap.has(u.unit));
  const removedUnits = prev.units.filter((u) => !currMap.has(u.unit));

  const changedUnits: RentRollDiffResult["changed_units"] = [];
  for (const [id, currUnit] of Array.from(currMap.entries())) {
    const prevUnit = prevMap.get(id);
    if (!prevUnit) continue;
    const changes: Array<{
      field: string;
      before: string | number | null;
      after: string | number | null;
    }> = [];
    const fields: (keyof RentRollUnit)[] = [
      "tenant",
      "sf",
      "monthly_rent",
      "lease_start",
      "lease_end",
      "status",
    ];
    for (const f of fields) {
      if (String(prevUnit[f] ?? "") !== String(currUnit[f] ?? "")) {
        changes.push({
          field: f,
          before: prevUnit[f] as string | number | null,
          after: currUnit[f] as string | number | null,
        });
      }
    }
    if (changes.length > 0) {
      changedUnits.push({ unit: id, changes });
    }
  }

  const rentDelta =
    (curr.summary.total_monthly_rent ?? 0) -
    (prev.summary.total_monthly_rent ?? 0);
  const unitDelta =
    (curr.summary.total_units ?? 0) - (prev.summary.total_units ?? 0);
  const occDelta =
    (curr.summary.occupancy_pct ?? 0) - (prev.summary.occupancy_pct ?? 0);

  const parts: string[] = [];
  if (newUnits.length) parts.push(`${newUnits.length} new unit(s)`);
  if (removedUnits.length) parts.push(`${removedUnits.length} removed`);
  if (changedUnits.length) parts.push(`${changedUnits.length} changed`);
  if (rentDelta !== 0)
    parts.push(
      `rent ${rentDelta > 0 ? "+" : ""}$${Math.round(rentDelta).toLocaleString()}/mo`
    );
  if (occDelta !== 0)
    parts.push(
      `occupancy ${occDelta > 0 ? "+" : ""}${occDelta.toFixed(1)}%`
    );

  const summary =
    parts.length > 0
      ? parts.join(", ")
      : "No changes detected between rent roll versions.";

  return {
    summary,
    new_units: newUnits,
    removed_units: removedUnits,
    changed_units: changedUnits,
    summary_delta: {
      total_units: {
        before: prev.summary.total_units,
        after: curr.summary.total_units,
      },
      total_monthly_rent: {
        before: prev.summary.total_monthly_rent,
        after: curr.summary.total_monthly_rent,
      },
      occupancy_pct: {
        before: prev.summary.occupancy_pct,
        after: curr.summary.occupancy_pct,
      },
    },
  };
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

const COMP_EXTRACTION_PROMPT = `You are a commercial real estate analyst extracting a single comparable property from listing material an analyst has supplied (pasted text, screenshots, and/or a source URL slug). The analyst already viewed the source themselves.

Decide whether this is a SALE comp (a transaction or asking-price listing for acquisition) or a RENT comp (a rental listing or lease comp). Extract whatever structured fields you can find. Use null for anything not clearly stated. Do NOT fabricate values.

If the listing covers a single building with multiple available units (typical of apartment / multifamily rental listings — e.g. Zillow's "Available units" table on an apartment community page, or a CoStar rent-roll snippet), produce ONE comp for the BUILDING:
  - Use the building / community name as 'name'.
  - Average the per-unit base rents into 'rent_per_unit' (monthly).
  - In 'notes', list the per-unit breakdown: e.g. "Units listed: Studio 455sf $2,395; 1BR/1ba 581sf $2,595; 1BR/1ba 583sf $2,795. 14 units available across 3 floor plans."
  - 'units' = total unit count if visible (use the building's stated unit count, not just the available-unit count if both are shown).
  - Mark confidence proportional to how clearly the building-level fields are visible.

If the input includes a source URL, treat its slug as a hint about the property name and city — but only as a hint; the on-screen / pasted content takes precedence.

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
  "notes": "Any useful qualitative context from the listing (tenants, amenities, recent renovations, per-unit rent breakdown, etc.)"
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

export interface ExtractCompImage {
  /** "image/png" | "image/jpeg" | "image/webp" | "image/gif" — Claude vision media types */
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Raw base64 data (no data: URL prefix) */
  data: string;
}

export async function extractCompFromText(
  pastedText: string,
  opts: {
    expectedType?: "sale" | "rent";
    sourceUrl?: string;
    images?: ExtractCompImage[];
  } = {}
): Promise<ExtractedCompDraft | null> {
  const trimmedText = (pastedText || "").trim();
  const images = opts.images ?? [];

  // Need at least one of: 20+ chars of text, a source URL, or one image.
  if (trimmedText.length < 20 && images.length === 0 && !opts.sourceUrl) {
    return null;
  }

  try {
    const header = opts.expectedType
      ? `The analyst indicated this should be a ${opts.expectedType.toUpperCase()} comp.\n`
      : "";
    const sourceLine = opts.sourceUrl
      ? `Source URL (reference only — analyst pulled this in their own browser; do not attempt to access): ${opts.sourceUrl}\n`
      : "";
    const textBlock = trimmedText
      ? `\nPASTED LISTING TEXT:\n"""\n${trimmedText.slice(0, 12000)}\n"""\n`
      : "";
    const imageNote =
      images.length > 0
        ? `\nThe analyst attached ${images.length} screenshot${
            images.length === 1 ? "" : "s"
          } / image${images.length === 1 ? "" : "s"} of the listing — extract data from them as the primary source of truth.\n`
        : "";

    const userText = `${header}${sourceLine}${textBlock}${imageNote}\n${COMP_EXTRACTION_PROMPT}`;

    // Build a multi-modal content array: images first (better for visual
    // grounding), then the text/instructions.
    const content: Anthropic.ContentBlockParam[] = [
      ...images.map(
        (img) =>
          ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: img.mediaType,
              data: img.data,
            },
          } satisfies Anthropic.ImageBlockParam)
      ),
      { type: "text", text: userText },
    ];

    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 1024,
      messages: [{ role: "user", content }],
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
              enum: ["industrial", "office", "retail", "multifamily", "sfr", "student_housing", "mixed_use", "land", "hospitality", "other"],
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

// ─── Universal Chatbot ───────────────────────────────────────────────────────
//
// chatUniversal powers the floating chatbot that lives on every page of the
// app. It differs from chatWithDealIntelligence in three ways:
//
//   1. Deal is OPTIONAL. On workspace pages (inbox, comps library, etc.) the
//      user might ask questions that don't relate to any one deal.
//   2. Page context is injected into the system prompt — the user's current
//      screen (underwriting, documents, etc.) is passed through as plain
//      text so Claude can answer "what am I looking at?" and take page-aware
//      actions.
//   3. The UW co-pilot is folded in as a tool. When the user asks to stress-
//      test the model, explore a what-if, or check benchmarks, Claude can
//      return structured action blocks that the widget renders inline.

export interface UniversalChatAction {
  type:
    | "context_saved"
    | "deal_updated"
    | "underwriting_updated"
    | "note_created";
  note?: string;
  fields?: Record<string, unknown>;
  category?: string;
  display: string;
}

const UNIVERSAL_CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "save_context",
    description:
      "Save deal context, intel, or notes to persistent memory for a deal. Use whenever the user shares factual information about a specific deal — seller motivation, broker intel, physical issues, market conditions, negotiation context. Requires an active deal context.",
    input_schema: {
      type: "object" as const,
      properties: {
        note: {
          type: "string",
          description:
            "The context to save. Write as clear, complete sentences. Include who said it and why it matters.",
        },
        category: {
          type: "string",
          enum: ["context", "thesis", "risk", "review", "site_walk"],
          description:
            "Which memory bucket the note belongs in. Default 'context' for broker/seller intel, 'thesis' for investment rationale, 'risk' for red flags, 'review' for team discussion, 'site_walk' for property observations.",
        },
      },
      required: ["note"],
    },
  },
  {
    name: "update_underwriting",
    description:
      "Update underwriting assumptions when the user provides specific numbers (purchase price, rent, vacancy, exit cap, hold period, financing, etc.). Requires an active deal. On the UW page the widget will also offer to apply the patch to the live model.",
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
      "Update structured fields on the current deal (price, SF, units, status, etc.). Requires an active deal.",
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
              enum: ["industrial", "office", "retail", "multifamily", "sfr", "student_housing", "mixed_use", "land", "hospitality", "other"],
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

export interface UniversalChatContext {
  // Current deal the user is looking at (if any). Used to scope save_context,
  // update_deal_fields, update_underwriting and to enrich the prompt.
  deal?: {
    id: string;
    name: string;
    context_notes?: string | null;
    property_type?: string | null;
    status?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
  // Free-text snapshot of what's on screen. Pages call useSetPageContext
  // to publish this. Examples:
  //   "Page: Underwriting. Purchase price $12.5M. Vacancy 6%. Exit cap 6.5%."
  //   "Page: Documents. 14 docs uploaded, 3 categorized as leases."
  screen?: string | null;
  // Which page the user is on. Helps the model craft relevant suggestions.
  route?: string | null;
}

export async function chatUniversal(
  ctx: UniversalChatContext,
  documents: Array<{ name: string; category: string; content_text: string | null; ai_summary: string | null }>,
  history: ChatMessage[],
  userMessage: string
): Promise<{ response: string; actions: UniversalChatAction[] }> {
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

  const dealBlock = ctx.deal
    ? `## Active Deal
Name: ${ctx.deal.name}
${ctx.deal.property_type ? `Type: ${ctx.deal.property_type}` : ""}
${ctx.deal.status ? `Status: ${ctx.deal.status}` : ""}
${ctx.deal.city || ctx.deal.state ? `Location: ${[ctx.deal.city, ctx.deal.state].filter(Boolean).join(", ")}` : ""}

## Deal Memory
${ctx.deal.context_notes?.trim() || "No context saved yet."}`
    : `## Active Deal
None — the user is on a workspace-level page. save_context, update_deal_fields, and update_underwriting tools are NOT available. Answer questions, help navigate, and give general underwriting guidance.`;

  const screenBlock = ctx.screen?.trim()
    ? `## Current Screen
${ctx.screen.trim()}`
    : "";

  const promptTemplate = await getPrompt(
    "universal_chat",
    "Universal Chatbot",
    `You are the floating assistant for Deal Intelligence — a CRE deal analyst's co-pilot that lives on every page.

{{deal_block}}

{{screen_block}}

## Uploaded Documents
{{doc_context}}

## Your capabilities
1. Answer questions about the deal, the current screen, or CRE underwriting generally.
2. Take notes — when the user says "note that..." or shares intel, save it with save_context.
3. Update the deal record (price, status, etc.) when the user provides structured facts.
4. Update underwriting assumptions (vacancy, exit cap, rents, financing, etc.).
5. Be page-aware — if the user says "the exit cap is too aggressive" and they're on the Underwriting page, patch that field. If they say "move this to LOI" from the deals list, update the status.

Guidance:
- Always accompany a tool use with a short text confirmation so the user sees what you did.
- Keep responses concise — this is a sidebar, not a full page.
- If the user asks you to "stress-test" / "challenge" / "review" the underwriting model, point them to the UW Co-Pilot tab of this widget (Review / What-If / Benchmarks) rather than trying to do that analysis in chat.
- Never fabricate financial facts. If you don't have enough data in the memory or documents to answer, say so and ask the user for the missing piece.`,
    "System prompt for the universal (cross-page) chatbot. Supports {{deal_block}}, {{screen_block}}, {{doc_context}}."
  );

  const systemPrompt = promptTemplate
    .replace(/\{\{deal_block\}\}/g, dealBlock)
    .replace(/\{\{screen_block\}\}/g, screenBlock)
    .replace(/\{\{doc_context\}\}/g, docContext || "No documents uploaded yet.");

  // Filter out deal-scoped tools when no deal is active. Keeps the model
  // from hallucinating save_context calls with no place to save them.
  const tools = ctx.deal
    ? UNIVERSAL_CHAT_TOOLS
    : UNIVERSAL_CHAT_TOOLS.filter((t) => t.name !== "save_context" && t.name !== "update_deal_fields" && t.name !== "update_underwriting");

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: userMessage },
  ];

  const response = await getClient().messages.create({
    model: await getActiveModel(),
    max_tokens: 2048,
    system: systemPrompt,
    tools,
    messages,
  });

  let responseText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n")
    .trim();

  if (!responseText) responseText = "Done.";

  const actions: UniversalChatAction[] = [];
  const toolUses = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];

  for (const tool of toolUses) {
    if (tool.name === "save_context" && ctx.deal) {
      const input = tool.input as { note: string; category?: string };
      const category = input.category || "context";
      actions.push({
        type: "context_saved",
        note: input.note,
        category,
        display: `Saved to ${category}: "${input.note.slice(0, 80)}${input.note.length > 80 ? "…" : ""}"`,
      });
    } else if (tool.name === "update_deal_fields" && ctx.deal) {
      const input = tool.input as { updates: Record<string, unknown> };
      const fieldNames = Object.keys(input.updates).join(", ");
      actions.push({
        type: "deal_updated",
        fields: input.updates,
        display: `Updated deal: ${fieldNames}`,
      });
    } else if (tool.name === "update_underwriting" && ctx.deal) {
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
    // Canonical URL to the jurisdiction's zoning page (the actual source,
    // not a Wikipedia / blog link). Used by the UI to deep-link analysts
    // back to the authoritative code.
    source_url: string;
    far: number | null;
    max_height_ft: number | null;
    max_height_stories: number | null;
    lot_coverage_pct: number | null;
    setbacks: { front: number; side: number; rear: number } | null;
    permitted_uses: string[];
    overlays: string[];
    density_bonuses: Array<{ source: string; description: string; additional_density: string }>;
    parking_requirements: string;
    // Per-catalog-program applicability hints keyed by catalog source name.
    // Values: "applies" | "may_apply" | "not_applicable". The UI merges this
    // over any manual user overrides.
    bonus_applicability: Record<string, "applies" | "may_apply" | "not_applicable">;
    // Upcoming state/local legislation or general plan changes that could
    // affect housing density, bonuses, or allowed uses.
    future_legislation: Array<{
      source: string;
      description: string;
      effective_date: string;
      impact: string;
    }>;
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
8. Provide the canonical URL for the jurisdiction's zoning/planning page — this should be the actual municipal or county government page (e.g. city planning department, Municode, eCode360) — NOT a Wikipedia, news, or blog link. If you cannot identify a specific URL with high confidence, return an empty string.
9. For each of the following well-known incentive programs, classify its applicability to THIS specific deal:
     - "CA Density Bonus Law", "SB 35 (CA)", "CCHS (Citywide Commercial-Corridor Housing Services)",
       "LIHTC 9% (100% affordable)", "LIHTC 4% (100% affordable)", "421-a (NYC)", "J-51 (NYC)",
       "Local Inclusionary Zoning", "Opportunity Zone", "HUD 221(d)(4)", "PILOT Agreement", "SB 330 (CA)"
   Use exactly these values: "applies" | "may_apply" | "not_applicable".
   Base the classification on state/city fit (e.g. 421-a is NYC-only, SB 35 is CA-only) and property type.
10. Identify any upcoming legislation or general plan changes (state or local) that could affect housing, density, bonuses, or allowed uses on THIS site within the next 1-3 years. Include pending bills, recent adoption where rules phase in, and upcoming general/specific plan amendments.

Respond with valid JSON only (no markdown):
{
  "structured": {
    "zoning_designation": "<zoning code/district, e.g. M-1, PD-123, C-2>",
    "source_url": "<canonical URL to the jurisdiction's zoning page, or empty string>",
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
    "parking_requirements": "<brief summary>",
    "bonus_applicability": {
      "CA Density Bonus Law": "applies" | "may_apply" | "not_applicable",
      "SB 35 (CA)": "applies" | "may_apply" | "not_applicable"
      /* include one entry for each program in the list above */
    },
    "future_legislation": [
      {
        "source": "<bill number or plan name, e.g. 'AB 1287 (CA)' or '2040 General Plan Update'>",
        "description": "<what the legislation does>",
        "effective_date": "<when it takes effect, e.g. 'Jan 2026' or 'Pending' or 'TBD'>",
        "impact": "<how it could affect this deal>"
      }
    ]
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
        source_url: "",
        far: null,
        max_height_ft: null,
        max_height_stories: null,
        lot_coverage_pct: null,
        setbacks: null,
        permitted_uses: [],
        overlays: [],
        density_bonuses: [],
        parking_requirements: "Unknown",
        bonus_applicability: {},
        future_legislation: [],
      },
      narrative: "Failed to parse zoning analysis. Please try again.",
      sources: [],
    };
  }
}

// ─── Parcel / APN Lookup ──────────────────────────────────────────────────────
//
// Best-effort parcel number (APN) lookup based on the deal address. Returns
// the APN + a URL to the county assessor's parcel page when the model has
// high confidence, otherwise returns nulls. This is surfaced in Site & Zoning
// as an "Auto-fill" button next to the APN field.

export interface ParcelLookup {
  apn: string | null;
  source_url: string | null;
  confidence: "high" | "medium" | "low";
  notes: string;
}

export async function lookupParcelApn(
  address: string,
  city: string,
  state: string,
  county?: string | null
): Promise<ParcelLookup> {
  const fullAddress = [address, city, state].filter(Boolean).join(", ");
  if (!fullAddress) {
    return { apn: null, source_url: null, confidence: "low", notes: "Address is empty." };
  }

  const prompt = `You are a real estate data assistant. Identify the parcel number (APN / Parcel ID / Tax ID) for this property.

PROPERTY:
- Address: ${fullAddress}
- County: ${county || "Unknown — infer from the address"}

Many county assessors publish parcel data publicly. Based on the address, return the most likely APN and the URL to the county assessor's parcel viewer or property detail page.

RULES:
- Respond with valid JSON ONLY (no markdown fences).
- If you are NOT confident in a specific APN for this exact address, set "apn" to null and "confidence" to "low". Do NOT invent an APN — a wrong APN is worse than none.
- Format the APN using the county's canonical format (e.g. "123-456-789" for CA, "1234567890" for NYC, etc.).
- "source_url" should be the county assessor's parcel lookup page (not a real-estate listing site).

{
  "apn": "<APN string or null>",
  "source_url": "<URL to county assessor parcel page, or null>",
  "confidence": "high" | "medium" | "low",
  "notes": "<one-sentence rationale — e.g. 'Los Angeles County APN format confirmed' or 'Unable to locate a specific APN'>"
}`;

  try {
    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "{}";
    const cleaned = text.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      apn: parsed.apn || null,
      source_url: parsed.source_url || null,
      confidence: parsed.confidence || "low",
      notes: parsed.notes || "",
    };
  } catch {
    return {
      apn: null,
      source_url: null,
      confidence: "low",
      notes: "Lookup failed. Check the county assessor's site manually.",
    };
  }
}

// ─── Underwriting Co-Pilot ───────────────────────────────────────────────────
//
// The UW Co-Pilot sidebar has three modes:
//
//   1. Challenge    — reads current UW assumptions + market context and
//                     asks Claude to flag questionable values with concerns
//                     and a suggested value where applicable.
//
//   2. What-If      — accepts a free-text scenario ("what if rents drop 5%
//                     year 1") and returns an analysis + a field-patch
//                     proposal the user can apply with one click.
//
//   3. Benchmarks   — pure data lookup (not Claude), so no function here.

export interface UWChallenge {
  /** UWData field name the concern relates to (e.g. "vacancy_rate"). */
  field: string;
  /** Current value as a human-readable string for the UI. */
  current_value: string;
  /** Severity so the UI can color the row. */
  severity: "low" | "medium" | "high";
  /** What's questionable — shown prominently. */
  concern: string;
  /** What the analyst should do about it. */
  suggestion: string;
  /** Optional numeric proposal the user can one-click apply. */
  suggested_value: number | null;
}

const CHALLENGE_PROMPT = `You are a senior real estate investment committee member reviewing a junior analyst's underwriting model. Your job is to challenge assumptions that look aggressive, conservative, or inconsistent with the market context.

Focus on the top 3-8 most important concerns. Ignore minor stuff. Do NOT compliment the analyst — this is a stress test, not a review.

Return ONLY a JSON array of objects with exactly these fields:

[
  {
    "field": "<UWData field name — must match one of the fields in the model>",
    "current_value": "<human-readable current value, e.g. '4.0%' or '$2,400,000'>",
    "severity": "low" | "medium" | "high",
    "concern": "<one-sentence description of what's questionable>",
    "suggestion": "<one-sentence recommendation — what the analyst should do>",
    "suggested_value": <optional numeric value the analyst could switch to, or null>
  }
]

Concentrate on:
- Vacancy rate, rent growth, expense growth vs market norms
- Cap rate spread (in-place vs exit) — flat or inverted spreads are red flags
- Expense ratio vs property type benchmark (multifamily ~40-50%, industrial NNN <15%)
- OpEx line items: property taxes that look too low for state, insurance missing
- LTC / LTV levels for the business plan (value-add should be 70-80%, core 60-65%)
- Management fee (multifamily typically 3-5% of EGR, commercial 2-4%)
- Per-unit figures that look off (taxes/unit, insurance/unit)
- Unit-mix rents vs market rents — aggressive assumed bumps

Rules:
- JSON array only. No markdown fences. No preamble. No trailing text.
- Every concern must reference an actual field from the UWData object.
- If the model looks solid with no real concerns, return [].
- suggested_value must be a NUMBER (not a string). Use null if no precise value can be suggested.`;

export async function challengeUnderwriting(
  uwData: Record<string, unknown>,
  context: {
    deal?: Record<string, unknown> | null;
    market?: Record<string, unknown> | null;
    metrics?: Record<string, unknown> | null;
  }
): Promise<UWChallenge[]> {
  try {
    const ctxLines: string[] = [];
    if (context.deal) {
      const d = context.deal;
      ctxLines.push(`DEAL: ${d.name ?? ""} — ${d.property_type ?? ""} in ${d.city ?? ""}, ${d.state ?? ""}`);
      if (d.asking_price) ctxLines.push(`Asking price: $${Number(d.asking_price).toLocaleString()}`);
      if (d.units) ctxLines.push(`Units: ${d.units}`);
      if (d.square_footage) ctxLines.push(`SF: ${Number(d.square_footage).toLocaleString()}`);
      if (d.year_built) ctxLines.push(`Year built: ${d.year_built}`);
    }
    if (context.market) {
      const m = context.market;
      ctxLines.push(`\nMARKET CONTEXT:`);
      if (m.submarket_name) ctxLines.push(`Submarket: ${m.submarket_name}`);
      if (m.market_cap_rate != null) ctxLines.push(`Market cap rate: ${m.market_cap_rate}%`);
      if (m.market_vacancy != null) ctxLines.push(`Market vacancy: ${m.market_vacancy}%`);
      if (m.market_rent_growth != null) ctxLines.push(`Rent growth: ${m.market_rent_growth}%/yr`);
      // Location intelligence (demographics, housing, employment)
      if (m._locationIntel) ctxLines.push(`\n${m._locationIntel}`);
    }
    if (context.metrics) {
      const m = context.metrics;
      ctxLines.push(`\nCOMPUTED METRICS:`);
      for (const [k, v] of Object.entries(m)) {
        if (v == null || typeof v === "object") continue;
        ctxLines.push(`${k}: ${v}`);
      }
    }

    const prompt = `${ctxLines.join("\n")}

CURRENT UNDERWRITING MODEL:
${JSON.stringify(uwData, null, 2)}

${CHALLENGE_PROMPT}`;

    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    });

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "[]";
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]) as UWChallenge[];
    if (!Array.isArray(parsed)) return [];

    // Sanity-clean each concern
    return parsed.filter(
      (c) =>
        c &&
        typeof c.field === "string" &&
        typeof c.concern === "string" &&
        (c.severity === "low" || c.severity === "medium" || c.severity === "high")
    );
  } catch (err) {
    console.error("challengeUnderwriting failed:", err);
    return [];
  }
}

export interface WhatIfResult {
  analysis: string;
  field_changes: Record<string, number>;
  key_impacts: Array<{ metric: string; before: string; after: string }>;
}

const WHATIF_PROMPT = `You are a CRE underwriting assistant helping an analyst explore a scenario. The analyst's question is at the end.

Your job: propose a concrete field-level patch to the underwriting model that answers the scenario, and explain what changes + the key impacts.

Return ONLY a JSON object with exactly this shape:

{
  "analysis": "<2-4 sentence explanation of the scenario and what you're changing>",
  "field_changes": {
    "<UWData field>": <number>,
    "<UWData field>": <number>
  },
  "key_impacts": [
    { "metric": "<metric name>", "before": "<value string>", "after": "<value string>" }
  ]
}

Rules:
- JSON object only. No markdown fences. No preamble.
- field_changes must only use actual UWData fields.
- field_changes values must be NUMBERS (not strings).
- If the scenario doesn't map to any field changes (e.g. "what's my DSCR?" which is purely computed), return field_changes: {} and put the explanation in analysis.
- Keep analysis under 4 sentences — the UI displays it inline.
- 3-5 key_impacts max, showing the metrics that change most materially.`;

// ─── Document Version Diff ───────────────────────────────────────────────
//
// Used by the Document Intelligence Pipeline to summarize what changed
// between two versions of the same document (rent roll v2 → v3, PSA
// redline, loan term sheet update, etc.). Works against the extracted
// content_text of each version.

export interface DocDiffResult {
  summary: string;          // 1-2 sentence headline
  changes: Array<{
    severity: "material" | "minor" | "informational";
    change: string;         // one-sentence description
  }>;
  no_material_changes: boolean;
}

const DOC_DIFF_PROMPT = `You are a CRE analyst comparing two versions of a document that's part of an active deal. Summarize what changed — focus on material changes (money, dates, parties, contingencies, unit counts, rent levels), not formatting tweaks or paragraph reordering.

Return ONLY a JSON object with exactly this shape:

{
  "summary": "<one-sentence headline change>",
  "no_material_changes": false,
  "changes": [
    {
      "severity": "material" | "minor" | "informational",
      "change": "<one-sentence description>"
    }
  ]
}

Severity guide:
- material: a change the analyst must bring to IC (price/rent/units/cap rate, removed contingency, new tenant, etc.)
- minor: a change worth noting but not material to the deal thesis
- informational: cosmetic / typo / formatting only

If the two versions are substantively identical, set no_material_changes: true, changes: [], summary: "No material changes detected."

Rules:
- JSON only, no markdown fences, no preamble.
- 3-10 entries max in the changes array.
- Be specific — reference actual numbers / names / dates from the documents when you can.`;

export async function diffDocumentVersions(
  previousText: string,
  currentText: string,
  context: {
    category?: string;
    previous_name?: string;
    current_name?: string;
    previous_version?: number;
    current_version?: number;
  } = {}
): Promise<DocDiffResult | null> {
  if (!previousText.trim() && !currentText.trim()) return null;

  const MAX = 14000;
  const prev = previousText.slice(0, MAX);
  const curr = currentText.slice(0, MAX);

  const header = `Document category: ${context.category || "unknown"}\n${context.previous_name ? `Previous: ${context.previous_name} (v${context.previous_version ?? "?"})` : ""}\n${context.current_name ? `Current: ${context.current_name} (v${context.current_version ?? "?"})` : ""}\n`;

  const prompt = `${header}

===== PREVIOUS VERSION =====
${prev || "(empty document — no extracted text)"}

===== CURRENT VERSION =====
${curr || "(empty document — no extracted text)"}

${DOC_DIFF_PROMPT}`;

  try {
    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
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

    const parsed = JSON.parse(match[0]) as DocDiffResult;
    if (!Array.isArray(parsed.changes)) parsed.changes = [];
    if (typeof parsed.summary !== "string") parsed.summary = "";
    if (typeof parsed.no_material_changes !== "boolean")
      parsed.no_material_changes = parsed.changes.length === 0;
    return parsed;
  } catch (err) {
    console.error("diffDocumentVersions failed:", err);
    return null;
  }
}

export async function analyzeWhatIf(
  uwData: Record<string, unknown>,
  question: string,
  context: {
    deal?: Record<string, unknown> | null;
    metrics?: Record<string, unknown> | null;
  }
): Promise<WhatIfResult | null> {
  if (!question || question.trim().length < 3) return null;
  try {
    const ctxLines: string[] = [];
    if (context.deal) {
      const d = context.deal;
      ctxLines.push(`DEAL: ${d.name ?? ""} (${d.property_type ?? "other"})`);
    }
    if (context.metrics) {
      ctxLines.push(`\nCURRENT COMPUTED METRICS:`);
      for (const [k, v] of Object.entries(context.metrics)) {
        if (v == null || typeof v === "object") continue;
        ctxLines.push(`${k}: ${v}`);
      }
    }

    const prompt = `${ctxLines.join("\n")}

CURRENT UNDERWRITING MODEL:
${JSON.stringify(uwData, null, 2)}

ANALYST'S SCENARIO:
${question.trim()}

${WHATIF_PROMPT}`;

    const response = await getClient().messages.create({
      model: await getActiveModel(),
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
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

    const parsed = JSON.parse(match[0]) as WhatIfResult;
    if (
      typeof parsed.analysis !== "string" ||
      typeof parsed.field_changes !== "object"
    ) {
      return null;
    }
    if (!Array.isArray(parsed.key_impacts)) parsed.key_impacts = [];
    // Sanity-clean field_changes: drop non-numeric
    const cleanChanges: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed.field_changes || {})) {
      if (typeof v === "number" && Number.isFinite(v)) cleanChanges[k] = v;
    }
    parsed.field_changes = cleanChanges;

    return parsed;
  } catch (err) {
    console.error("analyzeWhatIf failed:", err);
    return null;
  }
}
