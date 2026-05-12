import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import { AI_REPORT_CATEGORIES } from "@/lib/types";
import {
  applyDocumentActions,
  draftDocumentActionsFromDocs,
  normalizeDocumentActionIntent,
  normalizeDocumentActions,
} from "@/lib/document-actions";

export const dynamic = "force-dynamic";
const AI_REPORT_CATEGORY_SET = new Set<string>(AI_REPORT_CATEGORIES);

type DocumentRow = Record<string, unknown> & {
  id: string;
  original_name?: string;
  category?: string;
  is_key?: boolean;
};

function pickBatchDocuments(docs: DocumentRow[], ids: unknown): DocumentRow[] {
  if (Array.isArray(ids) && ids.length > 0) {
    const requested = new Set(ids.filter((id): id is string => typeof id === "string"));
    return docs.filter((doc) => requested.has(doc.id)).slice(0, 8);
  }

  const sourceDocs = docs.filter((doc) => !AI_REPORT_CATEGORY_SET.has(String(doc.category)));
  const keyDocs = sourceDocs.filter((doc) => Boolean(doc.is_key));
  return (keyDocs.length > 0 ? keyDocs : sourceDocs).slice(0, 8);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "apply" ? "apply" : "draft";
    const access =
      mode === "apply"
        ? await requireDealEditAccess(params.id, userId)
        : await requireDealAccess(params.id, userId);
    if (access.errorResponse) return access.errorResponse;

    const allDocs = (await documentQueries.getByDealId(params.id)) as DocumentRow[];
    const docs = pickBatchDocuments(allDocs, body.document_ids);
    const docIds = docs.map((doc) => doc.id);
    if (docIds.length === 0) {
      return NextResponse.json(
        { error: "No source documents found. Mark key documents or upload source files first." },
        { status: 400 }
      );
    }

    if (mode === "apply") {
      const actions = normalizeDocumentActions(body.actions, docIds);
      if (actions.length === 0) {
        return NextResponse.json({ error: "No actions selected" }, { status: 400 });
      }
      const data = await applyDocumentActions({
        dealId: params.id,
        userId,
        actions,
        defaultDocumentIds: docIds,
        sourceLabel:
          docs.length === 1
            ? docs[0].original_name || "one document"
            : `${docs.length} documents`,
      });
      return NextResponse.json({ data });
    }

    const data = await draftDocumentActionsFromDocs(
      docs,
      normalizeDocumentActionIntent(body.intent)
    );
    return NextResponse.json({
      data: {
        ...data,
        source_documents: docs.map((doc) => ({
          id: doc.id,
          original_name: doc.original_name,
          category: doc.category,
        })),
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/documents/actions error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to process document actions", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}
