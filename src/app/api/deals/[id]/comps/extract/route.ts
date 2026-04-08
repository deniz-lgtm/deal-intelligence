import { NextRequest, NextResponse } from "next/server";
import { extractCompFromText } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";

/**
 * POST /api/deals/[id]/comps/extract
 *
 * Paste-mode comp extraction. The client sends `pasted_text` (and optionally
 * `source_url` as a reference only) and gets back a structured comp draft
 * that the user reviews before saving via POST /api/deals/[id]/comps.
 *
 * The server never fetches source_url — see src/lib/web-allowlist.ts. The
 * analyst is expected to have pulled the content themselves under their own
 * session with the source site.
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
    const pastedText: string = body.pasted_text ?? "";
    const sourceUrl: string | undefined = body.source_url;
    const expectedType: "sale" | "rent" | undefined =
      body.expected_type === "sale" || body.expected_type === "rent"
        ? body.expected_type
        : undefined;

    if (!pastedText || pastedText.trim().length < 20) {
      return NextResponse.json(
        { error: "pasted_text is required (minimum 20 chars)" },
        { status: 400 }
      );
    }

    const draft = await extractCompFromText(pastedText, {
      expectedType,
      sourceUrl,
    });

    if (!draft) {
      return NextResponse.json(
        { error: "Extraction failed — try adding more context or paste the listing details manually." },
        { status: 422 }
      );
    }

    return NextResponse.json({ data: draft });
  } catch (error) {
    console.error("POST /api/deals/[id]/comps/extract error:", error);
    return NextResponse.json(
      { error: "Failed to extract comp" },
      { status: 500 }
    );
  }
}
