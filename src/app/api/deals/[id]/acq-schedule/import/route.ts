import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { devPhaseQueries } from "@/lib/db";
import {
  extractAcqSchedule,
  ACQ_PHASE_KEYS,
  type ExtractedAcqPhase,
  type AcqPhaseKey,
} from "@/lib/acq-schedule-extract";
import { DEFAULT_ACQ_PHASES } from "@/lib/types";
import type { DevPhase } from "@/lib/types";

export const dynamic = "force-dynamic";
// PDF extraction + a Claude round-trip can take a while on long PSAs.
export const maxDuration = 120;

/**
 * Step 1 of the Acquisition-doc importer. Receives a PDF / text doc
 * (LOI, PSA, broker timeline, etc.), runs the extractor, and returns
 * a preview that pairs each extracted row with the deal's current
 * Acq-track value for that phase. The dialog renders both side-by-
 * side so the analyst can decide row-by-row whether to take the
 * extracted value, keep their current one, or skip the row entirely.
 *
 * No DB writes here — the analyst confirms in the UI before /commit
 * lands anything.
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await extractAcqSchedule(buffer, file.type || "application/pdf");

    if (extracted.length === 0) {
      return NextResponse.json({
        data: {
          rows: [],
          source_filename: file.name,
        },
      });
    }

    // Pair each extracted row with the current state of the
    // corresponding phase on the deal so the dialog can render a diff.
    const allPhases = (await devPhaseQueries.getByDealId(params.id)) as DevPhase[];
    const acqByKey = new Map<string, DevPhase>();
    for (const p of allPhases) {
      if ((p.track ?? "development") === "acquisition" && p.phase_key) {
        acqByKey.set(p.phase_key, p);
      }
    }

    const rows: PreviewRow[] = extracted.map((e) => {
      const existing = acqByKey.get(e.phase_key) ?? null;
      return {
        phase_key: e.phase_key,
        label: existing?.label || e.label || labelForCanonical(e.phase_key) || e.phase_key,
        is_canonical: ACQ_PHASE_KEYS.includes(e.phase_key as AcqPhaseKey),
        existing_phase_id: existing?.id ?? null,
        existing_start_date: existing?.start_date ?? null,
        existing_duration_days: existing?.duration_days ?? null,
        proposed_start_date: e.start_date,
        proposed_duration_days: e.duration_days,
        source_quote: e.source_quote,
        confidence: e.confidence,
      };
    });

    return NextResponse.json({
      data: {
        rows,
        source_filename: file.name,
      },
    });
  } catch (error) {
    console.error("POST /api/deals/[id]/acq-schedule/import error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to extract Acq schedule", detail: detail.slice(0, 240) },
      { status: 500 }
    );
  }
}

export interface PreviewRow {
  phase_key: string;
  label: string;
  is_canonical: boolean;
  existing_phase_id: string | null;
  existing_start_date: string | null;
  existing_duration_days: number | null;
  proposed_start_date: string | null;
  proposed_duration_days: number;
  source_quote: string | null;
  confidence: ExtractedAcqPhase["confidence"];
}

function labelForCanonical(phase_key: string): string | null {
  const found = DEFAULT_ACQ_PHASES.find((p) => p.phase_key === phase_key);
  return found?.label ?? null;
}
