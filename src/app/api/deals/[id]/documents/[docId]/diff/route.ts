import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { diffDocumentVersions } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * POST /api/deals/[id]/documents/[docId]/diff
 * Body: { compare_to?: string }  // optional: id of the other version;
 *                                  defaults to the current doc's parent
 *
 * Runs a Claude-powered diff between two versions of a document and
 * returns a structured summary (material / minor / informational
 * changes). Used by the Version History modal on the Documents page.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const body = await req.json().catch(() => ({}));
    const compareToId: string | undefined = body.compare_to;

    const current = await documentQueries.getById(params.docId);
    if (!current || current.deal_id !== params.id) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Resolve "previous" — explicit compare_to, or the parent in the chain
    const previousId: string | null =
      compareToId ?? (current.parent_document_id as string | null);
    if (!previousId) {
      return NextResponse.json(
        {
          error:
            "No prior version to compare against. Upload a newer version of this document first.",
        },
        { status: 400 }
      );
    }

    const previous = await documentQueries.getById(previousId);
    if (!previous || previous.deal_id !== params.id) {
      return NextResponse.json(
        { error: "Prior version not found" },
        { status: 404 }
      );
    }

    const result = await diffDocumentVersions(
      (previous.content_text as string) || "",
      (current.content_text as string) || "",
      {
        category: current.category as string,
        previous_name: previous.original_name as string,
        current_name: current.original_name as string,
        previous_version: previous.version as number,
        current_version: current.version as number,
      }
    );

    if (!result) {
      return NextResponse.json(
        { error: "Diff failed — content extraction may have been empty." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      data: {
        ...result,
        previous: {
          id: previous.id,
          name: previous.original_name,
          version: previous.version,
        },
        current: {
          id: current.id,
          name: current.original_name,
          version: current.version,
        },
      },
    });
  } catch (error) {
    console.error(
      "POST /api/deals/[id]/documents/[docId]/diff error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to diff documents" },
      { status: 500 }
    );
  }
}
