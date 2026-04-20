import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  dealQueries,
  documentQueries,
  marketReportsQueries,
  submarketMetricsQueries,
} from "@/lib/db";
import { extractMarketReport } from "@/lib/claude";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import { geocodeAddress, placesLookupAddress } from "@/lib/geocode";
import { uploadBlob } from "@/lib/blob-storage";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * GET  /api/deals/:id/market-reports
 *   List every broker market research report uploaded for this deal,
 *   newest as-of first. The Comps & Market page renders QoQ deltas
 *   from this list.
 *
 * POST /api/deals/:id/market-reports
 *   Accepts either:
 *     (a) multipart/form-data with a `file` (PDF) + optional `source_url`
 *     (b) JSON `{ text: string, source_url?: string, publisher?: string }`
 *   Runs the AI extractor and inserts a row. Also writes back a lightweight
 *   upsert to submarket_metrics so the existing UI and downstream prompts
 *   pick up the latest vintage automatically.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const rows = await marketReportsQueries.getByDealId(params.id);
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/deals/[id]/market-reports error:", error);
    return NextResponse.json({ error: "Failed to fetch market reports" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const deal = await dealQueries.getById(params.id);
    const dealContext = {
      property_type: deal.property_type,
      city: deal.city,
      state: deal.state,
      msa: null,
      submarket: null,
    };

    let pdfBuffer: Buffer | null = null;
    let rawText = "";
    let sourceUrl: string | null = null;
    let hintedPublisher: string | null = null;
    let uploadedFile: File | null = null;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      uploadedFile = file;
      sourceUrl = (form.get("source_url") as string | null) || null;
      hintedPublisher = (form.get("publisher") as string | null) || null;
      if (file && file.type === "application/pdf") {
        pdfBuffer = Buffer.from(await file.arrayBuffer());
        try {
          const pdfParse = (await import("pdf-parse")).default;
          const parsed = await pdfParse(pdfBuffer);
          rawText = (parsed.text || "").replace(/\x00/g, "").replace(/[\uFFFD]/g, "");
        } catch (e) {
          console.error("market-reports: PDF parse error:", e);
        }
      } else if (file) {
        // Analyst dragged in something else (.docx, .txt) — we only guarantee
        // good extraction on PDFs. Read as text as a best effort.
        rawText = await file.text();
      }
    } else {
      const body = await req.json().catch(() => ({}));
      rawText = String(body.text || "").trim();
      sourceUrl = body.source_url || null;
      hintedPublisher = body.publisher || null;
    }

    if (!pdfBuffer && !rawText) {
      return NextResponse.json(
        { error: "Provide a PDF file or pasted text" },
        { status: 400 }
      );
    }

    const extraction = await extractMarketReport(pdfBuffer, rawText, dealContext);
    if (!extraction) {
      return NextResponse.json(
        { error: "Could not extract market report. Check the document and try again." },
        { status: 422 }
      );
    }

    // If the analyst explicitly told us the publisher, trust that over the AI's guess.
    if (hintedPublisher && !extraction.publisher) {
      extraction.publisher = hintedPublisher;
    }

    // Best-effort geocode each named pipeline project. Developers need the
    // supply pipeline plotted on the site plan to see what's competing
    // nearby. The Census geocoder is free + unauthenticated but slow-ish,
    // so we cap at 20 projects + 100ms between calls. Anything that
    // doesn't resolve stays in the list without coords — the UI renders
    // those in a list view rather than on the map.
    const submarket = [extraction.submarket, extraction.msa].filter(Boolean).join(", ");
    const enrichedPipeline = await geocodePipeline(extraction.pipeline, submarket);

    // Persist the source PDF to the Documents tab (category = "market") so
    // the analyst can re-open the report from the docs list and so downstream
    // flows like /api/deals/:id/comps/extract-from-doc can operate on it.
    // Paste-mode uploads have no file to save and are skipped.
    let sourceDocumentId: string | null = null;
    if (uploadedFile) {
      try {
        const docId = uuidv4();
        const ext = path.extname(uploadedFile.name) || ".pdf";
        const blobPath = `${params.id}/${docId}${ext}`;
        const fileBuffer = pdfBuffer ?? Buffer.from(await uploadedFile.arrayBuffer());
        const fileUrl = await uploadBlob(
          blobPath,
          fileBuffer,
          uploadedFile.type || "application/pdf"
        );
        const reportLabel = [extraction.publisher, extraction.report_name]
          .filter(Boolean)
          .join(" — ");
        await documentQueries.create({
          id: docId,
          deal_id: params.id,
          name: uploadedFile.name.replace(ext, "").slice(0, 200),
          original_name: uploadedFile.name,
          category: "market",
          file_path: fileUrl,
          file_size: fileBuffer.length,
          mime_type: uploadedFile.type || "application/pdf",
          content_text: rawText ? rawText.slice(0, 200_000) : null,
          ai_summary: reportLabel || null,
          ai_tags: ["market-research", extraction.publisher, extraction.asset_class].filter(
            (t): t is string => Boolean(t)
          ),
        });
        sourceDocumentId = docId;
      } catch (err) {
        // Don't fail the whole extraction if blob/doc persistence hiccups —
        // the analyst still gets their market_reports row back.
        console.error("market-reports: source document save failed:", err);
      }
    }

    const id = uuidv4();
    const row = await marketReportsQueries.create(params.id, id, {
      publisher: extraction.publisher,
      report_name: extraction.report_name,
      asset_class: extraction.asset_class,
      msa: extraction.msa,
      submarket: extraction.submarket,
      as_of_date: extraction.as_of_date,
      source_document_id: sourceDocumentId,
      source_url: sourceUrl || extraction.source_url,
      metrics: extraction.metrics as Record<string, unknown>,
      pipeline: enrichedPipeline,
      top_employers: extraction.top_employers,
      top_deliveries: extraction.top_deliveries,
      narrative: extraction.narrative,
      // Keep a truncated excerpt so we have provenance without blowing up the row.
      raw_text: rawText ? rawText.slice(0, 20_000) : null,
    });

    // Mirror the canonical submarket fields into submarket_metrics so the
    // Comps & Market panel, Co-Pilot benchmarks, DD abstract, and investment
    // package all pick up the fresh vintage without the analyst having to
    // re-type anything. market_reports stays the source of truth (with QoQ
    // history); submarket_metrics is the "current" snapshot keyed 1:1 with
    // the deal. Only write when we have at least one field worth saving.
    try {
      const m = extraction.metrics || {};
      const capAvg =
        m.cap_rate_avg_pct != null
          ? Number(m.cap_rate_avg_pct)
          : m.cap_rate_low_pct != null && m.cap_rate_high_pct != null
            ? (Number(m.cap_rate_low_pct) + Number(m.cap_rate_high_pct)) / 2
            : null;
      const smFields: Record<string, unknown> = {
        submarket_name: extraction.submarket ?? null,
        msa: extraction.msa ?? null,
        market_cap_rate: capAvg,
        market_rent_growth: m.rent_growth_yoy_pct ?? null,
        market_vacancy: m.vacancy_pct ?? m.availability_pct ?? null,
        absorption_units: m.absorption_units_ytd ?? null,
        deliveries_units: m.deliveries_units_ytd ?? null,
        narrative: extraction.narrative ?? null,
        sources: [
          [extraction.publisher, extraction.report_name, extraction.as_of_date]
            .filter(Boolean)
            .join(" — "),
        ].filter(Boolean),
      };
      const hasAnyValue = [
        smFields.submarket_name,
        smFields.msa,
        smFields.market_cap_rate,
        smFields.market_rent_growth,
        smFields.market_vacancy,
        smFields.absorption_units,
        smFields.deliveries_units,
        smFields.narrative,
      ].some((v) => v != null && v !== "");
      if (hasAnyValue) {
        const existing = await submarketMetricsQueries.getByDealId(params.id);
        await submarketMetricsQueries.upsert(
          params.id,
          existing?.id ?? uuidv4(),
          smFields
        );
      }
    } catch (err) {
      console.error("market-reports: submarket_metrics upsert failed:", err);
    }

    return NextResponse.json({ data: row });
  } catch (error) {
    console.error("POST /api/deals/[id]/market-reports error:", error);
    return NextResponse.json({ error: "Market report extraction failed" }, { status: 500 });
  }
}

// ── Geocode pipeline projects ───────────────────────────────────────────────
//
// Broker research pipeline entries look like
//   { project_name: "The Aspen", developer: "X Co.", units: 324, submarket: "East Austin" }
//
// For the supply-pipeline map layer on the site plan we need lat/lng. The
// Census geocoder doesn't understand "The Aspen", but many research reports
// include an address too, and even "Project Name, Submarket, City" often
// resolves because Census accepts free-form strings. For everything that
// doesn't resolve, the entry stays in the list sans coords — the UI will
// render those in a sidebar table rather than on the map.

type PipelineEntry = {
  project_name?: string | null;
  developer?: string | null;
  units?: number | null;
  sf?: number | null;
  expected_delivery?: string | null;
  submarket?: string | null;
  address?: string | null;
  status?: string | null;
  lat?: number | null;
  lng?: number | null;
};

async function geocodePipeline(
  pipeline: PipelineEntry[],
  submarketFallback: string
): Promise<PipelineEntry[]> {
  if (!Array.isArray(pipeline) || pipeline.length === 0) return [];
  const out: PipelineEntry[] = [];
  // Cap at 20 so a big national report doesn't fan out 300 geocode calls.
  const MAX = 20;
  for (let i = 0; i < pipeline.length; i++) {
    const p = { ...pipeline[i] } as PipelineEntry;
    if (i >= MAX || (p.lat != null && p.lng != null)) {
      out.push(p);
      continue;
    }

    // Try Google Places first when the entry is project-name-only — Census
    // can't resolve "The Aspen" but Places can. When Places returns a real
    // street address, backfill `address` so the UI / map popover show it
    // instead of just the project name.
    if (!p.address && p.project_name) {
      const query = [p.project_name, p.submarket, submarketFallback]
        .filter((s) => s && String(s).trim())
        .join(", ");
      const hit = await placesLookupAddress(query);
      if (hit) {
        p.lat = hit.lat;
        p.lng = hit.lng;
        if (hit.address && !p.address) p.address = hit.address;
        await new Promise((resolve) => setTimeout(resolve, 100));
        out.push(p);
        continue;
      }
    }

    const addressCandidates = [
      p.address ? `${p.address}, ${submarketFallback}` : null,
      p.address,
      p.project_name && p.submarket ? `${p.project_name}, ${p.submarket}, ${submarketFallback}` : null,
      p.project_name && submarketFallback ? `${p.project_name}, ${submarketFallback}` : null,
    ].filter((s): s is string => Boolean(s && s.trim()));

    for (const candidate of addressCandidates) {
      try {
        const r = await geocodeAddress(candidate);
        if (r) {
          p.lat = r.lat;
          p.lng = r.lng;
          break;
        }
      } catch {
        // Continue to next candidate.
      }
    }
    // Politeness delay so we don't hammer the Census geocoder for big reports.
    await new Promise((resolve) => setTimeout(resolve, 100));
    out.push(p);
  }
  return out;
}
