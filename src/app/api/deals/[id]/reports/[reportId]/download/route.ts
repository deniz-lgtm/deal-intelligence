import { NextRequest, NextResponse } from "next/server";
import { generatedReportsQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

// Opt out of static analysis at `next build`. Route reads auth + DB and
// internally POSTs to the sibling export routes.
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/:id/reports/:reportId/download
 *
 * Regenerates and returns the PPTX / DOCX file for a saved report using
 * the sections snapshot stored at export time. This is byte-equivalent to
 * a fresh export from the same snapshot, but uses whatever latest template
 * / branding the working copy of the deal has — an intentional tradeoff
 * (we re-read branding so rebrand updates flow through to historical
 * reports automatically).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } }
) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const row = await generatedReportsQueries.getById(params.reportId, params.id);
    if (!row) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // Parse sections from JSONB (may come back as string depending on pg driver)
    const sections = typeof row.sections === "string" ? JSON.parse(row.sections) : row.sections;

    // Route by report_type to the right export endpoint. We proxy via an
    // internal fetch so the existing export routes stay the single source
    // of truth for the rendering logic (adding a new export format later
    // only requires changes in one place).
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    if (row.report_type === "dd_abstract") {
      const markdown = sections?.[0]?.content || "";
      const res = await fetch(`${baseUrl}/api/deals/${params.id}/dd-abstract/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie, "x-skip-snapshot": "1" },
        body: JSON.stringify({ markdown, dealName: row.deal_name || "Deal" }),
      });
      if (!res.ok) {
        return NextResponse.json({ error: "Regenerate failed" }, { status: 502 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = `DD-Abstract-${(row.deal_name || "deal").replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60)}.docx`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // Default: investment-package (pptx or docx)
    const res = await fetch(`${baseUrl}/api/deals/${params.id}/investment-package/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        sections: Array.isArray(sections) ? sections.map((s: { id: string; title: string; content: string; notes?: Array<{ text: string }> }) => ({
          id: s.id,
          title: s.title,
          notes: s.notes || [],
          generatedContent: s.content,
        })) : [],
        dealName: row.deal_name || "Deal",
        format: row.format,
        audience: row.audience,
        reportType: row.report_type,
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Regenerate failed" }, { status: 502 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = row.format === "docx" ? "docx" : "pptx";
    const mime = ext === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const filename = `${(row.title || "report").replace(/[^a-zA-Z0-9]/g, "-").slice(0, 80)}.${ext}`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("GET /api/deals/[id]/reports/[reportId]/download error:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}

