/**
 * Shared renderer for any generator that composes its own body HTML
 * then wraps it in the branded report shell (cover, typography,
 * footer). Used by DD Abstract, Zoning Report, Proforma, LOI — each
 * passes in its already-built body HTML plus metadata.
 *
 * Returns a complete GenerateResult ready for artifactQueries.saveLatest.
 */

import { v4 as uuidv4 } from "uuid";
import { getBrandingForDeal } from "@/lib/db";
import { resolveBranding } from "@/lib/export-markdown";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { renderReportHtml } from "@/lib/report-html-shell";
import { uploadBlob } from "@/lib/blob-storage";
import { computeArtifactHash } from "@/lib/artifact-hash";
import type { ArtifactKind } from "@/lib/artifact-hash";
import type { GenerateOptions, GenerateResult } from "../types";

export interface BrandedPdfOptions {
  kind: ArtifactKind;
  /** Cover-page headline. Usually the deal name. */
  headline: string;
  /** Small eyebrow text above the headline ("IC PRE-READ", etc.). */
  eyebrow: string;
  /** Subtitle under the headline. */
  subtitle: string;
  /** Body HTML to embed in the shell's content region. */
  bodyHtml: string;
  /** Human-friendly name shown in the library row + filename prefix. */
  artifactTitle: string;
  /** One-line description used as ai_summary. */
  summary: string;
  /** Optional plaintext content for search / re-use. */
  contentText?: string | null;
  /** Extra kind-specific inputs to fold into the staleness hash. */
  hashExtras?: Record<string, unknown>;
  /** Optional deal + UW snapshot for staleness. If absent we hash
   *  only what `hashExtras` provides. */
  deal?: { id: string; updated_at: string | Date | null } | null;
  underwriting?: { id: string; updated_at: string | Date | null } | null;
}

export async function renderBrandedPdf(
  opts: GenerateOptions,
  cfg: BrandedPdfOptions
): Promise<GenerateResult> {
  let branding: Record<string, unknown> | null = null;
  try {
    branding = await getBrandingForDeal(opts.dealId);
  } catch {
    /* defaults */
  }
  const theme = resolveBranding(branding);

  const html = renderReportHtml({
    title: `${cfg.artifactTitle} — ${cfg.headline}`,
    headline: cfg.headline,
    subtitle: cfg.subtitle,
    eyebrow: cfg.eyebrow,
    bodyHtml: cfg.bodyHtml,
    theme,
  });

  const pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in" });

  const safeName = cfg.headline.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60);
  const filename = `${cfg.artifactTitle.replace(/\s+/g, "-")}-${safeName}.pdf`;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const blobPath = `deals/${opts.dealId}/reports/${dateStamp}-${uuidv4()}-${filename}`;
  const fileUrl = await uploadBlob(blobPath, pdf, "application/pdf");

  const { snapshot, hash } = computeArtifactHash({
    deal: cfg.deal ?? null,
    underwriting: cfg.underwriting ?? null,
    extras: cfg.hashExtras ?? {},
  });

  const kindSlug = cfg.kind.replace(/_/g, "-");

  return {
    title: `${cfg.artifactTitle} — ${cfg.headline}`,
    filename,
    filePath: fileUrl,
    fileSize: pdf.length,
    mimeType: "application/pdf",
    summary: cfg.summary,
    tags: [
      kindSlug,
      "ai-generated",
      "pdf",
      ...(opts.massingId ? [`massing:${opts.massingId}`] : []),
    ],
    inputSnapshot: snapshot,
    inputHash: hash,
    contentText: cfg.contentText ?? null,
  };
}
