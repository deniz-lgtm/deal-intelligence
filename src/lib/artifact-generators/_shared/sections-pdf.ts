/**
 * Shared renderer for section-based investment-package formats.
 *
 * pitch_deck, investment_memo, and one_pager all consume the same input
 * shape (wizard sections with notes + generatedContent) and produce the
 * same HTML→PDF output. They differ only in the titles, the eyebrow
 * label, and the section filter applied upstream (the wizard's
 * FORMAT_SECTIONS config).
 */

import { v4 as uuidv4 } from "uuid";
import { getBrandingForDeal } from "@/lib/db";
import { resolveBranding } from "@/lib/export-markdown";
import { htmlToPdf, PuppeteerMissingError } from "@/lib/html-to-pdf";
import { markdownToHtml, renderReportHtml } from "@/lib/report-html-shell";
import { uploadBlob } from "@/lib/blob-storage";
import { computeArtifactHash } from "@/lib/artifact-hash";
import type { ArtifactKind } from "@/lib/artifact-hash";
import type { GenerateOptions, GenerateResult } from "../types";

export interface WizardSection {
  id: string;
  title: string;
  notes?: Array<{ text: string }>;
  generatedContent?: string;
}

export interface SectionsPdfOptions {
  kind: ArtifactKind;
  /** Title rendered into the artifact row + filename prefix. */
  artifactTitle: string;
  /** Eyebrow line on the cover (e.g. "IC MEMO", "PITCH DECK"). */
  eyebrow: string;
  /** Subtitle under the headline on the cover. */
  subtitle: string;
  /** Single-line descriptor used as the artifact's ai_summary. */
  summaryPrefix: string;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface SectionsPayload {
  sections?: WizardSection[];
  dealName?: string;
  deal?: { id: string; updated_at: string | Date | null; name?: string } | null;
  underwriting?: { id: string; updated_at: string | Date | null } | null;
}

/** Core renderer used by each section-based generator. */
export async function generateSectionsPdf(
  opts: GenerateOptions,
  cfg: SectionsPdfOptions
): Promise<GenerateResult> {
  const payload = (opts.payload ?? {}) as SectionsPayload;
  const sections = payload.sections ?? [];
  const dealName = payload.dealName ?? "Untitled Deal";

  const renderable = sections.filter(
    (s) =>
      s.generatedContent ||
      (s.notes ?? []).filter((n) => n.text?.trim()).length > 0
  );

  const tocHtml =
    renderable.length > 1
      ? `<div class="section">
           <h2>Table of Contents</h2>
           <ol>${renderable.map((s) => `<li>${esc(s.title)}</li>`).join("")}</ol>
         </div>`
      : "";

  const sectionsHtml = renderable
    .map((section, i) => {
      const md = section.generatedContent
        ? section.generatedContent
        : (section.notes ?? [])
            .filter((n) => n.text?.trim())
            .map((n) => `- ${n.text}`)
            .join("\n");
      const num = String(i + 1).padStart(2, "0");
      const total = String(renderable.length).padStart(2, "0");
      return `<div class="section">
                <div class="section-number">${num} / ${total}</div>
                <h2>${esc(section.title)}</h2>
                ${markdownToHtml(md)}
              </div>`;
    })
    .join("");

  let branding: Record<string, unknown> | null = null;
  try {
    branding = await getBrandingForDeal(opts.dealId);
  } catch {
    /* fall back to default theme */
  }
  const theme = resolveBranding(branding);

  const html = renderReportHtml({
    title: `${cfg.artifactTitle} — ${dealName}`,
    headline: dealName,
    subtitle: cfg.subtitle,
    eyebrow: cfg.eyebrow,
    bodyHtml: tocHtml + sectionsHtml,
    theme,
  });

  let pdf: Buffer;
  try {
    pdf = await htmlToPdf(html, { format: "Letter", margin: "0.5in" });
  } catch (err) {
    if (err instanceof PuppeteerMissingError) {
      throw err;
    }
    throw err;
  }

  const safeName = dealName.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60);
  const kindSlug = cfg.kind.replace(/_/g, "-");
  const filename = `${cfg.artifactTitle.replace(/\s+/g, "-")}-${safeName}.pdf`;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const blobId = uuidv4();
  const blobPath = `deals/${opts.dealId}/reports/${dateStamp}-${blobId}-${filename}`;
  const fileUrl = await uploadBlob(blobPath, pdf, "application/pdf");

  const { snapshot, hash } = computeArtifactHash({
    deal: payload.deal ?? null,
    underwriting: payload.underwriting ?? null,
    extras: {
      sectionIds: renderable.map((s) => s.id),
      sectionCount: renderable.length,
    },
  });

  return {
    title: `${cfg.artifactTitle} — ${dealName}`,
    filename,
    filePath: fileUrl,
    fileSize: pdf.length,
    mimeType: "application/pdf",
    summary: `${cfg.summaryPrefix} · ${new Date().toLocaleDateString()} · ${renderable.length} sections`,
    tags: [
      kindSlug,
      "ai-generated",
      "pdf",
      ...(opts.massingId ? [`massing:${opts.massingId}`] : []),
    ],
    inputSnapshot: snapshot,
    inputHash: hash,
    contentText: null,
  };
}
