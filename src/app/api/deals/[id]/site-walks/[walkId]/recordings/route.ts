import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  siteWalkQueries,
  siteWalkRecordingQueries,
  siteWalkDeficiencyQueries,
  dealNoteQueries,
  dealQueries,
} from "@/lib/db";
import type { SiteWalkRecording } from "@/lib/types";
import { requireAuth, requireDealAccess, syncCurrentUser } from "@/lib/auth";
import { uploadBlob, readFile } from "@/lib/blob-storage";
import { transcribeMedia, isSupportedMediaMime, WHISPER_MAX_BYTES } from "@/lib/transcription";
import { processTranscript } from "@/lib/site-walk-ai";
import { SITE_WALK_AREA_LABELS } from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const walk = await siteWalkQueries.getById(params.walkId) as { deal_id: string } | null;
    if (!walk || walk.deal_id !== params.id) {
      return NextResponse.json({ error: "Site walk not found" }, { status: 404 });
    }

    const recordings = await siteWalkRecordingQueries.getByWalkId(params.walkId);
    return NextResponse.json({ data: recordings });
  } catch (err) {
    console.error("GET recordings error:", err);
    return NextResponse.json({ error: "Failed to fetch recordings" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; walkId: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    await syncCurrentUser(userId);
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const walk = await siteWalkQueries.getById(params.walkId) as { deal_id: string } | null;
    if (!walk || walk.deal_id !== params.id) {
      return NextResponse.json({ error: "Site walk not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const mimeCheck = isSupportedMediaMime(file.type || "");
    if (!mimeCheck.ok || !mimeCheck.media_type) {
      return NextResponse.json(
        { error: `Unsupported media type: ${file.type || "(unknown)"}. Upload an audio or video file.` },
        { status: 400 }
      );
    }

    if (file.size > WHISPER_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB — exceeds the 25MB transcription limit.`,
        },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const ext = file.name.split(".").pop() || (mimeCheck.media_type === "audio" ? "m4a" : "mp4");
    const safeName = `${id}.${ext}`;
    const blobPath = `${params.id}/site-walks/${params.walkId}/recordings/${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileUrl = await uploadBlob(blobPath, buffer, file.type);

    const recording = await siteWalkRecordingQueries.create({
      id,
      site_walk_id: params.walkId,
      deal_id: params.id,
      file_path: fileUrl,
      original_name: file.name,
      file_size: buffer.length,
      mime_type: file.type,
      media_type: mimeCheck.media_type,
      processing_status: "transcribing",
    });

    // Fire-and-forget async processing. The client polls GET on the
    // recording to watch status progress. Errors are stored on the row.
    void processRecordingAsync(id, params.id, params.walkId).catch((err) => {
      console.error("async processing failed:", err);
    });

    return NextResponse.json({ data: recording });
  } catch (err) {
    console.error("POST recording error:", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function processRecordingAsync(recordingId: string, dealId: string, walkId: string) {
  const recording = await siteWalkRecordingQueries.getById(recordingId) as SiteWalkRecording | null;
  if (!recording) return;

  try {
    // Transcribe
    const buffer = await readFile(recording.file_path);
    if (!buffer) {
      await siteWalkRecordingQueries.update(recordingId, {
        processing_status: "error",
        error_message: "Could not read uploaded file from storage.",
      });
      return;
    }

    const { text, duration } = await transcribeMedia(buffer, recording.original_name, recording.mime_type);

    await siteWalkRecordingQueries.update(recordingId, {
      transcript_raw: text,
      duration_seconds: duration,
      processing_status: "processing",
    });

    if (!text.trim()) {
      await siteWalkRecordingQueries.update(recordingId, {
        processing_status: "completed",
        transcript_cleaned: "",
      });
      return;
    }

    // Pull deal context notes for richer AI processing
    const deal = await dealQueries.getById(dealId);
    const dealContext =
      (deal?.context_notes as string | undefined) ||
      (deal?.notes as string | undefined) ||
      undefined;

    // Process transcript into structured notes + deficiencies
    const processed = await processTranscript(text, dealContext);

    await siteWalkRecordingQueries.update(recordingId, {
      transcript_cleaned: processed.cleaned_transcript,
    });

    // Create a site_walk deal note for each observation (into AI memory)
    for (const obs of processed.observations) {
      if (!obs.text.trim()) continue;
      const areaLabel = SITE_WALK_AREA_LABELS[obs.area_tag] ?? obs.area_tag;
      const prefix = `[Site Walk — ${areaLabel}]`;
      const marker = obs.is_concern ? " ⚠" : obs.is_positive ? " ✓" : "";
      const body = `${prefix}${marker} ${obs.text}`.trim();
      try {
        await dealNoteQueries.create({
          id: uuidv4(),
          deal_id: dealId,
          text: body,
          category: "site_walk",
          source: "ai",
        });
      } catch (e) {
        console.warn("Failed to insert site-walk note:", (e as Error).message);
      }
    }

    // Also create a summary note if present
    if (processed.summary?.trim()) {
      try {
        await dealNoteQueries.create({
          id: uuidv4(),
          deal_id: dealId,
          text: `[Site Walk Summary] ${processed.summary}`,
          category: "site_walk",
          source: "ai",
        });
      } catch (e) {
        console.warn("Failed to insert site-walk summary note:", (e as Error).message);
      }
    }

    // Create deficiencies
    for (const def of processed.deficiencies) {
      if (!def.description.trim()) continue;
      try {
        await siteWalkDeficiencyQueries.create({
          id: uuidv4(),
          site_walk_id: walkId,
          deal_id: dealId,
          area_tag: def.area_tag,
          description: def.description,
          severity: def.severity,
          category: def.category,
          notes: def.estimated_cost_note ?? null,
        });
      } catch (e) {
        console.warn("Failed to insert deficiency:", (e as Error).message);
      }
    }

    await siteWalkRecordingQueries.update(recordingId, {
      processing_status: "completed",
    });
  } catch (err) {
    console.error("Recording processing error:", err);
    await siteWalkRecordingQueries.update(recordingId, {
      processing_status: "error",
      error_message: err instanceof Error ? err.message : "Unknown processing error",
    });
  }
}
