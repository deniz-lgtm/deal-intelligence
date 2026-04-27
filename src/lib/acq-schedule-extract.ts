/**
 * Extracts acquisition-stage dates from a deal-side document into a
 * structured list of Acquisition-track phase updates.
 *
 * Source documents the analyst typically uploads here:
 *   - LOI (Letter of Intent) — proposed signing date, DD period, closing
 *     target.
 *   - PSA (Purchase & Sale Agreement) — signed date, DD end, escrow,
 *     closing date with extensions.
 *   - Broker marketing schedule / call-for-offers memo — tour dates,
 *     bid deadline, expected go-hard.
 *   - Email correspondence / negotiation timeline — informal date asks.
 *
 * The extractor is intentionally schema-bound to our seven default
 * Acquisition phases (see DEFAULT_ACQ_PHASES). The model maps free-text
 * dates onto those phase_keys; the commit endpoint matches them to
 * existing rows on the deal (PATCH the date) or creates the row if
 * missing. Anything outside that schema lands as a free-form proposal
 * the analyst can still accept — we don't drop it.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/** The seven phase keys we know how to seed onto the Acq track. */
export const ACQ_PHASE_KEYS = [
  "acq_call_for_offers",
  "acq_site_walk",
  "acq_loi_signed",
  "acq_psa_executed",
  "acq_dd_period",
  "acq_escrow",
  "acq_closing",
] as const;
export type AcqPhaseKey = (typeof ACQ_PHASE_KEYS)[number];

export interface ExtractedAcqPhase {
  /** Canonical phase key when the row maps onto a known Acq phase. */
  phase_key: AcqPhaseKey | string;
  /** Human-readable label as shown to the analyst. Falls back to the
   *  default phase label when phase_key is canonical. */
  label: string;
  /** ISO YYYY-MM-DD; null when the document doesn't pin a date. */
  start_date: string | null;
  /** Duration in days; 0 for milestones (LOI signed, closing). */
  duration_days: number;
  /** Verbatim quote from the source doc — surfaced in the preview UI so
   *  the analyst can sanity-check the model's interpretation. */
  source_quote: string | null;
  /** Confidence of the extraction. low/medium values are flagged in the
   *  UI; high ones come pre-checked. */
  confidence: "high" | "medium" | "low";
}

const SYSTEM_PROMPT = `You extract acquisition-stage dates from real-estate deal documents (LOI, PSA, broker marketing schedule, negotiation emails) into a structured JSON array.

The target schedule has these seven canonical phases, in order:
- acq_call_for_offers   ("Call for Offers")        — milestone (duration 0)
- acq_site_walk         ("Site Walk")              — milestone (duration 0)
- acq_loi_signed        ("LOI Signed")             — milestone (duration 0)
- acq_psa_executed      ("PSA Executed")           — typically a window (PSA negotiation period before signature)
- acq_dd_period         ("Diligence Period")       — duration in days; ends at "go-hard" / earnest money becoming non-refundable
- acq_escrow            ("Escrow")                 — duration from DD end to close
- acq_closing           ("Closing")                — milestone (duration 0)

Return JSON only, matching exactly this shape:
{
  "phases": [
    {
      "phase_key": "<one of the seven canonical keys, OR a snake_case slug for non-canonical events>",
      "label": "<human-readable label as shown in the document>",
      "start_date": "YYYY-MM-DD or null if not pinned",
      "duration_days": <integer days; 0 for milestones>,
      "source_quote": "<short verbatim quote from the doc that pins this date, or null>",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Rules:
- Only emit phases where you have evidence in the document. Don't pad the list to seven entries.
- Prefer canonical phase_keys when you can match the event. Map "earnest money becomes non-refundable", "DD ends", "go-hard" all onto acq_dd_period (its end date = start_date + duration_days).
- Conventions:
  - LOI signed → acq_loi_signed (milestone, duration 0).
  - "PSA executed" / "definitive agreement signed" → acq_psa_executed milestone. If the doc gives a target window (e.g. "PSA within 14 days"), set duration_days = 14 with start_date null (the analyst's existing acq_loi_signed feeds the predecessor).
  - DD period: extract as one row keyed acq_dd_period. start_date is when DD begins (typically PSA execution), duration_days is the DD length in days. If the doc only states the DD end date, set duration_days = 0 and use start_date as that end date — the analyst will reconcile.
  - "Escrow" / "closing in N days from DD end" → acq_escrow with that duration.
  - "Closing on/by <date>" → acq_closing milestone with start_date.
- For events outside the canonical seven (price negotiation rounds, financing contingency expiry, lender deadlines), use a snake_case phase_key like "financing_contingency_expiry" — these become free-form rows the analyst can accept or skip.
- source_quote should be ≤ 150 chars and verbatim from the document. If the date is implied rather than stated, use null.
- Confidence: high = explicit date in the doc; medium = derived from a range or "by X" language; low = inferred.
- If a date is ambiguous (month-only, "spring 2026", fiscal quarters), set start_date to null and confidence to low rather than guessing.

Return only the JSON object — no markdown fences, no commentary.`;

async function withRetry<T>(fn: () => Promise<T>, attempts = 2, baseDelayMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

const ACQ_KEY_SET = new Set<string>(ACQ_PHASE_KEYS);

/**
 * Map common phase-name synonyms onto canonical keys. The model
 * usually obeys the system prompt's mapping rules but occasionally
 * coins its own snake_case keys (`inspection_period`, `closing_date`)
 * for events that should be canonical. This post-processor catches
 * those before they land as free-form custom phases — without it,
 * the Acq schedule shows duplicate canonical+custom rows for the
 * same milestone and the imported chain breaks.
 */
const PHASE_KEY_SYNONYMS: Record<string, AcqPhaseKey> = {
  // DD / inspection / due-diligence variants
  inspection: "acq_dd_period",
  inspection_period: "acq_dd_period",
  due_diligence: "acq_dd_period",
  due_diligence_period: "acq_dd_period",
  dd: "acq_dd_period",
  dd_period: "acq_dd_period",
  diligence: "acq_dd_period",
  contingency_period: "acq_dd_period",
  feasibility_period: "acq_dd_period",
  // Closing variants
  close: "acq_closing",
  closing_date: "acq_closing",
  close_of_escrow: "acq_closing",
  coe: "acq_closing",
  // Escrow variants
  escrow_period: "acq_escrow",
  // PSA variants
  psa: "acq_psa_executed",
  psa_signed: "acq_psa_executed",
  contract_executed: "acq_psa_executed",
  definitive_agreement: "acq_psa_executed",
  // LOI variants
  loi: "acq_loi_signed",
  letter_of_intent: "acq_loi_signed",
  // Site walk
  tour: "acq_site_walk",
  site_visit: "acq_site_walk",
  property_tour: "acq_site_walk",
  // Call for offers
  cfo: "acq_call_for_offers",
  bid_deadline: "acq_call_for_offers",
  offer_deadline: "acq_call_for_offers",
};

function normalizePhaseKey(key: string): string {
  if (ACQ_KEY_SET.has(key)) return key;
  return PHASE_KEY_SYNONYMS[key] ?? key;
}

function parseResponse(text: string): ExtractedAcqPhase[] {
  let payload = text.trim();
  if (payload.startsWith("```")) {
    payload = payload.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  const firstBrace = payload.indexOf("{");
  if (firstBrace > 0) payload = payload.slice(firstBrace);
  const obj = JSON.parse(payload) as { phases?: unknown };
  if (!obj || !Array.isArray(obj.phases)) {
    throw new Error("Model response missing `phases` array");
  }
  const seenKeys = new Set<string>();
  const rows: ExtractedAcqPhase[] = [];
  for (const raw of obj.phases) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!label) continue;
    let key = typeof r.phase_key === "string" && r.phase_key.trim()
      ? r.phase_key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
      : label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!key) key = `acq_event_${rows.length + 1}`;
    // Normalize synonyms onto canonical keys so the importer doesn't
    // create duplicate canonical+custom rows for the same event.
    key = normalizePhaseKey(key);
    // De-dup non-canonical keys; canonical ones we leave alone (the
    // commit endpoint takes the first-row-wins for each canonical
    // phase, since semantically there's one of each per deal).
    if (!ACQ_KEY_SET.has(key)) {
      let dedup = key;
      let i = 2;
      while (seenKeys.has(dedup)) { dedup = `${key}_${i++}`; }
      key = dedup;
    } else if (seenKeys.has(key)) {
      continue; // skip duplicate canonical
    }
    seenKeys.add(key);

    const start = typeof r.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.start_date)
      ? r.start_date
      : null;
    const dur = typeof r.duration_days === "number" && Number.isFinite(r.duration_days)
      ? Math.max(0, Math.round(r.duration_days))
      : 0;
    const quote = typeof r.source_quote === "string" && r.source_quote.trim()
      ? r.source_quote.trim().slice(0, 200)
      : null;
    const conf =
      r.confidence === "high" || r.confidence === "medium" || r.confidence === "low"
        ? r.confidence
        : "low";

    rows.push({
      phase_key: key as AcqPhaseKey | string,
      label,
      start_date: start,
      duration_days: dur,
      source_quote: quote,
      confidence: conf,
    });
  }
  return rows;
}

/**
 * Extract acquisition-stage dates from a document buffer. Accepts PDF
 * (parsed via pdf-parse) or plain text. Returns an empty array if the
 * extraction fails — the route handler treats that as a "no dates
 * found" state.
 */
export async function extractAcqSchedule(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractedAcqPhase[]> {
  let rawText = "";
  if (mimeType === "application/pdf" || mimeType.endsWith("/pdf")) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      rawText = (parsed.text || "").replace(/\x00/g, "").replace(/[�]/g, "");
    } catch (e) {
      console.error("acq-schedule-extract: pdf-parse failed:", e);
      return [];
    }
  } else {
    // Plain text / DOCX exported as text / email body. Strip null bytes
    // and replacement chars the same way we do for PDFs.
    rawText = buffer.toString("utf8").replace(/\x00/g, "").replace(/[�]/g, "");
  }
  if (!rawText.trim()) return [];

  // LOIs and PSAs aren't gigantic but term sheets with redlines + email
  // chains can be. Keep the head — the dates we want live in the
  // boilerplate-light front matter / signature block.
  const MAX_CHARS = 60_000;
  const text = rawText.length > MAX_CHARS ? rawText.slice(0, MAX_CHARS) : rawText;

  const client = getClient();
  const result = await withRetry(async () => {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract the acquisition-stage dates from this document:\n\n${text}`,
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text in model response");
    return block.text;
  });

  try {
    return parseResponse(result);
  } catch (e) {
    console.error("acq-schedule-extract: JSON parse failed:", e);
    return [];
  }
}
