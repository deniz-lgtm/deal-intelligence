import { NextRequest, NextResponse } from "next/server";
import {
  extractCompFromText,
  pdfToImages,
  type ExtractCompImage,
} from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";

const SUPPORTED_IMAGE_TYPES: ExtractCompImage["mediaType"][] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/**
 * POST /api/deals/[id]/comps/extract
 *
 * Paste-mode comp extraction. The client sends any combination of:
 *   • `pasted_text`  — listing text the analyst copied from the source page
 *   • `source_url`   — reference URL only (we never fetch it server-side)
 *   • `attachments`  — base64-encoded screenshots / images / PDFs the analyst
 *                      took from the listing in their own browser session
 *
 * Returns a structured comp draft for the user to review before saving via
 * POST /api/deals/[id]/comps.
 *
 * The server never fetches source_url — see src/lib/web-allowlist.ts. All
 * content must originate from the analyst's own session with the source site.
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

    // attachments: [{ media_type: "image/png" | "application/pdf", data: <base64> }]
    const rawAttachments: Array<{ media_type?: string; data?: string }> =
      Array.isArray(body.attachments) ? body.attachments : [];

    // Expand any PDFs into per-page PNGs (Claude vision handles images).
    const images: ExtractCompImage[] = [];
    for (const att of rawAttachments) {
      if (!att?.data || typeof att.data !== "string") continue;
      const mediaType = (att.media_type || "").toLowerCase();
      if (
        SUPPORTED_IMAGE_TYPES.includes(
          mediaType as ExtractCompImage["mediaType"]
        )
      ) {
        images.push({
          mediaType: mediaType as ExtractCompImage["mediaType"],
          data: att.data,
        });
      } else if (mediaType === "application/pdf") {
        try {
          const buf = Buffer.from(att.data, "base64");
          const pages = await pdfToImages(buf, 6);
          for (const pg of pages) {
            images.push({ mediaType: "image/png", data: pg });
          }
        } catch (err) {
          console.error("PDF -> images conversion failed:", err);
          // Skip this attachment but keep going with the rest.
        }
      }
      // Other media types are silently ignored — the UI restricts uploads to
      // supported types up front.
    }

    const trimmedText = pastedText.trim();
    if (trimmedText.length < 20 && images.length === 0 && !sourceUrl) {
      return NextResponse.json(
        {
          error:
            "Provide at least one of: a source URL, pasted listing text (20+ chars), or a screenshot/image/PDF of the listing.",
        },
        { status: 400 }
      );
    }

    const draft = await extractCompFromText(pastedText, {
      expectedType,
      sourceUrl,
      images: images.length > 0 ? images : undefined,
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
