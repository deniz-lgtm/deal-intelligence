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
//      - Run stage-1 OM extraction (property_details + financial_metrics —
//        cheap, skips red flags + scoring which are expensive)
//      - Create a deal in the `sourcing` stage with the extracted fields,
//        auto_ingested=true, ingested_from_path=the Dropbox path
//      - Create a document row linked to the deal
//   4. Update dropbox_accounts.last_polled_at
//   5. Return a summary for the UI
//
// This runs stage-1 extraction ONLY — red flags, deal score, and
// recommendations are skipped to keep token cost low on auto-ingest. The
// user can trigger the full analysis by clicking into the deal and using
// the existing /om-analysis page (which calls extractOmFull).

import { v4 as uuidv4 } from "uuid";
import path from "path";
import {
  dealQueries,
  documentQueries,
  dropboxQueries,
} from "./db";
import {
  listFolder,
  downloadFile,
  refreshAccessToken,
  isSupportedFile,
  guessMimeType,
  DropboxEntry,
} from "./dropbox";
import { uploadBlob } from "./blob-storage";
import { extractMetrics } from "./om-extraction";

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
 */
export async function pollDropboxInbox(): Promise<PollResult | PollError> {
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
      const ingested = await ingestSingleFile(entry, accessToken);
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
 * Download a single Dropbox file, upload to blob storage, run stage-1 OM
 * extraction, and create a new deal + document for it. Throws on any
 * unrecoverable error; the caller captures it in the PollResult.
 */
async function ingestSingleFile(
  entry: DropboxEntry,
  accessToken: string
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

  // Extract PDF text (used by stage-1 extractor as a fallback)
  const contentText = await extractPdfText(buffer, mimeType);

  // Stage-1 OM extraction: property_details + financial_metrics only
  // (skips red flags, deal score, and recommendations). Works for PDFs via
  // image fallback inside extractMetrics().
  let extracted: Awaited<ReturnType<typeof extractMetrics>> | null = null;
  try {
    extracted = await extractMetrics(
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
  // fallbacks when a field is missing).
  const derivedName =
    extracted?.property_details.name ||
    metadata.name.replace(ext, "").slice(0, 200);
  const addressParts = parseAddress(extracted?.property_details.address ?? null);

  const dealPayload: Record<string, unknown> = {
    id: dealId,
    name: derivedName,
    address: addressParts.street,
    city: addressParts.city,
    state: addressParts.state,
    zip: addressParts.zip,
    property_type: extracted?.property_details.property_type || "other",
    status: "sourcing",
    starred: false,
    asking_price: extracted?.financial_metrics.asking_price ?? null,
    square_footage: extracted?.property_details.sf ?? null,
    units: extracted?.property_details.unit_count ?? null,
    year_built: extracted?.property_details.year_built ?? null,
    notes: `Auto-ingested from Dropbox (${entry.path_display})`,
    loi_executed: false,
    psa_executed: false,
  };

  await dealQueries.create(dealPayload);

  // Flag it as auto-ingested (dealQueries.create doesn't set these columns)
  await dealQueries.update(dealId, {
    auto_ingested: true,
    ingested_from_path: entry.path_display,
  });

  // Create the linked document record
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

  return {
    id: dealId,
    name: derivedName,
    address: extracted?.property_details.address ?? null,
    asking_price: extracted?.financial_metrics.asking_price ?? null,
    source_path: entry.path_display,
  };
}
