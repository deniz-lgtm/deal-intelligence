import { NextRequest, NextResponse } from "next/server";
import { veItemQueries, dealQueries, getBrandingForDeal } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { renderReportHtml } from "@/lib/report-html-shell";
import { resolveBranding } from "@/lib/export-markdown";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { renderVeLogBodyHtml } from "@/lib/pdf-exports/ve-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const items = await veItemQueries.listByDeal(params.id);
  if (items.length === 0) {
    return NextResponse.json({ error: "No VE items on this deal yet." }, { status: 400 });
  }

  let branding: Record<string, unknown> | null = null;
  try {
    branding = await getBrandingForDeal(params.id);
  } catch {
    /* defaults */
  }
  const theme = resolveBranding(branding);

  const accepted = items.filter((i: { status: string }) => i.status === "accepted").length;
  const applied = items.filter((i: { status: string }) => i.status === "applied").length;

  const html = renderReportHtml({
    title: `Value Engineering Log — ${deal.name}`,
    headline: deal.name as string,
    subtitle: "Value Engineering Log",
    eyebrow: "PRE-CONSTRUCTION",
    chips: [
      `${items.length} item${items.length === 1 ? "" : "s"}`,
      `${accepted + applied} active`,
      new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    ],
    bodyHtml: renderVeLogBodyHtml(items as Parameters<typeof renderVeLogBodyHtml>[0]),
    theme,
  });

  const pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in" });
  const safeName = String(deal.name).replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60);
  const filename = `VE-Log-${safeName}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
