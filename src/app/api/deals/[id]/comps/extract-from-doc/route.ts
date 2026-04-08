import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { extractCompsFromDocument } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";

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

    if (!doc.content_text || doc.content_text.trim().length < 40) {
      return NextResponse.json(
        {
          error:
            "Document has no extracted text. Re-upload the document so it can be re-parsed, or paste its contents into the Comps tab manually.",
        },
        { status: 422 }
      );
    }

    const batch = await extractCompsFromDocument(doc.content_text, {
      documentName: doc.original_name || doc.name,
    });

    if (!batch) {
      return NextResponse.json(
        { error: "Extraction failed." },
        { status: 500 }
      );
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
