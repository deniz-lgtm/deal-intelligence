import { NextRequest, NextResponse } from "next/server";
import { documentQueries, dealQueries } from "@/lib/db";
import {
  extractCompsFromDocument,
  type ExtractedCompsBatch,
  type ExtractedCompDraft,
} from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { readFile } from "@/lib/blob-storage";
import { haversineMiles, placesLookupAddress } from "@/lib/geocode";
import { chunkPdfByPages, pdfPageCount } from "@/lib/pdf-chunk";
import { lookupAssessor } from "@/lib/assessor";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[id]/comps/extract-from-doc
 *
 * Batch-extract comps from an already-uploaded document (typically a
 * market-category document — market study, appraisal, broker comp report).
 * Returns an array of comp drafts for the user to review and selectively
 * save via POST /api/deals/[id]/comps.
 *
 * Body: { document_id: string }
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

    const body = await req.json();
    const documentId: string | undefined = body.document_id;
    // When true, skip the 30-mile sanity filter — lets analysts pull a
    // national comp book even if the subject is in a different metro.
    const keepAll: boolean = body.keep_all === true;
    if (!documentId) {
      return NextResponse.json(
        { error: "document_id is required" },
        { status: 400 }
      );
    }

    const [doc, deal] = await Promise.all([
      documentQueries.getById(documentId),
      dealQueries.getById(params.id),
    ]);
    if (!doc || doc.deal_id !== params.id) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Native PDF block gives Claude the full document (tables, footers,
    // photo captions) so long CBRE/JLL comp books aren't truncated and
    // street addresses tucked in appendices get extracted. Falls back to
    // content_text for non-PDF docs or if blob fetch fails.
    const isPdf = doc.mime_type === "application/pdf";
    let pdfBuffer: Buffer | null = null;
    if (isPdf && doc.file_path) {
      try {
        pdfBuffer = await readFile(doc.file_path as string);
      } catch (err) {
        console.warn("extract-from-doc: PDF fetch failed, falling back to text:", err);
      }
    }

    const hasText = !!(doc.content_text && (doc.content_text as string).trim().length >= 40);
    if (!pdfBuffer && !hasText) {
      return NextResponse.json(
        {
          error:
            "Document has no extracted text. Re-upload the document so it can be re-parsed, or paste its contents into the Comps tab manually.",
        },
        { status: 422 }
      );
    }

    // Long-document handling: CBRE/JLL national books often run 80–120 pages
    // with comp grids spread throughout. A single native-PDF pass loses
    // comps in the middle. Split into ~30-page chunks, run the extractor on
    // each, and merge-dedupe on (name+city). Falls back to a single pass
    // for short docs or if pdf-lib can't read the buffer.
    let batch: ExtractedCompsBatch | null = null;
    if (pdfBuffer) {
      let pageCount = 0;
      try {
        pageCount = await pdfPageCount(pdfBuffer);
      } catch {
        pageCount = 0;
      }
      if (pageCount > 35) {
        const chunks = await chunkPdfByPages(pdfBuffer, 30, 4).catch(() => []);
        if (chunks.length > 1) {
          const chunkBatches = await Promise.all(
            chunks.map((chunk) =>
              extractCompsFromDocument(
                (doc.content_text as string) || "",
                {
                  documentName: `${doc.original_name || doc.name} (pp. ${chunk.startPage}-${chunk.endPage})`,
                  pdfBuffer: chunk.buffer,
                }
              )
            )
          );
          const merged = mergeBatches(
            chunkBatches.filter((b): b is ExtractedCompsBatch => b != null)
          );
          if (merged) batch = merged;
        }
      }
    }
    if (!batch) {
      batch = await extractCompsFromDocument(
        (doc.content_text as string) || "",
        {
          documentName: doc.original_name || doc.name,
          pdfBuffer,
        }
      );
    }

    if (!batch) {
      return NextResponse.json(
        { error: "Extraction failed." },
        { status: 500 }
      );
    }

    // Address backfill via Google Places: for any comp that has a name but
    // no street address (or a weak "city only" address), ask Places to
    // resolve the full address + lat/lng. No-ops cleanly without a
    // GOOGLE_PLACES_API_KEY so dev/preview still work. Capped at 15 calls
    // per batch to keep billing predictable.
    const BACKFILL_CAP = 15;
    let backfillBudget = BACKFILL_CAP;
    for (const c of batch.comps) {
      if (backfillBudget <= 0) break;
      const hasStreet = typeof c.address === "string" && /\d/.test(c.address);
      if (hasStreet) continue;
      const query = [c.name, c.address, c.city, c.state]
        .filter((p) => p && String(p).trim())
        .join(", ");
      if (!query || query.length < 6) continue;
      // Count the call whether it hits or not — we pay Places per request.
      backfillBudget -= 1;
      const hit = await placesLookupAddress(query);
      if (!hit) continue;
      c._provenance = c._provenance || {};
      if (!c.address && hit.address) {
        c.address = hit.address;
        c._provenance.address = "places";
      }
      if (!c.city && hit.city) {
        c.city = hit.city;
        c._provenance.city = "places";
      }
      if (!c.state && hit.state) {
        c.state = hit.state;
        c._provenance.state = "places";
      }
      if (c.lat == null && hit.lat != null) {
        c.lat = hit.lat;
        c._provenance.lat = "places";
      }
      if (c.lng == null && hit.lng != null) {
        c.lng = hit.lng;
        c._provenance.lng = "places";
      }
    }

    // Compute derived fields Claude sometimes omits even when the base
    // values are present. The source numbers came from the broker, so
    // computed ratios are as trustworthy as those — and leaving them null
    // means the comp table shows em-dashes in $/Unit, $/SF, Dist.
    const dealLat = deal?.lat != null ? Number(deal.lat) : null;
    const dealLng = deal?.lng != null ? Number(deal.lng) : null;
    for (const c of batch.comps) {
      c._provenance = c._provenance || {};
      if (c.sale_price && c.units && c.price_per_unit == null) {
        c.price_per_unit = Math.round(c.sale_price / c.units);
        c._provenance.price_per_unit = "computed";
      }
      if (c.sale_price && c.total_sf && c.price_per_sf == null) {
        c.price_per_sf = Math.round((c.sale_price / c.total_sf) * 100) / 100;
        c._provenance.price_per_sf = "computed";
      }
      if (c.sale_price && c.cap_rate && c.noi == null) {
        c.noi = Math.round(c.sale_price * (c.cap_rate / 100));
        c._provenance.noi = "computed";
      }
      if (
        c.distance_mi == null &&
        dealLat != null &&
        dealLng != null &&
        c.lat != null &&
        c.lng != null
      ) {
        c.distance_mi =
          Math.round(haversineMiles(dealLat, dealLng, c.lat, c.lng) * 10) / 10;
        c._provenance.distance_mi = "computed";
      }
    }

    // Assessor backfill: for any comp that ended up with a real street
    // address, ask the configured assessor adapter for year_built + APN +
    // last-sale data. No-op today (no adapter configured) but the provenance
    // tagging is already in place so callers can trust the source column
    // once a provider is wired in. Capped to keep synchronous latency
    // bounded — 10 comps × ~200ms worst case.
    const ASSESSOR_CAP = 10;
    let assessorBudget = ASSESSOR_CAP;
    for (const c of batch.comps) {
      if (assessorBudget <= 0) break;
      const hasStreet = typeof c.address === "string" && /\d/.test(c.address);
      if (!hasStreet) continue;
      assessorBudget -= 1;
      const rec = await lookupAssessor(c.address, c.state);
      if (!rec) continue;
      c._provenance = c._provenance || {};
      if (c.year_built == null && rec.year_built != null) {
        c.year_built = rec.year_built;
        c._provenance.year_built = "assessor";
      }
      if (c.sale_price == null && rec.last_sale_price != null) {
        c.sale_price = rec.last_sale_price;
        c._provenance.sale_price = "assessor";
      }
      if (c.sale_date == null && rec.last_sale_date != null) {
        c.sale_date = rec.last_sale_date;
        c._provenance.sale_date = "assessor";
      }
    }

    // Distance sanity filter: a CBRE national report can contain 40 comps
    // scattered across the country — most of them useless for a subject in
    // one metro. Drop anything >30mi when we can compute distance, unless
    // the analyst explicitly opted out via keep_all. Comps with unknown
    // distance stay (no lat/lng on either side).
    let droppedFar = 0;
    if (!keepAll && dealLat != null && dealLng != null) {
      const kept = batch.comps.filter((c) => {
        if (c.distance_mi == null) return true;
        if (c.distance_mi <= 30) return true;
        droppedFar += 1;
        return false;
      });
      batch.comps = kept;
    }

    return NextResponse.json({
      data: {
        ...batch,
        filter: { dropped_far: droppedFar, radius_miles: 30, kept_all: keepAll },
        document: {
          id: doc.id,
          name: doc.original_name || doc.name,
          category: doc.category,
        },
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/comps/extract-from-doc error:", error);
    return NextResponse.json(
      { error: "Failed to extract comps from document" },
      { status: 500 }
    );
  }
}

// ── Multi-chunk merge + dedupe ──────────────────────────────────────────────
//
// When we run the extractor on a split 120-page PDF, comps that appear on
// a page boundary can show up in both chunks. Dedupe on a normalized
// (name + city) key; if two records collide, prefer non-null fields from
// the higher-confidence draft so the merged row is as complete as possible.

function compDedupKey(c: ExtractedCompDraft): string {
  const name = (c.name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const city = (c.city || "").toLowerCase().trim();
  const addr = (c.address || "").toLowerCase().trim();
  // Prefer address+city when we have a street; fall back to name+city; last
  // resort name alone. Empty string keys (no signal) never collide because
  // Map keys preserve identity — but we filter those out in the caller by
  // requiring at least a name OR an address.
  if (addr && /\d/.test(addr) && city) return `addr::${addr}::${city}`;
  if (name && city) return `name::${name}::${city}`;
  if (name) return `name::${name}`;
  return "";
}

function mergeDrafts(
  a: ExtractedCompDraft,
  b: ExtractedCompDraft
): ExtractedCompDraft {
  const primary = (a.confidence ?? 0) >= (b.confidence ?? 0) ? a : b;
  const secondary = primary === a ? b : a;
  const out: ExtractedCompDraft = { ...primary };
  // Fill any field that's null on primary from secondary.
  (Object.keys(secondary) as Array<keyof ExtractedCompDraft>).forEach((k) => {
    if (out[k] == null && secondary[k] != null) {
      // Typescript can't prove the assignment is safe across the union
      // of field types; we know it's the same key, same shape.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[k] = secondary[k];
    }
  });
  // Take the higher confidence, the longer notes.
  out.confidence = Math.max(a.confidence ?? 0, b.confidence ?? 0);
  if ((a.notes?.length ?? 0) > (b.notes?.length ?? 0)) out.notes = a.notes;
  return out;
}

function mergeBatches(batches: ExtractedCompsBatch[]): ExtractedCompsBatch | null {
  if (batches.length === 0) return null;
  const byKey = new Map<string, ExtractedCompDraft>();
  const keyless: ExtractedCompDraft[] = [];
  for (const b of batches) {
    for (const c of b.comps) {
      const key = compDedupKey(c);
      if (!key) {
        keyless.push(c);
        continue;
      }
      const prev = byKey.get(key);
      byKey.set(key, prev ? mergeDrafts(prev, c) : c);
    }
  }
  const merged = [...byKey.values(), ...keyless];
  return {
    summary: `${merged.length} unique comps extracted across ${batches.length} chunks`,
    comps: merged,
  };
}
