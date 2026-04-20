import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { extractCompsFromDocument } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { readFile } from "@/lib/blob-storage";
import { placesLookupAddress } from "@/lib/geocode";

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
    if (!documentId) {
      return NextResponse.json(
        { error: "document_id is required" },
        { status: 400 }
      );
    }

    const doc = await documentQueries.getById(documentId);
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

    const batch = await extractCompsFromDocument(
      (doc.content_text as string) || "",
      {
        documentName: doc.original_name || doc.name,
        pdfBuffer,
      }
    );

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
      if (!c.address && hit.address) c.address = hit.address;
      if (!c.city && hit.city) c.city = hit.city;
      if (!c.state && hit.state) c.state = hit.state;
      if (c.lat == null && hit.lat != null) c.lat = hit.lat;
      if (c.lng == null && hit.lng != null) c.lng = hit.lng;
    }

    return NextResponse.json({
      data: {
        ...batch,
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
