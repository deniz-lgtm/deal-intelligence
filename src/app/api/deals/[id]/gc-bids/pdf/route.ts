import { NextRequest, NextResponse } from "next/server";
import { gcBidQueries, dealQueries, getBrandingForDeal } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { renderReportHtml } from "@/lib/report-html-shell";
import { resolveBranding } from "@/lib/export-markdown";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { renderBidLevelingBodyHtml } from "@/lib/pdf-exports/bid-leveling-memo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// One-shot PDF export of the bid leveling memo. Streams the file directly
// (no artifact library row) so the user can email it to owner / IC right
// from the bids page.

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const deal = await dealQueries.getById(params.id);
  if (!deal) return NextResponse.json({ error: "deal not found" }, { status: 404 });

  const data = await gcBidQueries.getFullLeveling(params.id);
  if (!data.bids || data.bids.length === 0) {
    return NextResponse.json({ error: "No bids on this deal — add bids and run AI leveling first." }, { status: 400 });
  }

  let branding: Record<string, unknown> | null = null;
  try {
    branding = await getBrandingForDeal(params.id);
  } catch {
    /* defaults */
  }
  const theme = resolveBranding(branding);

  const dateLabel = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const bodyHtml = renderBidLevelingBodyHtml({
    bids: data.bids as Parameters<typeof renderBidLevelingBodyHtml>[0]["bids"],
    scope_items: data.scope_items as Parameters<typeof renderBidLevelingBodyHtml>[0]["scope_items"],
    bid_items: data.bid_items as Parameters<typeof renderBidLevelingBodyHtml>[0]["bid_items"],
    questions: data.questions as Parameters<typeof renderBidLevelingBodyHtml>[0]["questions"],
  });

  const html = renderReportHtml({
    title: `Bid Leveling Memo — ${deal.name}`,
    headline: deal.name as string,
    subtitle: "Bid Leveling Memo",
    eyebrow: "PRE-CONSTRUCTION",
    chips: [
      `${data.bids.length} bid${data.bids.length === 1 ? "" : "s"}`,
      `${data.scope_items.length} scope items`,
      dateLabel,
    ],
    bodyHtml,
    theme,
  });

  const pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in" });
  const safeName = String(deal.name).replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60);
  const filename = `Bid-Leveling-Memo-${safeName}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
