import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { playbookQueries, type PlaybookDocumentRow } from "@/lib/db";
import { requireAuth, requirePermission, syncCurrentUser } from "@/lib/auth";
import {
  buildPlaybookChunks,
  extractPlaybookText,
  formatMB,
  MAX_PLAYBOOK_UPLOAD_BYTES,
} from "@/lib/playbook";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const documents = await playbookQueries.getDocuments();
    return NextResponse.json({ data: documents.map(toPublicDocument) });
  } catch (error) {
    console.error("GET /api/playbook/documents error:", error);
    return NextResponse.json({ error: "Failed to fetch playbook documents" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requirePermission("documents.upload");
  if (errorResponse) return errorResponse;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = String(formData.get("title") || "").trim();
    const category = String(formData.get("category") || "handbook").trim() || "handbook";

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    if (file.size > MAX_PLAYBOOK_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `"${file.name}" is ${formatMB(file.size)}. Playbook uploads are capped at ${formatMB(MAX_PLAYBOOK_UPLOAD_BYTES)}.`,
        },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentText = await extractPlaybookText(
      buffer,
      file.type || "application/octet-stream",
      file.name
    );
    const chunks = buildPlaybookChunks(contentText);

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "No searchable text could be extracted from this file." },
        { status: 400 }
      );
    }

    const documentId = uuidv4();
    const document = await playbookQueries.createDocumentWithChunks(
      {
        id: documentId,
        title: title || file.name.replace(/\.[^.]+$/, ""),
        category,
        original_name: file.name,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
        content_text: contentText,
        uploaded_by: userId,
      },
      chunks.map((chunk) => ({
        id: uuidv4(),
        chunk_index: chunk.chunk_index,
        heading: chunk.heading,
        content: chunk.content,
        token_estimate: chunk.token_estimate,
      }))
    );

    return NextResponse.json({ data: toPublicDocument(document) }, { status: 201 });
  } catch (error) {
    console.error("POST /api/playbook/documents error:", error);
    const message = error instanceof Error ? error.message : "Failed to upload playbook document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function toPublicDocument(document: PlaybookDocumentRow) {
  return {
    id: document.id,
    title: document.title,
    category: document.category,
    original_name: document.original_name,
    mime_type: document.mime_type,
    file_size: document.file_size,
    uploaded_by: document.uploaded_by,
    created_at: document.created_at,
    updated_at: document.updated_at,
    chunk_count: document.chunk_count ?? 0,
  };
}
