import { NextRequest, NextResponse } from "next/server";
import { documentQueries, dealQueries } from "@/lib/db";
import { extractMarketReport } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { readFile } from "@/lib/blob-storage";
import { persistMarketReport } from "@/lib/market-extraction";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[id]/documents/[docId]/re-extract
 *
 * Re-run market-research extraction against a previously-uploaded document.
 * Useful when the original upload pre-dated the native-PDF extraction path
 * (so metrics are empty), or when the prompt/model was upgraded and the
 * analyst wants the existing doc re-scanned.
 *
 * Only valid for category="market" documents today — other categories have
 * their own extractors (OM upload, rent roll in /api/documents/upload) that
 * are owned elsewhere.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const [doc, deal] = await Promise.all([
      documentQueries.getById(params.docId),
      dealQueries.getById(params.id),
    ]);
    if (!doc || doc.deal_id !== params.id) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.category !== "market") {
      return NextResponse.json(
        {
          error: `Re-extraction is only supported for market-research documents (this one is "${doc.category}").`,
        },
        { status: 400 }
      );
    }

    // Prefer the native PDF block over the stored content_text (pdf-parse
    // flattens tables and loses footer addresses). Fall back to text if
    // the blob is unreachable — better to partially re-extract than to fail.
    let pdfBuffer: Buffer | null = null;
    if (doc.mime_type === "application/pdf" && doc.file_path) {
      try {
        pdfBuffer = await readFile(doc.file_path as string);
      } catch (err) {
        console.warn("re-extract: PDF fetch failed, falling back to text:", err);
      }
    }
    const rawText = (doc.content_text as string | null) || "";
    if (!pdfBuffer && (!rawText || rawText.trim().length < 40)) {
      return NextResponse.json(
        { error: "Document has no usable content to re-extract from." },
        { status: 422 }
      );
    }

    const extraction = await extractMarketReport(pdfBuffer, rawText, {
      property_type: deal?.property_type ?? null,
      city: deal?.city ?? null,
      state: deal?.state ?? null,
      msa: null,
      submarket: null,
    });
    if (!extraction) {
      return NextResponse.json(
        { error: "Re-extraction returned no structured data." },
        { status: 422 }
      );
    }

    const row = await persistMarketReport({
      dealId: params.id,
      extraction,
      sourceDocumentId: doc.id,
      sourceUrl: null,
      rawText,
      pipelineEnriched: extraction.pipeline,
    });

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/documents/[docId]/re-extract error:",
      error
    );
    return NextResponse.json(
      { error: "Re-extraction failed" },
      { status: 500 }
    );
  }
}
