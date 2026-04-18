// ─────────────────────────────────────────────────────────────────────────────
// Shared markdown renderer for DOCX + PPTX exports.
//
// Every investment-materials export (DD Abstract, Investment Memo, Pitch Deck,
// One-Pager, Zoning Report) pipes AI-generated markdown through this module so
// formatting is consistent. Colors and fonts come from the deal's business
// plan branding — callers pass in a resolved BrandingTheme built from
// getBrandingForDeal().
//
// Previously each route had its own ad-hoc regex stripping that silently
// discarded **bold**, *italic*, `code`, markdown tables, and blockquotes.
// The user-facing symptoms were flattened emphasis, missing data tables in
// slides, and text clipped off the bottom of slides. This module fixes all
// of that in one place.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
  ShadingType,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";

// ─── Branding theme ─────────────────────────────────────────────────────────

export interface BrandingTheme {
  companyName: string;
  tagline: string;
  primaryColor: string;   // hex w/o "#"
  secondaryColor: string; // hex w/o "#"
  accentColor: string;    // hex w/o "#"
  headerFont: string;
  bodyFont: string;
  footerText: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  disclaimerText: string;
  logoUrl: string | null;
}

export function resolveBranding(raw: Record<string, unknown> | null | undefined): BrandingTheme {
  const b = raw ?? {};
  const clean = (c: unknown, fallback: string) =>
    typeof c === "string" && c.trim() ? c.replace("#", "") : fallback;
  return {
    companyName: (b.company_name as string) || "",
    tagline: (b.tagline as string) || "",
    primaryColor: clean(b.primary_color, "4F46E5"),
    secondaryColor: clean(b.secondary_color, "2F3B52"),
    accentColor: clean(b.accent_color, "10B981"),
    headerFont: (b.header_font as string) || "Helvetica",
    bodyFont: (b.body_font as string) || "Calibri",
    footerText: (b.footer_text as string) || "STRICTLY CONFIDENTIAL",
    website: (b.website as string) || "",
    email: (b.email as string) || "",
    phone: (b.phone as string) || "",
    address: (b.address as string) || "",
    disclaimerText: (b.disclaimer_text as string) || "",
    logoUrl: (b.logo_url as string) || null,
  };
}

// ─── Inline markdown → {bold, italic, code} runs ─────────────────────────────
//
// Walk the string once. Track open markers (`**`, `*`, `` ` ``) and emit a
// flat list of {text, bold?, italic?, code?} spans. Unclosed markers are
// rendered as literal text so users never see a stray `*` or backtick leak
// into the final document.

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export function parseInlineSpans(input: string): InlineSpan[] {
  if (!input) return [];
  const out: InlineSpan[] = [];
  let buf = "";
  let bold = false;
  let italic = false;
  let code = false;
  const flush = () => {
    if (buf) {
      out.push({ text: buf, bold, italic, code });
      buf = "";
    }
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const next = input[i + 1];
    if (!code && c === "*" && next === "*") {
      flush();
      bold = !bold;
      i++;
      continue;
    }
    if (!code && c === "*") {
      flush();
      italic = !italic;
      continue;
    }
    if (c === "`") {
      flush();
      code = !code;
      continue;
    }
    buf += c;
  }
  // If we exit with an unclosed marker, restore literal characters so the
  // user sees clean text rather than a vanished fragment.
  if (bold) {
    flush();
    out.unshift({ text: "**" });
  } else if (italic) {
    flush();
    out.unshift({ text: "*" });
  } else if (code) {
    flush();
    out.unshift({ text: "`" });
  } else {
    flush();
  }
  return out;
}

// ─── DOCX: inline runs, paragraphs, tables ──────────────────────────────────

export function spansToDocxRuns(
  spans: InlineSpan[],
  base: { size: number; color?: string; font: string }
): TextRun[] {
  if (spans.length === 0) return [new TextRun({ text: "", ...base })];
  return spans.map((s) => {
    if (s.code) {
      return new TextRun({
        text: s.text,
        font: "Courier New",
        size: Math.max(16, base.size - 2),
        color: base.color,
        shading: { type: ShadingType.SOLID, color: "F3F4F6" },
      });
    }
    return new TextRun({
      text: s.text,
      bold: s.bold,
      italics: s.italic,
      size: base.size,
      color: base.color,
      font: base.font,
    });
  });
}

export function inlineToDocxRuns(
  text: string,
  base: { size: number; color?: string; font: string }
): TextRun[] {
  return spansToDocxRuns(parseInlineSpans(text), base);
}

// Render a full markdown string as an ordered list of docx children
// (Paragraph or Table). The caller is responsible for wrapping the result
// in a section.
export function markdownToDocx(
  markdown: string,
  theme: BrandingTheme,
  opts?: { bodySize?: number; bodyColor?: string }
): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [];
  const bodySize = opts?.bodySize ?? 22;
  const bodyColor = opts?.bodyColor ?? "1E293B";
  const bFont = theme.bodyFont;
  const hFont = theme.headerFont;

  const lines = markdown.split("\n");
  let lastWasBlank = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Blank line — add spacing ONCE, not per empty line (prevents blank-page bloat)
    if (!trimmed) {
      if (!lastWasBlank) children.push(new Paragraph({ spacing: { before: 100 } }));
      lastWasBlank = true;
      continue;
    }
    lastWasBlank = false;

    // Headings — size scales with level so H1 > H2 > H3 visually
    const h1 = trimmed.match(/^#\s+(.+)/);
    if (h1) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: h1[1].replace(/\*\*/g, ""), size: 32, bold: true, color: theme.secondaryColor, font: hFont })],
        spacing: { before: 320, after: 160 },
      }));
      continue;
    }
    const h2 = trimmed.match(/^##\s+(.+)/);
    if (h2) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: h2[1].replace(/\*\*/g, ""), size: 26, bold: true, color: theme.primaryColor, font: hFont })],
        spacing: { before: 260, after: 120 },
      }));
      continue;
    }
    const h3 = trimmed.match(/^###\s+(.+)/);
    if (h3) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: h3[1].replace(/\*\*/g, ""), size: 22, bold: true, color: theme.accentColor, font: hFont })],
        spacing: { before: 200, after: 100 },
      }));
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
        spacing: { before: 120, after: 120 },
      }));
      continue;
    }

    // Markdown table: | col | col |\n| --- | --- |\n| row | row |
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      i--;
      const table = renderDocxTable(tableLines, theme, bodySize);
      if (table) children.push(table);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      children.push(new Paragraph({
        children: inlineToDocxRuns(trimmed.slice(2), { size: bodySize, color: bodyColor, font: bFont }),
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 16, color: theme.primaryColor } },
        shading: { type: ShadingType.SOLID, color: "F8FAFC" },
        spacing: { before: 80, after: 80 },
      }));
      continue;
    }

    // Unordered list (supports nested via leading whitespace)
    const ulMatch = raw.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      const level = Math.min(2, Math.floor(indent / 2));
      children.push(new Paragraph({
        bullet: { level },
        children: inlineToDocxRuns(ulMatch[2], { size: bodySize, color: bodyColor, font: bFont }),
        spacing: { before: 40, after: 40 },
      }));
      continue;
    }

    // Ordered list — render as a plain indented paragraph with a literal
    // numeric prefix. We deliberately do NOT use docx's numbering.reference
    // feature because docx@9.x has been inconsistent about accepting the
    // INumberingOptions shape; a single malformed field crashes the whole
    // Packer.toBuffer() with the opaque error users saw as "Export failed".
    // A literal "1. foo" paragraph survives every version.
    const olMatch = raw.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (olMatch) {
      const indentCols = olMatch[1].length;
      const level = Math.min(2, Math.floor(indentCols / 2));
      const leftIndent = 360 + level * 360;
      children.push(new Paragraph({
        indent: { left: leftIndent, hanging: 260 },
        children: inlineToDocxRuns(`${olMatch[2]}.  ${olMatch[3]}`, { size: bodySize, color: bodyColor, font: bFont }),
        spacing: { before: 40, after: 40 },
      }));
      continue;
    }

    // Plain paragraph — preserves inline bold/italic/code as runs
    children.push(new Paragraph({
      children: inlineToDocxRuns(trimmed, { size: bodySize, color: bodyColor, font: bFont }),
      spacing: { before: 80, after: 80 },
    }));
  }
  return children;
}

function renderDocxTable(
  tableLines: string[],
  theme: BrandingTheme,
  bodySize: number
): Table | null {
  // Drop the `| --- | --- |` separator line if present
  const rows = tableLines.filter((l) => !/^\|\s*[-: ]+[-| :]*$/.test(l));
  if (rows.length === 0) return null;
  const parsed = rows.map((l) =>
    l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
  );
  const colCount = Math.max(...parsed.map((r) => r.length));
  const trs = parsed.map((cells, rowIdx) => {
    const tcs: TableCell[] = [];
    for (let c = 0; c < colCount; c++) {
      const text = cells[c] ?? "";
      const isHeader = rowIdx === 0;
      tcs.push(new TableCell({
        width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
        shading: isHeader ? { type: ShadingType.SOLID, color: theme.primaryColor } : undefined,
        children: [new Paragraph({
          children: inlineToDocxRuns(text, {
            size: bodySize - 2,
            color: isHeader ? "FFFFFF" : "1E293B",
            font: theme.bodyFont,
          }).map((r) => {
            if (isHeader) Object.assign(r, {});
            return r;
          }),
          spacing: { before: 40, after: 40 },
        })],
      }));
    }
    return new TableRow({ children: tcs });
  });
  return new Table({
    rows: trs,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: shadeHex(theme.primaryColor, 0.55) },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: shadeHex(theme.primaryColor, 0.55) },
      left: { style: BorderStyle.SINGLE, size: 2, color: "E5E7EB" },
      right: { style: BorderStyle.SINGLE, size: 2, color: "E5E7EB" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
    },
  });
}

// Historically we registered a real docx INumberingOptions config here so
// ordered list paragraphs could reference it via `numbering.reference`.
// That feature crashed Packer.toBuffer() on certain docx@9.x patch versions
// (the symptom users saw was the opaque "Export failed" toast).
// markdownToDocx() now renders ordered lists as plain paragraphs with a
// literal "1. foo" prefix, so no numbering registration is needed. This
// export is kept as an empty-shape stub so legacy callers compile cleanly;
// passing it into new Document({ numbering: DOCX_NUMBERING, ... }) is a
// no-op on a Document that has no numbering.reference paragraphs.
export const DOCX_NUMBERING = { config: [] as unknown[] };

// Lighten (positive amt) or darken (negative amt) a 6-char hex color.
// amt in [-1, 1]. 0.7 blends 70% toward white — good for light tinted
// borders. -0.2 mixes 20% black — good for subtle darker accents.
//
// CRITICAL: docx@9.x only accepts 6-digit hex color values. Earlier
// versions of these exports tried to get a semi-transparent border by
// concatenating `primaryColor + "66"` (8-digit hex with alpha), which
// caused "Invalid hex value" errors at Packer.toBuffer() time — the
// symptom users saw was "Export failed: Invalid hex value '4F46E566'".
// Callers that want a light-tinted border should use shadeHex(color, 0.7)
// instead of string-concatenating an alpha suffix.
export function shadeHex(hex: string, amt: number): string {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  const adj = (c: number) => {
    const t = amt < 0 ? 0 : 255;
    const p = Math.abs(amt);
    return Math.round((t - c) * p + c);
  };
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return toHex(adj(r)) + toHex(adj(g)) + toHex(adj(b));
}

// ─── PPTX: inline-run rendering + paragraph building ────────────────────────

export interface PptxRun {
  text: string;
  options: Record<string, unknown>;
}

// Render one markdown line into an array of PPTX runs preserving bold /
// italic / code as true run-level formatting (PptxGenJS supports mixing
// multiple runs inside a single addText call by passing an array).
export function inlineToPptxRuns(
  text: string,
  base: { fontSize: number; color: string; font: string }
): PptxRun[] {
  const spans = parseInlineSpans(text);
  if (spans.length === 0) return [{ text, options: { ...base, fontFace: base.font } }];
  return spans.map((s) => {
    const opts: Record<string, unknown> = {
      fontSize: base.fontSize,
      color: base.color,
      fontFace: s.code ? "Courier New" : base.font,
      bold: s.bold,
      italic: s.italic,
    };
    return { text: s.text, options: opts };
  });
}

// Convert a markdown string into a flat list of PptxGenJS "text option" blocks.
// One block per visual line. Each block's `text` may itself be a string OR an
// array of runs when the line contains inline formatting. The returned list
// is suitable for passing as the first arg to `slide.addText([...], {...})`.
export interface PptxBlock {
  text: string | PptxRun[];
  options: Record<string, unknown>;
}

export function markdownToPptxBlocks(
  markdown: string,
  theme: BrandingTheme,
  text: string,
  accent: string,
  muted: string
): PptxBlock[] {
  const blocks: PptxBlock[] = [];
  const lines = markdown.split("\n");
  let lastWasBlank = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      lastWasBlank = true;
      continue;
    }

    // Markdown tables — render as indented two-column text blocks. A full
    // PPTX table would require a separate slide object, so we flatten into
    // "Label: value" rows which read cleanly inside the content box.
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      i--;
      const rows = tableLines.filter((l) => !/^\|\s*[-: ]+[-| :]*$/.test(l));
      if (rows.length === 0) continue;
      const parsed = rows.map((l) =>
        l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim())
      );
      const header = parsed[0];
      for (let r = 1; r < parsed.length; r++) {
        const row = parsed[r];
        const parts = header.map((h, c) => `${h || "?"}: ${row[c] || ""}`).join("  ·  ");
        blocks.push({
          text: inlineToPptxRuns(parts, { fontSize: 10, color: text, font: theme.bodyFont }),
          options: { fontSize: 10, color: text, paraSpaceBefore: 4, breakType: "none" as const },
        });
      }
      lastWasBlank = false;
      continue;
    }

    // Horizontal rule → small visual break line
    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push({
        text: "—",
        options: { fontSize: 10, color: muted, paraSpaceBefore: 4, breakType: "none" as const },
      });
      continue;
    }

    // Headings — size + color differentiation inside the content frame
    const h = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 16 : level === 2 ? 14 : 12;
      const color = level === 1 ? theme.secondaryColor : accent;
      blocks.push({
        text: h[2].replace(/\*\*/g, "").replace(/`/g, ""),
        options: { fontSize: size, color, bold: true, fontFace: theme.headerFont, paraSpaceBefore: lastWasBlank ? 12 : 8, breakType: "none" as const },
      });
      lastWasBlank = false;
      continue;
    }

    // Emphasized-only line → render as a mini subheading. The AI memo
    // prompts emit labels like `**THESIS**`, `**THREE REASONS THIS WORKS**`,
    // and `**THREE REASONS IT FAILS**` on their own lines. Without this
    // carve-out they'd render as plain inline bold with no visible hierarchy
    // on the slide. Matches the whole line being wrapped in `**...**` with
    // no other content.
    const emph = trimmed.match(/^\*\*(.+?)\*\*:?$/);
    if (emph && !emph[1].includes("**")) {
      blocks.push({
        text: emph[1].toUpperCase(),
        options: {
          fontSize: 12,
          color: accent,
          bold: true,
          fontFace: theme.headerFont,
          charSpacing: 4,
          paraSpaceBefore: lastWasBlank ? 14 : 10,
          breakType: "none" as const,
        },
      });
      lastWasBlank = false;
      continue;
    }

    // Blockquote — indented, muted, italic
    if (trimmed.startsWith("> ")) {
      blocks.push({
        text: "  " + trimmed.slice(2).replace(/\*\*/g, "").replace(/`/g, ""),
        options: { fontSize: 11, color: muted, italic: true, fontFace: theme.bodyFont, paraSpaceBefore: 4, breakType: "none" as const },
      });
      lastWasBlank = false;
      continue;
    }

    // Unordered list
    const ulMatch = raw.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      const pad = indent >= 2 ? "      " : "  ";
      blocks.push({
        text: inlineToPptxRuns(pad + "• " + ulMatch[2], { fontSize: 11, color: text, font: theme.bodyFont }),
        options: { fontSize: 11, color: text, paraSpaceBefore: 2, breakType: "none" as const },
      });
      lastWasBlank = false;
      continue;
    }

    // Ordered list
    const olMatch = raw.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (olMatch) {
      blocks.push({
        text: inlineToPptxRuns(`  ${olMatch[2]}. ${olMatch[3]}`, { fontSize: 11, color: text, font: theme.bodyFont }),
        options: { fontSize: 11, color: text, paraSpaceBefore: 2, breakType: "none" as const },
      });
      lastWasBlank = false;
      continue;
    }

    // Plain paragraph
    blocks.push({
      text: inlineToPptxRuns(trimmed, { fontSize: 11, color: text, font: theme.bodyFont }),
      options: { fontSize: 11, color: text, paraSpaceBefore: lastWasBlank ? 8 : 4, breakType: "none" as const },
    });
    lastWasBlank = false;
  }

  return blocks;
}
