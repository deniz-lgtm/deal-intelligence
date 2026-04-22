// AI Deal Sourcing Inbox — Dropbox folder polling + auto-ingest.
//
// Flow (see /inbox page + POST /api/inbox/poll):
//
//   1. Load the current Dropbox account + watched folder path
//   2. List files in that folder via the existing Dropbox client
//   3. For each file that (a) is a supported type, (b) hasn't already been
//      ingested (dedupe by full Dropbox path against deals.ingested_from_path):
//      - Download the file
//      - Upload to blob storage
//      - Extract PDF text
//      - Run stage-1 OM extraction synchronously so the inbox card has a
//        real name / address / price immediately
//      - Create a deal in the `sourcing` stage with the extracted fields,
//        auto_ingested=true, ingested_from_path=the Dropbox path. The
//        default business plan (if any) is attached as a starting
//        suggestion — the user can change it from the inbox card.
//      - Create a document row linked to the deal
//   4. Update dropbox_accounts.last_polled_at
//   5. Return a summary for the UI
//
// The full OM analysis (red flags, deal score, summary, recommendations)
// does NOT run here. The inbox page shows extracted property info plus
// three required inputs — business plan, property type, investment
// strategy — and a "Start Analysis" button. Clicking it hits
// POST /api/inbox/items/[id]/start which calls `startInboxAnalysis` below
// to persist the user's selections, transition the deal to `screening`,
// create the om_analyses row, and kick off the full 4-stage pipeline in
// the background.

import { v4 as uuidv4 } from "uuid";
import path from "path";
import {
  dealQueries,
  documentQueries,
  dropboxQueries,
  omAnalysisQueries,
  businessPlanQueries,
  type BusinessPlanRow,
} from "./db";
import {
  listFolder,
  downloadFile,
  refreshAccessToken,
  isSupportedFile,
  guessMimeType,
  DropboxEntry,
} from "./dropbox";
import { uploadBlob, readFile as readBlob } from "./blob-storage";
import { extractMetrics, extractOmFull } from "./om-extraction";

export interface IngestedItem {
  id: string;
  name: string;
  address: string | null;
  asking_price: number | null;
  source_path: string;
}

export interface PollResult {
  checked: number;
  ingested: number;
  skipped_duplicate: number;
  skipped_unsupported: number;
  errors: number;
  error_messages: string[];
  new_items: IngestedItem[];
}

export interface PollError {
  kind:
    | "not_connected"
    | "no_folder_configured"
    | "list_failed";
  message: string;
}

async function extractPdfText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType !== "application/pdf") return "";
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return (data.text || "").replace(/\x00/g, "").replace(/[\uFFFD]/g, "");
  } catch {
    return "";
  }
}

/**
 * Best-effort parse of a single-line address into
 * { street, city, state, zip }. Very lightweight — if the address doesn't
 * follow a "STREET, CITY, ST ZIP" pattern we return the whole thing as
 * `street` and leave the rest blank. The user can fix during review.
 */
function parseAddress(
  full: string | null
): { street: string; city: string; state: string; zip: string } {
  if (!full) return { street: "", city: "", state: "", zip: "" };
  const trimmed = full.trim();
  // Pattern: "street, city, ST ZIP" or "street, city, ST"
  const m = trimmed.match(
    /^(.+?),\s*([^,]+?),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/
  );
  if (m) {
    return {
      street: m[1].trim(),
      city: m[2].trim(),
      state: m[3].trim(),
      zip: m[4]?.trim() ?? "",
    };
  }
  return { street: trimmed, city: "", state: "", zip: "" };
}

/**
 * Runs one polling pass. Safe to call repeatedly — dedupes against
 * deals.ingested_from_path so re-running on the same folder is a no-op.
 *
 * `userId` (when provided) is used to look up the user's default business
 * plan, which is passed as `deal_context` to the background OM analysis so
 * red flags + scoring are calibrated to the investor's strategy.
 */
export async function pollDropboxInbox(
  userId?: string
): Promise<PollResult | PollError> {
  const account = await dropboxQueries.get();
  if (!account) {
    return { kind: "not_connected", message: "Dropbox is not connected." };
  }
  const watchedPath = account.watched_folder_path;
  if (!watchedPath) {
    return {
      kind: "no_folder_configured",
      message:
        "No watched folder is configured. Pick a Dropbox folder from the Inbox settings.",
    };
  }

  // Load the default business plan once per poll (best-effort) so each
  // background analysis can be calibrated to the user's strategy.
  let defaultPlan: BusinessPlanRow | null = null;
  try {
    defaultPlan = await businessPlanQueries.getDefault(userId);
  } catch (err) {
    console.warn("Inbox poll: failed to load default business plan:", err);
  }

  // List folder contents — refresh the token on 401
  let accessToken = account.access_token;
  let entries: DropboxEntry[];
  try {
    entries = await listFolder(accessToken, watchedPath);
  } catch {
    if (!account.refresh_token) {
      return {
        kind: "list_failed",
        message: "Dropbox token expired and no refresh token on file.",
      };
    }
    try {
      const refreshed = await refreshAccessToken(account.refresh_token);
      accessToken = refreshed.access_token;
      await dropboxQueries.updateToken(accessToken);
      entries = await listFolder(accessToken, watchedPath);
    } catch (err) {
      return {
        kind: "list_failed",
        message:
          err instanceof Error ? err.message : "Failed to list Dropbox folder",
      };
    }
  }

  const files = entries.filter((e) => e[".tag"] === "file");

  const result: PollResult = {
    checked: files.length,
    ingested: 0,
    skipped_duplicate: 0,
    skipped_unsupported: 0,
    errors: 0,
    error_messages: [],
    new_items: [],
  };

  for (const entry of files) {
    if (!isSupportedFile(entry.name)) {
      result.skipped_unsupported++;
      continue;
    }

    // Dedupe: skip if this exact Dropbox path was already ingested
    if (await dealQueries.ingestedPathExists(entry.path_display)) {
      result.skipped_duplicate++;
      continue;
    }

    try {
      const ingested = await ingestSingleFile(entry, accessToken, defaultPlan, userId);
      if (ingested) {
        result.ingested++;
        result.new_items.push(ingested);
      }
    } catch (err) {
      console.error(`Inbox ingest failed for ${entry.path_display}:`, err);
      result.errors++;
      const msg =
        err instanceof Error
          ? `${entry.name}: ${err.message}`
          : `${entry.name}: unknown error`;
      result.error_messages.push(msg);
    }
  }

  await dropboxQueries.touchLastPolledAt();
  return result;
}

/**
 * Build the `deal_context` string for an OM analysis from a business
 * plan. Mirrors the format used by the manual "new deal" flow so the
 * auto-ingested deals get the same strategy-aware analysis quality.
 */
function buildDealContext(plan: BusinessPlanRow | null): string | undefined {
  if (!plan) return undefined;
  const parts: string[] = [`BASE BUSINESS PLAN — ${plan.name}:`];
  if ((plan.investment_theses || []).length > 0) {
    parts.push(
      `Investment Thesis: ${plan.investment_theses
        .map((t) => t.replace(/_/g, " "))
        .join(", ")}`
    );
  }
  if ((plan.target_markets || []).length > 0) {
    parts.push(`Target Markets: ${plan.target_markets.join(", ")}`);
  }
  if ((plan.property_types || []).length > 0) {
    parts.push(`Property Types: ${plan.property_types.join(", ")}`);
  }
  if (plan.target_irr_min != null || plan.target_irr_max != null) {
    parts.push(
      `Target IRR: ${plan.target_irr_min ?? "?"}% – ${plan.target_irr_max ?? "?"}%`
    );
  }
  if (plan.hold_period_min != null || plan.hold_period_max != null) {
    parts.push(
      `Hold Period: ${plan.hold_period_min ?? "?"}–${plan.hold_period_max ?? "?"} years`
    );
  }
  if (plan.description?.trim()) {
    parts.push(`Strategy Notes: ${plan.description.trim()}`);
  }
  return parts.length > 1 ? parts.join("\n") : undefined;
}

/**
 * Download a single Dropbox file, upload to blob storage, run stage-1
 * OM extraction for the inbox card display, and create the deal +
 * document rows in `sourcing` state. Does NOT start the full analysis
 * — that waits for the user to confirm business plan + property type
 * + investment strategy from the inbox card and click Start Analysis.
 * Throws on any unrecoverable error; the caller captures it in the
 * PollResult.
 */
async function ingestSingleFile(
  entry: DropboxEntry,
  accessToken: string,
  defaultPlan: BusinessPlanRow | null,
  ownerUserId?: string
): Promise<IngestedItem | null> {
  // Download
  const { buffer, metadata } = await downloadFile(
    accessToken,
    entry.path_display
  );

  // Refuse to ingest empty or tiny files (bounce-backs, 0-byte uploads, etc.)
  if (buffer.length < 256) {
    throw new Error("File too small to be a usable OM");
  }

  // Upload to blob storage under a fresh deal-scoped path. We generate the
  // deal id first so the blob path is stable.
  const dealId = uuidv4();
  const docId = uuidv4();
  const ext = path.extname(metadata.name);
  const blobPath = `${dealId}/${docId}${ext}`;
  const mimeType = guessMimeType(metadata.name);
  const fileUrl = await uploadBlob(blobPath, buffer, mimeType);

  // Extract PDF text (used by stage-1 extractor as a fallback + stored on
  // the document row so the OM Q&A feature works without re-parsing).
  const contentText = await extractPdfText(buffer, mimeType);

  // Stage-1 OM extraction: property_details + financial_metrics. We run
  // this synchronously so the inbox card has a real name / address / price
  // the moment the poll returns. The heavier stages 2-4 (red flags, score,
  // summary, recommendations) run in the background below and don't block
  // the poll.
  let stage1: Awaited<ReturnType<typeof extractMetrics>> | null = null;
  try {
    stage1 = await extractMetrics(
      contentText,
      mimeType === "application/pdf" ? buffer : undefined
    );
  } catch (err) {
    console.warn(
      `Inbox stage-1 extraction failed for ${entry.name} (creating deal anyway):`,
      err
    );
  }

  // Build the deal payload from the extraction output (with sensible
  // fallbacks when a field is missing). We prefer the street address
  // as the deal name — it's the most useful identifier at a glance in
  // the inbox — and only fall back to the extracted property name or
  // filename when no address is available.
  const addressParts = parseAddress(stage1?.property_details.address ?? null);
  const derivedName =
    addressParts.street ||
    stage1?.property_details.name ||
    metadata.name.replace(ext, "").slice(0, 200);

  const dealPayload: Record<string, unknown> = {
    id: dealId,
    name: derivedName,
    address: addressParts.street,
    city: addressParts.city,
    state: addressParts.state,
    zip: addressParts.zip,
    property_type: stage1?.property_details.property_type || "other",
    // Land the deal in `sourcing` — analysis hasn't started yet. The
    // inbox card will ask the user to confirm business plan + property
    // type + investment strategy, then clicking Start Analysis
    // transitions the deal to `screening` and kicks off the full OM
    // analysis. See POST /api/inbox/items/[id]/start.
    status: "sourcing",
    starred: false,
    asking_price: stage1?.financial_metrics.asking_price ?? null,
    square_footage: stage1?.property_details.sf ?? null,
    units: stage1?.property_details.unit_count ?? null,
    year_built: stage1?.property_details.year_built ?? null,
    notes: `Auto-ingested from Dropbox (${entry.path_display})`,
    loi_executed: false,
    psa_executed: false,
  };
  if (defaultPlan?.id) {
    dealPayload.business_plan_id = defaultPlan.id;
  }

  await dealQueries.create(dealPayload);

  // Flag it as auto-ingested and stamp ownership. Without owner_id the
  // access gate on /api/inbox/items/[id]/start (requireDealAccess)
  // rejects the deal with "Deal not found" even though the inbox list
  // still surfaces it — producing a confusing UX where polling appears
  // to work but Start Analysis doesn't.
  await dealQueries.update(dealId, {
    auto_ingested: true,
    ingested_from_path: entry.path_display,
    ...(ownerUserId ? { owner_id: ownerUserId } : {}),
  });

  // Create the linked document record. The OM stays categorized as
  // "om" so it's easy to find from Start Analysis later.
  const docBaseName = metadata.name.replace(ext, "").slice(0, 200);
  await documentQueries.create({
    id: docId,
    deal_id: dealId,
    name: docBaseName,
    original_name: metadata.name,
    category: "om",
    file_path: fileUrl,
    file_size: buffer.length,
    mime_type: mimeType,
    content_text: contentText || null,
    ai_summary: null,
    ai_tags: null,
  });

  // NOTE: We deliberately do NOT create an om_analyses row or kick off
  // the full 4-stage pipeline here. Analysis only starts after the user
  // confirms business plan + property type + investment strategy from
  // the inbox card (POST /api/inbox/items/[id]/start).

  return {
    id: dealId,
    name: derivedName,
    address: stage1?.property_details.address ?? null,
    asking_price: stage1?.financial_metrics.asking_price ?? null,
    source_path: entry.path_display,
  };
}

export interface StartInboxAnalysisInput {
  dealId: string;
  businessPlanId: string;
  propertyType: string;
  investmentStrategy: string;
}

export interface StartInboxAnalysisResult {
  analysisId: string;
}

/**
 * Called when the user confirms business plan + property type +
 * investment strategy on an inbox card and clicks Start Analysis.
 *
 *   1. Validate the deal is an auto-ingested inbox item
 *   2. Locate the OM document for the deal
 *   3. Persist the user's selections on the deal and transition it to
 *      `screening` (initial review)
 *   4. Create an om_analyses row with status='processing'
 *   5. Kick off the full 4-stage analysis in the background, using the
 *      selected business plan as `deal_context` so red flags + scoring
 *      are calibrated to the investor's strategy
 *
 * Returns the analysis id so the caller can redirect the user to the
 * OM analysis page where the processing state is shown live.
 */
export async function startInboxAnalysis(
  input: StartInboxAnalysisInput
): Promise<StartInboxAnalysisResult> {
  const { dealId, businessPlanId, propertyType, investmentStrategy } = input;

  const deal = await dealQueries.getById(dealId);
  if (!deal) throw new Error("Deal not found");
  if (!deal.auto_ingested) {
    throw new Error("Deal is not an auto-ingested inbox item");
  }

  // Locate the OM document (inbox ingest always creates one with
  // category='om', but we fall back to any document on the deal if
  // something's off).
  const docs = await documentQueries.getByDealId(dealId);
  const omDoc =
    docs.find((d: Record<string, unknown>) => d.category === "om") ||
    docs[0];
  if (!omDoc) {
    throw new Error("No OM document found for this inbox item");
  }

  // Load the business plan for deal_context. We require a plan for
  // inbox-analysis-start because the whole point of the confirmation
  // step is to calibrate analysis to the strategy.
  const plan = await businessPlanQueries.getById(businessPlanId);
  if (!plan) throw new Error("Business plan not found");

  // Persist the user's selections on the deal and move it to screening.
  await dealQueries.update(dealId, {
    business_plan_id: businessPlanId,
    property_type: propertyType,
    investment_strategy: investmentStrategy,
    status: "screening",
  });

  // Create the analysis row upfront so the om-analysis page can render
  // a live processing state the moment the user lands there.
  const analysisRow = await omAnalysisQueries.create(
    dealId,
    omDoc.id as string
  );

  // Kick off stages 1–4 in the background so the HTTP response is
  // snappy. Matches the pattern used by /api/deals/[id]/om-init.
  runBackgroundFullAnalysis({
    analysisId: analysisRow.id,
    dealId,
    documentId: omDoc.id as string,
    filePath: omDoc.file_path as string,
    pdfText: (omDoc.content_text as string | null) ?? "",
    mimeType: (omDoc.mime_type as string | null) ?? "application/pdf",
    dealContext: buildDealContext(plan),
  }).catch((err) => console.error("startInboxAnalysis BG failed:", err));

  return { analysisId: analysisRow.id };
}

/**
 * Runs the full 4-stage OM pipeline and persists results on the
 * om_analyses row + relevant deal fields. Matches the post-ingest
 * logic in /api/deals/[id]/om-init so inbox-ingested deals end up
 * looking identical to manually-uploaded ones.
 */
async function runBackgroundFullAnalysis(args: {
  analysisId: string;
  dealId: string;
  documentId: string;
  filePath: string;
  pdfText: string;
  mimeType: string;
  dealContext: string | undefined;
}): Promise<void> {
  const {
    analysisId,
    dealId,
    documentId,
    filePath,
    pdfText,
    mimeType,
    dealContext,
  } = args;

  try {
    // Reload the PDF buffer from blob storage. extractOmFull's stage-1
    // prefers the native PDF document block over extracted text.
    let pdfBuffer: Buffer | undefined = undefined;
    if (mimeType === "application/pdf") {
      const buf = await readBlob(filePath);
      if (buf) pdfBuffer = buf;
    }

    const full = await extractOmFull(pdfText, dealContext, pdfBuffer);

    await omAnalysisQueries.setResult(analysisId, {
      document_id: documentId,
      status: "complete",
      deal_context: dealContext ?? null,
      property_name: full.property_details.name,
      address: full.property_details.address,
      property_type: full.property_details.property_type,
      year_built: full.property_details.year_built,
      sf: full.property_details.sf,
      unit_count: full.property_details.unit_count,
      asking_price: full.financial_metrics.asking_price,
      noi: full.financial_metrics.noi,
      cap_rate: full.financial_metrics.cap_rate,
      grm: full.financial_metrics.grm,
      cash_on_cash: full.financial_metrics.cash_on_cash,
      irr: full.financial_metrics.irr,
      equity_multiple: full.financial_metrics.equity_multiple,
      dscr: full.financial_metrics.dscr,
      vacancy_rate: full.financial_metrics.vacancy_rate,
      expense_ratio: full.financial_metrics.expense_ratio,
      price_per_sf: full.financial_metrics.price_per_sf,
      price_per_unit: full.financial_metrics.price_per_unit,
      rent_growth: full.assumptions.rent_growth,
      hold_period: full.assumptions.hold_period,
      leverage: full.assumptions.leverage,
      exit_cap_rate: full.assumptions.exit_cap_rate,
      deal_score: full.deal_score,
      score_reasoning: full.score_reasoning,
      summary: full.summary,
      recommendations: full.recommendations,
      red_flags: full.red_flags,
      model_used: full.model_used,
      tokens_used: full.tokens_used,
      cost_estimate: full.cost_estimate,
      processing_ms: full.processing_ms,
    });

    // Update the deal with anything stage-1 didn't already fill in. We
    // only overwrite missing values — the user may have touched the deal
    // between creation and BG completion.
    const dealUpdates: Record<string, unknown> = {
      om_score: full.deal_score,
      om_extracted: {
        asking_price: full.financial_metrics.asking_price ?? undefined,
        sf: full.property_details.sf ?? undefined,
        units: full.property_details.unit_count ?? undefined,
        cap_rate: full.financial_metrics.cap_rate ?? undefined,
        year_built: full.property_details.year_built ?? undefined,
        noi: full.financial_metrics.noi ?? undefined,
        occupancy:
          full.financial_metrics.vacancy_rate != null
            ? 1 - full.financial_metrics.vacancy_rate
            : undefined,
        address: full.property_details.address ?? undefined,
      },
    };
    await dealQueries.update(dealId, dealUpdates);

    // Update the document's AI summary now that we have one
    const redFlagCount = full.red_flags.length;
    const criticalCount = full.red_flags.filter(
      (f) => f.severity === "critical"
    ).length;
    const aiSummary = `Offering Memorandum — Deal Score: ${full.deal_score}/10. ${
      redFlagCount > 0
        ? `${redFlagCount} red flag(s)${criticalCount > 0 ? `, ${criticalCount} critical` : ""}.`
        : "No red flags detected."
    } ${full.summary ? full.summary.slice(0, 200) : ""}`;
    try {
      // ai_tags is JSONB; serialize like documentQueries.create does.
      await documentQueries.update(documentId, {
        ai_summary: aiSummary,
        ai_tags: JSON.stringify(["offering-memorandum", "om", "financial"]),
      });
    } catch (err) {
      console.warn("Inbox: failed to update document ai_summary:", err);
    }
  } catch (err) {
    console.error("Inbox: runBackgroundFullAnalysis failed:", err);
    await omAnalysisQueries
      .updateStatus(
        analysisId,
        "error",
        err instanceof Error ? err.message : "Unknown error"
      )
      .catch(() => {});
  }
}
