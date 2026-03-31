import { NextRequest, NextResponse } from "next/server";
import { documentQueries } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const { markdown, dealName } = await req.json();

    const docId = uuidv4();
    const doc = await documentQueries.create({
      id: docId,
      deal_id: params.id,
      name: `DD Abstract - ${dealName || "Deal"}`,
      original_name: `DD-Abstract-${(dealName || "Deal").replace(/[^a-zA-Z0-9]/g, "-")}.md`,
      category: "dd_abstract",
      file_path: "",
      file_size: Buffer.byteLength(markdown || "", "utf-8"),
      mime_type: "text/markdown",
      content_text: markdown || "",
      ai_summary: `AI-generated DD Abstract — created ${new Date().toLocaleDateString()}`,
      ai_tags: ["dd-abstract", "ai-generated"],
    });

    return NextResponse.json({ id: doc?.id || docId });
  } catch (error) {
    console.error("Save DD abstract error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
