import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { extractGcSchedule } from "@/lib/gc-schedule-extract";

export const dynamic = "force-dynamic";
// PDF extraction + a Claude round-trip can take a while on large schedules.
export const maxDuration = 120;

/**
 * Step 1 of GC schedule import: receive a PDF, parse it, ask Claude to
 * structure the activities, and return the candidate list as a preview.
 * No DB writes happen here — the analyst approves rows in the UI and
 * hits /commit to persist. See GcScheduleImportDialog.tsx.
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

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with a `file` field" },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF uploads are supported for GC schedules right now." },
        { status: 415 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const activities = await extractGcSchedule(buffer);
    return NextResponse.json({ data: activities });
  } catch (error) {
    console.error("POST /api/deals/[id]/dev-schedule/import error:", error);
    return NextResponse.json({ error: "Failed to extract schedule" }, { status: 500 });
  }
}
