import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  siteWalkRecordingQueries,
  siteWalkDeficiencyQueries,
  dealNoteQueries,
  dealQueries,
} from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { readFile } from "@/lib/blob-storage";
import { transcribeMedia } from "@/lib/transcription";
import { processTranscript } from "@/lib/site-walk-ai";
import { SITE_WALK_AREA_LABELS, type SiteWalkRecording } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * Synchronous retry endpoint. Waits for transcription + Claude processing
 * to complete, then returns the updated recording. Used when the
 * fire-and-forget pipeline hits an error the user wants to retry.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string; recordingId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const recording = await siteWalkRecordingQueries.getById(params.recordingId) as SiteWalkRecording | null;
    if (!recording || recording.deal_id !== params.id) {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }

    await siteWalkRecordingQueries.update(params.recordingId, {
      processing_status: "transcribing",
      error_message: null,
    });

    const buffer = await readFile(recording.file_path);
    if (!buffer) {
      await siteWalkRecordingQueries.update(params.recordingId, {
        processing_status: "error",
        error_message: "Could not read uploaded file from storage.",
      });
      return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
    }

    const { text, duration } = await transcribeMedia(
      buffer,
      recording.original_name,
      recording.mime_type
    );

    await siteWalkRecordingQueries.update(params.recordingId, {
      transcript_raw: text,
      duration_seconds: duration,
      processing_status: "processing",
    });

    const deal = await dealQueries.getById(params.id);
    const dealContext =
      (deal?.context_notes as string | undefined) ||
      (deal?.notes as string | undefined) ||
      undefined;

    const processed = await processTranscript(text, dealContext);

    await siteWalkRecordingQueries.update(params.recordingId, {
      transcript_cleaned: processed.cleaned_transcript,
    });

    let noteCount = 0;
    for (const obs of processed.observations) {
      if (!obs.text.trim()) continue;
      noteCount += 1;
      const areaLabel = SITE_WALK_AREA_LABELS[obs.area_tag] ?? obs.area_tag;
      const prefix = `[Site Walk — ${areaLabel}]`;
      const marker = obs.is_concern ? " ⚠" : obs.is_positive ? " ✓" : "";
      const body = `${prefix}${marker} ${obs.text}`.trim();
      try {
        await dealNoteQueries.create({
          id: uuidv4(),
          deal_id: params.id,
          text: body,
          category: "site_walk",
          source: "ai",
        });
      } catch {}
    }

    if (processed.summary?.trim()) {
      try {
        await dealNoteQueries.create({
          id: uuidv4(),
          deal_id: params.id,
          text: `[Site Walk Summary] ${processed.summary}`,
          category: "site_walk",
          source: "ai",
        });
      } catch {}
    }

    for (const def of processed.deficiencies) {
      if (!def.description.trim()) continue;
      try {
        await siteWalkDeficiencyQueries.create({
          id: uuidv4(),
          site_walk_id: params.walkId,
          deal_id: params.id,
          area_tag: def.area_tag,
          description: def.description,
          severity: def.severity,
          category: def.category,
          notes: def.estimated_cost_note ?? null,
        });
      } catch {}
    }

    const updated = await siteWalkRecordingQueries.update(params.recordingId, {
      processing_status: "completed",
    });

    return NextResponse.json({
      data: updated,
      observations_added: noteCount,
      deficiencies_added: processed.deficiencies.length,
    });
  } catch (err) {
    console.error("Retry process error:", err);
    try {
      await siteWalkRecordingQueries.update(params.recordingId, {
        processing_status: "error",
        error_message: err instanceof Error ? err.message : "Processing failed",
      });
    } catch {}
    const message = err instanceof Error ? err.message : "Processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
