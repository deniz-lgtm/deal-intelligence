// Split long PDFs into page-range chunks.
//
// Anthropic's native PDF document block accepts up to 100 pages per request,
// and model attention degrades well before that on dense comp-grid documents.
// For a 90-page national CBRE report with comps distributed evenly, a single
// pass tends to skip the middle — sending chunks of ~30 pages gives the model
// a fighting chance at every page.

import { PDFDocument } from "pdf-lib";

export interface PdfChunk {
  buffer: Buffer;
  startPage: number; // 1-indexed, inclusive
  endPage: number;   // 1-indexed, inclusive
  pageCount: number;
}

/**
 * Return the page count of a PDF buffer without rendering anything.
 * Uses pdf-lib (already a dep) so we don't pull in a new parser.
 */
export async function pdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Split a PDF into contiguous page-range chunks. Chunks are produced as
 * standalone PDF buffers that each claude.messages.create() call can pass
 * as a native document block.
 *
 * Returns a single chunk containing the original buffer when the document
 * fits under `maxPagesPerChunk` — no re-serialization needed, cheaper.
 */
export async function chunkPdfByPages(
  buffer: Buffer,
  maxPagesPerChunk = 30,
  maxChunks = 4
): Promise<PdfChunk[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();

  if (total <= maxPagesPerChunk) {
    return [{ buffer, startPage: 1, endPage: total, pageCount: total }];
  }

  const chunks: PdfChunk[] = [];
  for (let start = 0; start < total && chunks.length < maxChunks; start += maxPagesPerChunk) {
    const end = Math.min(start + maxPagesPerChunk, total);
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copied = await out.copyPages(src, indices);
    for (const p of copied) out.addPage(p);
    const bytes = await out.save();
    chunks.push({
      buffer: Buffer.from(bytes),
      startPage: start + 1,
      endPage: end,
      pageCount: end - start,
    });
  }
  return chunks;
}
