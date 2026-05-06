import type { PlaybookChunkRow } from "@/lib/db";

export const MAX_PLAYBOOK_UPLOAD_BYTES = 50 * 1024 * 1024;

export type PlaybookBuiltChunk = {
  chunk_index: number;
  heading: string | null;
  content: string;
  token_estimate: number;
};

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export async function extractPlaybookText(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const lowerName = fileName.toLowerCase();
  const normalizedMime = mimeType || "application/octet-stream";

  if (normalizedMime === "application/pdf" || lowerName.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return cleanText(data.text || "");
  }

  if (
    normalizedMime.startsWith("text/") ||
    normalizedMime === "application/json" ||
    normalizedMime.includes("xml") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".txt")
  ) {
    return cleanText(buffer.toString("utf-8"));
  }

  throw new Error("Unsupported playbook file type. Upload a PDF, Markdown, or text file.");
}

export function buildPlaybookChunks(text: string): PlaybookBuiltChunk[] {
  const cleaned = cleanText(text);
  if (!cleaned.trim()) return [];

  const paragraphs = cleaned
    .replace(/\n(?=\|[^|\n]+\|)/g, "\n\n")
    .replace(/\n(?=(?:[-*]|\d+\.)\s+)/g, "\n\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: PlaybookBuiltChunk[] = [];
  let current = "";
  let heading: string | null = null;
  const maxChars = 2400;
  const overlapChars = 240;

  for (const paragraph of paragraphs) {
    if (!heading) heading = inferHeading(paragraph);

    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(makeChunk(chunks.length, current, heading));
      const overlap = current.slice(Math.max(0, current.length - overlapChars));
      current = `${overlap}\n\n${paragraph}`;
      heading = inferHeading(paragraph) || heading;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.trim()) {
    chunks.push(makeChunk(chunks.length, current, heading));
  }

  return chunks;
}

export function formatPlaybookContext(hits: PlaybookChunkRow[]): string {
  if (hits.length === 0) return "No matching playbook excerpts were found.";

  return hits
    .map((hit, index) => {
      const citation = index + 1;
      const title = hit.document_title || hit.original_name;
      const heading = hit.heading ? ` - ${hit.heading}` : "";
      return `[${citation}] ${title}${heading} (chunk ${hit.chunk_index + 1})\n${trimExcerpt(hit.content)}`;
    })
    .join("\n\n---\n\n");
}

export function publicPlaybookSource(hit: PlaybookChunkRow, index: number) {
  return {
    citation: index + 1,
    document_id: hit.document_id,
    document_title: hit.document_title,
    document_category: hit.document_category,
    original_name: hit.original_name,
    chunk_index: hit.chunk_index,
    heading: hit.heading,
    excerpt: hit.content.slice(0, 320),
  };
}

function makeChunk(index: number, content: string, heading: string | null): PlaybookBuiltChunk {
  const trimmed = content.trim();
  return {
    chunk_index: index,
    heading,
    content: trimmed,
    token_estimate: Math.ceil(trimmed.length / 4),
  };
}

function trimExcerpt(content: string): string {
  const clean = content.trim();
  if (clean.length <= 1400) return clean;
  const clipped = clean.slice(0, 1400);
  const lastBreak = Math.max(clipped.lastIndexOf("\n\n"), clipped.lastIndexOf(". "));
  return `${clipped.slice(0, lastBreak > 700 ? lastBreak + 1 : 1400).trim()}...`;
}

function inferHeading(text: string): string | null {
  const firstLine = text.split("\n")[0]?.trim();
  if (!firstLine) return null;

  const markdownHeading = firstLine.match(/^#{1,6}\s+(.+)$/);
  if (markdownHeading) return markdownHeading[1].trim().slice(0, 120);

  if (firstLine.length <= 90 && /[A-Za-z]/.test(firstLine)) {
    return firstLine.replace(/[:.-]\s*$/, "").slice(0, 120);
  }

  return null;
}

function cleanText(text: string): string {
  return text
    .replace(/\x00/g, "")
    .replace(/[\uFFFD]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
