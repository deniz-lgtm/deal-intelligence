import { NextRequest, NextResponse } from "next/server";
import {
  dealQueries,
  devPhaseQueries,
  getBrandingForDeal,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { renderReportHtml } from "@/lib/report-html-shell";
import { resolveBranding } from "@/lib/export-markdown";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { renderScheduleBodyHtml } from "@/lib/pdf-exports/schedule";
import {
  SCHEDULE_TRACK_LABELS,
  type DevPhase,
  type ScheduleTrack,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Stylized one-shot PDF of the dev schedule. Same shape as the Excel
// export — WBS / Float / Critical / Progress columns + a real
// CSS-rendered Gantt strip per row. Streams the file directly; no
// artifact-library row.

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
  if (accessError) return accessError;

  const url = new URL(req.url);
  const trackParam = url.searchParams.get("track");
  const validTracks: readonly ScheduleTrack[] = [
    "acquisition",
    "development",
    "construction",
  ];
  const trackFilter: ScheduleTrack | null =
    trackParam && (validTracks as readonly string[]).includes(trackParam)
      ? (trackParam as ScheduleTrack)
      : null;
  const focusId = url.searchParams.get("focus");

  const [deal, allPhases, brandingRaw] = await Promise.all([
    dealQueries.getById(params.id),
    devPhaseQueries.getByDealId(params.id) as Promise<DevPhase[]>,
    getBrandingForDeal(params.id).catch(() => null),
  ]);
  if (!deal) {
    return NextResponse.json({ error: "deal not found" }, { status: 404 });
  }

  let phases = trackFilter
    ? allPhases.filter((p) => (p.track ?? "development") === trackFilter)
    : allPhases;
  if (focusId) {
    const focusRows = new Set([focusId]);
    for (const p of allPhases) {
      if (p.parent_phase_id === focusId) focusRows.add(p.id);
    }
    phases = phases.filter((p) => focusRows.has(p.id));
  }

  const theme = resolveBranding(brandingRaw);
  const dateLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const trackLabel = trackFilter
    ? SCHEDULE_TRACK_LABELS[trackFilter] ?? trackFilter
    : focusId
      ? allPhases.find((p) => p.id === focusId)?.label ?? "Focused Plan"
      : "All Tracks";

  const focusPhase = focusId ? allPhases.find((p) => p.id === focusId) ?? null : null;
  const withTrackSections = !focusPhase && trackFilter == null;

  const bodyHtml = renderScheduleBodyHtml({ phases, withTrackSections });

  const dealName = (deal as { name?: string }).name ?? "Deal";
  const html = renderReportHtml({
    title: `Schedule — ${dealName}`,
    headline: focusPhase ? `${dealName} — ${focusPhase.label}` : dealName,
    subtitle: "Schedule",
    eyebrow: focusPhase ? "FOCUSED PLAN" : "DEAL SCHEDULE",
    chips: [
      `${phases.length} row${phases.length === 1 ? "" : "s"}`,
      trackLabel,
      dateLabel,
    ],
    bodyHtml,
    theme,
  });

  const pdf = await htmlToPdf(html, { format: "Letter", margin: "0.4in" });
  const safe = dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60) || "deal";
  const trackSlug = trackFilter ? `-${trackFilter}` : "";
  const focusSlug = focusPhase
    ? `-${focusPhase.label.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 40)}`
    : "";
  const filename = `${safe}${trackSlug}${focusSlug}-schedule.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
