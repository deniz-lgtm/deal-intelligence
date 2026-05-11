import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { renderReportHtml } from "@/lib/report-html-shell";
import { resolveBranding } from "@/lib/export-markdown";
import { htmlToPdf } from "@/lib/html-to-pdf";
import {
  computeAreaSchedule,
  type PlanElementLike,
} from "@/lib/floor-plan-area-schedule";
import { renderArchitectPackageBodyHtml } from "@/lib/pdf-exports/floor-plan-architect-package";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One-shot architect package PDF builder. Takes the canvas-as-PNG plus
// the editor's raw element array, computes the area schedule on the
// server so the math is canonical, and renders the branded PDF.
//
// Lives on the standalone /floor-plans sketchpad — no DB row required.
// If/when a floor-plan repository ships, this endpoint can be reused
// with a saved plan ID passed alongside (or instead of) the inline data.

interface RequestBody {
  title?: string;
  notes?: string | null;
  prepared_by?: string | null;
  plan_image_data_url?: string;
  /** The editor's `els` array. */
  elements?: PlanElementLike[];
}

export async function POST(req: NextRequest) {
  const { errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.plan_image_data_url || !body.plan_image_data_url.startsWith("data:image/")) {
    return NextResponse.json({ error: "plan_image_data_url (PNG data URL) is required" }, { status: 400 });
  }
  if (!Array.isArray(body.elements)) {
    return NextResponse.json({ error: "elements array is required" }, { status: 400 });
  }

  const title = (body.title ?? "").trim() || "Untitled Plan";
  const schedule = computeAreaSchedule(body.elements);
  const theme = resolveBranding(null);

  const bodyHtml = renderArchitectPackageBodyHtml({
    title,
    notes: body.notes?.trim() || null,
    planImageDataUrl: body.plan_image_data_url,
    schedule,
    preparedBy: body.prepared_by?.trim() || null,
  });

  const roomChip = schedule.rows.length === 1 ? "1 room" : `${schedule.rows.length} rooms`;
  const html = renderReportHtml({
    title: `Architect Package — ${title}`,
    headline: title,
    subtitle: "Floor Plan · Architect Package",
    eyebrow: "DESIGN",
    chips: [
      roomChip,
      `${Math.round(schedule.totalFt2)} ft²`,
      new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    ],
    bodyHtml,
    theme,
  });

  const pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in" });
  const safeName = title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60);
  const filename = `Floor-Plan-Architect-Package-${safeName}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
