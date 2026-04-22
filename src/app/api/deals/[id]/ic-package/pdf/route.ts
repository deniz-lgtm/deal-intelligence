import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/deals/[id]/ic-package/pdf
 * Body: { html: string }  — full rendered HTML of the IC package page
 * Returns: application/pdf buffer (filename: <dealCode>.pdf)
 *
 * Dynamically imports puppeteer so the dependency stays optional on
 * Railway. If puppeteer isn't installed (or Chrome can't launch), we
 * return a structured 501 so the client falls back to window.print()
 * — which produces an equally-good PDF via @media print styles.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  try {
    const body = await req.json();
    const html = body.html as string | undefined;
    const filename = (body.filename as string | undefined) ?? `ic-package-${params.id}.pdf`;
    if (!html) {
      return NextResponse.json({ error: "Missing html" }, { status: 400 });
    }

    // Typed loosely (`any`) so TypeScript doesn't require puppeteer to be
    // installed for the app to build. When present at runtime we use it;
    // when absent, we return a structured 501 and the client falls back
    // to window.print().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let puppeteerLib: any;
    try {
      const moduleName = "puppeteer";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      puppeteerLib = (await (Function("m", "return import(m)") as (m: string) => Promise<any>)(moduleName)).default
        ?? (await (Function("m", "return import(m)") as (m: string) => Promise<any>)(moduleName));
    } catch {
      return NextResponse.json(
        {
          error: "puppeteer_not_installed",
          message:
            "Server-side PDF export requires puppeteer. Install it (`npm install puppeteer`) or rely on the client's browser print flow.",
        },
        { status: 501 }
      );
    }

    const browser = await puppeteerLib.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
      });

      return new NextResponse(pdf as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        },
      });
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error("POST /api/deals/[id]/ic-package/pdf error:", err);
    const message = err instanceof Error ? err.message : "PDF export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
