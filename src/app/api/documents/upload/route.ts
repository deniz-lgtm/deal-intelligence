import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { documentQueries, dealQueries } from "@/lib/db";
import {
  classifyDocument,
  extractMarketReport,
  extractRentRollSummary,
  diffDocumentVersions,
} from "@/lib/claude";
import { uploadBlob } from "@/lib/blob-storage";
import { requireAuth, requireDealAccess, requirePermission, syncCurrentUser } from "@/lib/auth";
import { persistMarketReport } from "@/lib/market-extraction";
import {
  captureFeasibilitySnapshot,
  computeFeasibilityDelta,
  isFeasibilityCategory,
} from "@/lib/recompute-feasibility";
import type { FeasibilitySnapshot } from "@/lib/claude";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

// 100 MB cap. pdf-parse buffers the entire file in memory to extract
// text; without a cap a single oversized PDF can OOM the Railway
// container (typically 512 MB). Most diligence docs — OMs, T-12s,
// rent rolls, zoning letters — weigh in well under 20 MB, so 100 MB
// is comfortable headroom without exposing the server to abuse.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const fmtMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buffer);
      return data.text || "";
    } catch {
      return "";
    }
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.includes("xml")
  ) {
    return buffer.toString("utf-8");
  }
  return "";
}

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requirePermission("documents.upload");
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  try {
    const formData = await req.formData();
    const dealId = formData.get("deal_id") as string;
    const files = formData.getAll("files") as File[];

    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const { errorResponse: accessError } = await requireDealAccess(dealId, userId);
    if (accessError) return accessError;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Size-check every file BEFORE we start reading any of them into
    // memory. One oversized file kills the whole batch so the user
    // gets a useful error instead of a half-complete upload.
    const oversize = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversize) {
      return NextResponse.json(
        {
          error: `"${oversize.name}" is ${fmtMB(oversize.size)} — uploads are capped at ${fmtMB(MAX_UPLOAD_BYTES)}. Compress the PDF or split it before uploading.`,
        },
        { status: 413 },
      );
    }

    const uploaded = [];

    for (const file of files) {
      const id = uuidv4();
      const ext = path.extname(file.name);
      const safeName = `${id}${ext}`;
      const blobPath = `${dealId}/${safeName}`;

      const buffer = Buffer.from(await file.arrayBuffer());
      const fileUrl = await uploadBlob(blobPath, buffer, file.type || "application/octet-stream");

      const rawText = await extractText(buffer, file.type);
      // Strip null bytes and non-UTF8 characters that Postgres rejects
      const contentText = rawText.replace(/\x00/g, "").replace(/[\uFFFD]/g, "");

      let category = "other";
      let summary = "";
      let tags: string[] = [];

      // .geojson is always a feasibility / massing export — skip the AI
      // classifier and route straight to the Giraffe category. The
      // importer dialog picks up from there.
      const isGeoJson =
        /\.geojson$/i.test(file.name) ||
        file.type === "application/geo+json" ||
        file.type === "application/vnd.geo+json";

      if (isGeoJson) {
        category = "giraffe_export";
        summary = "Feasibility / massing GeoJSON export — import via the Programming page.";
        tags = ["giraffe", "geojson", "massing"];
      } else if (contentText || file.name) {
        try {
          const result = await classifyDocument(file.name, contentText);
          category = result.category;
          summary = result.summary;
          tags = result.tags;
        } catch (err) {
          console.error("AI classification failed for", file.name, ":", err instanceof Error ? err.message : err);
        }
      }

      // Auto-detect whether this is a new version of an existing document
      // in the same deal+category. If so, chain it as vN+1 of the prior.
      let parentDocumentId: string | null = null;
      let version = 1;
      try {
        const prev = await documentQueries.findLikelyPrevVersion(
          dealId,
          category,
          file.name
        );
        if (prev) {
          parentDocumentId = prev.id as string;
          version = ((prev.version as number) || 1) + 1;
        }
      } catch (err) {
        console.warn("Version detection failed:", err);
      }

      const doc = await documentQueries.create({
        id,
        deal_id: dealId,
        name: file.name.replace(ext, "").slice(0, 200),
        original_name: file.name,
        category,
        file_path: fileUrl,
        file_size: buffer.length,
        mime_type: file.type || "application/octet-stream",
        content_text: contentText || null,
        ai_summary: summary || null,
        ai_tags: tags.length > 0 ? tags : null,
        parent_document_id: parentDocumentId,
        version,
      });

      // If this looks like a rent roll, extract units/SF/rents and update the deal
      const isRentRoll = /rent.?roll/i.test(file.name) || tags.some(t => /rent.?roll/i.test(t));
      if (isRentRoll && (contentText || file.type === "application/pdf")) {
        const pdfBuf = file.type === "application/pdf" ? buffer : undefined;
        extractRentRollSummary(contentText, pdfBuf).then(async (rrSummary) => {
          if (!rrSummary) return;
          const updates: Record<string, unknown> = {};
          if (rrSummary.total_units) updates.units = rrSummary.total_units;
          if (rrSummary.total_sf) updates.square_footage = rrSummary.total_sf;
          if (Object.keys(updates).length > 0) {
            await dealQueries.update(dealId, updates);
          }
        }).catch(err => console.error("Rent roll extraction failed:", err));
      }

      // If the classifier flagged this as a market-research doc, fire a
      // fire-and-forget market-report extraction: populates market_reports
      // (QoQ history) + submarket_metrics (current sidebar snapshot) so the
      // analyst doesn't have to separately drop the file into the Comps &
      // Market panel. Same pattern as the rent-roll path above.
      if (category === "market" && (contentText || file.type === "application/pdf")) {
        const pdfBuf = file.type === "application/pdf" ? buffer : null;
        (async () => {
          try {
            const deal = await dealQueries.getById(dealId);
            const extraction = await extractMarketReport(
              pdfBuf,
              contentText || "",
              {
                property_type: deal?.property_type ?? null,
                city: deal?.city ?? null,
                state: deal?.state ?? null,
                msa: null,
                submarket: null,
              }
            );
            if (!extraction) return;
            await persistMarketReport({
              dealId,
              extraction,
              sourceDocumentId: id,
              sourceUrl: null,
              rawText: contentText || null,
              pipelineEnriched: extraction.pipeline,
            });
          } catch (err) {
            console.error(
              "Auto market-report extraction failed for",
              file.name,
              ":",
              err
            );
          }
        })();
      }

      // Auto-diff: if this is a version > 1, fire-and-forget a diff against
      // the parent version. The result is stored in auto_diff_result so the
      // Documents page can show a "changes" callout immediately on next load.
      //
      // For feasibility-bearing categories (rent rolls, T-12s, appraisals),
      // we also capture a snapshot of the deal's current NOI / cap rate /
      // max-bid and diff it against the parent doc's snapshot — this
      // produces the "Feasibility impact since last version" line the
      // Documents page surfaces inline. Rent-roll extraction mutates
      // deals.units/SF earlier in this loop, so snapshot after a short
      // delay to let that catch up.
      if (parentDocumentId && contentText) {
        (async () => {
          try {
            const prev = await documentQueries.getById(parentDocumentId);
            if (!prev?.content_text) return;
            const diffResult = await diffDocumentVersions(
              prev.content_text as string,
              contentText,
              {
                category,
                previous_name: prev.original_name as string,
                current_name: file.name,
                previous_version: (prev.version as number) || 1,
                current_version: version,
              }
            );
            if (!diffResult) return;

            if (isFeasibilityCategory(category)) {
              const currentSnap = await captureFeasibilitySnapshot(dealId);
              if (currentSnap) {
                diffResult.snapshot = currentSnap;
                // If the parent doc already has a snapshot from its own
                // upload, compute the delta. Otherwise leave downstream
                // unset — we'll have a baseline for the next version.
                const prevDiffRaw = prev.auto_diff_result as string | null | undefined;
                if (prevDiffRaw) {
                  try {
                    const prevDiff = typeof prevDiffRaw === "string"
                      ? JSON.parse(prevDiffRaw)
                      : prevDiffRaw;
                    const prevSnap = prevDiff?.snapshot as FeasibilitySnapshot | undefined;
                    if (prevSnap) {
                      diffResult.downstream = computeFeasibilityDelta(prevSnap, currentSnap);
                    }
                  } catch {
                    // Bad JSON on the parent diff — skip silently.
                  }
                }
              }
            }

            await documentQueries.update(id, {
              auto_diff_result: JSON.stringify(diffResult),
            });
          } catch (err) {
            console.error("Auto-diff failed for", file.name, ":", err);
          }
        })();
      } else if (!parentDocumentId && isFeasibilityCategory(category)) {
        // First version of a feasibility-bearing doc — capture a
        // snapshot so the NEXT version has something to diff against.
        // Persist as a minimal auto_diff_result with just the snapshot;
        // the Documents page's callout renderer skips rows where
        // `summary` is empty, so this is invisible UI-wise.
        (async () => {
          try {
            const snap = await captureFeasibilitySnapshot(dealId);
            if (!snap) return;
            await documentQueries.update(id, {
              auto_diff_result: JSON.stringify({
                summary: "",
                changes: [],
                no_material_changes: true,
                snapshot: snap,
              }),
            });
          } catch (err) {
            console.error("Feasibility snapshot (baseline) failed:", err);
          }
        })();
      }

      uploaded.push(doc);
    }

    return NextResponse.json({ data: uploaded }, { status: 201 });
  } catch (error) {
    console.error("POST /api/documents/upload error:", error);
    return NextResponse.json({ error: "Failed to upload documents" }, { status: 500 });
  }
}
