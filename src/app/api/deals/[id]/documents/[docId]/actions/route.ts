import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { requireAuth, requireDealAccess, requireDealEditAccess } from "@/lib/auth";
import {
  applyDocumentActions,
  draftDocumentActionsFromDocs,
  normalizeDocumentActionIntent,
  normalizeDocumentActions,
} from "@/lib/document-actions";

export const dynamic = "force-dynamic";

async function loadScopedDocument(dealId: string, docId: string) {
  const doc = await documentQueries.getById(docId);
  if (!doc || doc.deal_id !== dealId) return null;
  return doc as Record<string, unknown>;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
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

    const doc = await loadScopedDocument(params.id, params.docId);
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (mode === "apply") {
      const actions = normalizeDocumentActions(body.actions, [params.docId]);
      if (actions.length === 0) {
        return NextResponse.json({ error: "No actions selected" }, { status: 400 });
      }
      const data = await applyDocumentActions({
        dealId: params.id,
        userId,
        actions,
        defaultDocumentIds: [params.docId],
        sourceLabel: String(doc.original_name || "one document"),
      });
      return NextResponse.json({ data });
    }

    const data = await draftDocumentActionsFromDocs(
      [doc],
      normalizeDocumentActionIntent(body.intent)
    );
    return NextResponse.json({ data });
  } catch (error) {
    console.error("POST /api/deals/[id]/documents/[docId]/actions error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to process document actions", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}
