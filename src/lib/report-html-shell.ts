import { parseInlineSpans, type BrandingTheme } from "@/lib/export-markdown";

/**
 * Shared HTML shell for branded PDF reports.
 *
 * Every generator that now renders to PDF via puppeteer shares this
 * shell — gives DD Abstract, Investment Package, and Zoning Report a
 * consistent cover, branded colors/fonts, and print CSS so the four
 * outputs look like a single product line instead of four one-offs.
 */

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline markdown (bold, italic, code) → HTML runs. */
export function inlineMarkdownToHtml(input: string): string {
  const spans = parseInlineSpans(input || "");
  return spans
    .map((s) => {
      let text = esc(s.text);
      if (s.code) text = `<code>${text}</code>`;
      if (s.italic) text = `<em>${text}</em>`;
      if (s.bold) text = `<strong>${text}</strong>`;
      return text;
    })
    .join("");
}

/**
 * Convert a block of markdown to HTML. Handles: headings, ordered /
 * unordered lists (nested), blockquotes, code fences, horizontal rules,
 * tables (pipe syntax), and paragraphs. Inline emphasis (bold / italic /
 * code) is threaded through parseInlineSpans.
 *
 * This is intentionally small — good enough for the prose we generate,
 * but not a full CommonMark parser. If a generator needs anything fancier
 * it should assemble its own HTML directly.
 */
export function markdownToHtml(md: string): string {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  let inCode = false;
  let codeBuf: string[] = [];
  // Open list stack: each entry is "ul" or "ol". The tag at the top is
  // the list currently receiving <li> children. We push a new list when
  // the indentation increases, pop when it decreases.
  const listStack: Array<{ tag: "ul" | "ol"; indent: number }> = [];
  let paraBuf: string[] = [];

  const closeAllLists = () => {
    while (listStack.length) {
      out.push(`</${listStack.pop()!.tag}>`);
    }
  };
  const flushPara = () => {
    if (paraBuf.length === 0) return;
    out.push(`<p>${inlineMarkdownToHtml(paraBuf.join(" "))}</p>`);
    paraBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");

    if (line.startsWith("```")) {
      flushPara();
      closeAllLists();
      if (inCode) {
        out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara(); closeAllLists();
      out.push("<hr />");
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      flushPara(); closeAllLists();
      const level = hMatch[1].length;
      out.push(`<h${level}>${inlineMarkdownToHtml(hMatch[2])}</h${level}>`);
      continue;
    }

    // Table (pipe syntax). Peek next line for separator.
    if (line.includes("|") && lines[i + 1]?.match(/^\s*\|?\s*:?-{2,}/)) {
      flushPara(); closeAllLists();
      const header = line.split("|").map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 || idx === arr.length - 1) || c);
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const cells = lines[i].split("|").map((c) => c.trim()).filter((c, idx, arr) => !(idx === 0 || idx === arr.length - 1) || c);
        rows.push(cells);
        i++;
      }
      i--;
      const thead = `<thead><tr>${header.map((c) => `<th>${inlineMarkdownToHtml(c)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMarkdownToHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
      out.push(`<table class="report-table">${thead}${tbody}</table>`);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      flushPara(); closeAllLists();
      out.push(`<blockquote>${inlineMarkdownToHtml(line.slice(2))}</blockquote>`);
      continue;
    }

    // Lists — supports indentation (2 spaces per level). "- / * / +"
    // for unordered, "1." (any digit) for ordered.
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      flushPara();
      const indent = listMatch[1].length;
      const marker = listMatch[2];
      const isOrdered = /\d/.test(marker);
      const tag: "ul" | "ol" = isOrdered ? "ol" : "ul";
      // Close any lists with deeper/equal indent and different tag
      while (listStack.length && listStack[listStack.length - 1].indent > indent) {
        out.push(`</${listStack.pop()!.tag}>`);
      }
      if (!listStack.length || listStack[listStack.length - 1].indent < indent || listStack[listStack.length - 1].tag !== tag) {
        // New list level
        out.push(`<${tag}>`);
        listStack.push({ tag, indent });
      }
      out.push(`<li>${inlineMarkdownToHtml(listMatch[3])}</li>`);
      continue;
    }

    // Blank line → paragraph break
    if (line.trim() === "") {
      flushPara();
      closeAllLists();
      continue;
    }

    // Default: accumulate paragraph
    paraBuf.push(line);
  }

  flushPara();
  closeAllLists();
  if (inCode && codeBuf.length) {
    out.push(`<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`);
  }
  return out.join("\n");
}

/** Wrap a branded HTML report in a print-ready full document. */
export interface ReportShellOptions {
  title: string;
  subtitle?: string;
  /** Deal / report name displayed on the cover. */
  headline: string;
  /** Small label above the headline (e.g. "INVESTMENT COMMITTEE MATERIALS"). */
  eyebrow?: string;
  /** Optional metadata chips shown under the headline. */
  chips?: string[];
  /** Body content as raw HTML (already rendered). */
  bodyHtml: string;
  /** Branding theme (colors, fonts, company info). */
  theme: BrandingTheme;
}

export function renderReportHtml(opts: ReportShellOptions): string {
  const t = opts.theme;
  const primary = "#" + t.primaryColor;
  const secondary = "#" + t.secondaryColor;
  const accent = "#" + t.accentColor;
  const ink = "#1E293B";
  const muted = "#64748B";
  const paper = "#FFFFFF";
  const rowAlt = "#F8FAFC";
  const headerFont = t.headerFont || "Georgia, 'Times New Roman', serif";
  const bodyFont = t.bodyFont || "'Inter', system-ui, sans-serif";
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const contacts = [t.website, t.email, t.phone].filter(Boolean).join("  ·  ");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(opts.title)}</title>
<style>
  :root {
    --primary: ${primary};
    --secondary: ${secondary};
    --accent: ${accent};
    --ink: ${ink};
    --muted: ${muted};
    --paper: ${paper};
    --row-alt: ${rowAlt};
    --header-font: ${headerFont};
    --body-font: ${bodyFont};
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: var(--body-font);
    color: var(--ink);
    background: var(--paper);
    font-size: 11pt;
    line-height: 1.5;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--header-font);
    color: var(--secondary);
    margin: 1.2em 0 0.4em;
    line-height: 1.2;
  }
  h1 { font-size: 24pt; color: var(--secondary); }
  h2 { font-size: 16pt; border-bottom: 1px solid #E5E7EB; padding-bottom: 0.15em; }
  h3 { font-size: 13pt; color: var(--primary); }
  h4 { font-size: 11.5pt; color: var(--primary); }
  p { margin: 0.5em 0; }
  ul, ol { margin: 0.5em 0 0.5em 1.2em; padding: 0; }
  li { margin: 0.15em 0; }
  blockquote {
    margin: 0.75em 0;
    padding: 0.5em 0.9em;
    border-left: 3px solid var(--accent);
    background: var(--row-alt);
    color: var(--ink);
    font-style: italic;
  }
  code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    background: #F1F5F9;
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.92em;
  }
  pre {
    background: #F1F5F9;
    padding: 0.75em 1em;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.92em;
  }
  pre code { background: none; padding: 0; }
  hr {
    border: 0;
    border-top: 1px solid #E5E7EB;
    margin: 1.2em 0;
  }
  a { color: var(--accent); text-decoration: none; }

  .cover {
    position: relative;
    padding: 48pt 40pt 40pt;
    border-top: 6px solid var(--primary);
    margin-bottom: 32pt;
  }
  .cover .eyebrow {
    font-family: var(--header-font);
    font-size: 9pt;
    color: var(--accent);
    letter-spacing: 0.18em;
    margin-bottom: 8pt;
    font-weight: 600;
    text-transform: uppercase;
  }
  .cover .subtitle {
    font-family: var(--header-font);
    color: var(--muted);
    font-size: 11pt;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 10pt;
  }
  .cover h1 {
    margin: 0 0 0.3em;
    font-size: 32pt;
    letter-spacing: -0.01em;
  }
  .cover .accent-rule {
    width: 48pt;
    height: 3pt;
    background: var(--accent);
    margin: 12pt 0;
  }
  .cover .date {
    color: var(--muted);
    font-size: 10pt;
    letter-spacing: 0.05em;
  }
  .cover .chips {
    margin-top: 12pt;
    display: flex;
    flex-wrap: wrap;
    gap: 8pt;
    font-size: 9pt;
    color: var(--muted);
  }
  .cover .chips .chip {
    padding: 3pt 9pt;
    border: 1px solid #E5E7EB;
    border-radius: 9999px;
  }
  .cover .confidential {
    font-family: var(--header-font);
    color: #C2410C;
    font-size: 8pt;
    letter-spacing: 0.18em;
    font-weight: 700;
    text-transform: uppercase;
    margin-bottom: 28pt;
  }

  .body { padding: 0 40pt 40pt; }
  .body > :first-child { margin-top: 0; }

  table.report-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75em 0;
    font-size: 10pt;
  }
  table.report-table th {
    background: var(--secondary);
    color: #fff;
    font-family: var(--header-font);
    font-weight: 600;
    text-align: left;
    padding: 6pt 8pt;
    font-size: 9pt;
    letter-spacing: 0.05em;
  }
  table.report-table td {
    padding: 5pt 8pt;
    border-bottom: 1px solid #E5E7EB;
    vertical-align: top;
  }
  table.report-table tr:nth-child(even) td { background: var(--row-alt); }

  .kv-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5em 0;
    font-size: 10pt;
  }
  .kv-table td { padding: 5pt 8pt; border-bottom: 1px solid #E5E7EB; }
  .kv-table td.key {
    width: 32%;
    font-family: var(--header-font);
    font-weight: 600;
    color: var(--secondary);
    background: var(--row-alt);
  }

  .section {
    margin-top: 24pt;
    page-break-inside: avoid;
  }
  .section-number {
    font-family: var(--header-font);
    color: var(--accent);
    font-size: 10pt;
    letter-spacing: 0.12em;
    font-weight: 600;
  }

  .report-footer {
    margin-top: 32pt;
    padding: 14pt 40pt 40pt;
    border-top: 1px solid #E5E7EB;
    color: var(--muted);
    font-size: 8pt;
    letter-spacing: 0.03em;
  }
  .report-footer .disclaimer {
    margin-top: 8pt;
    font-style: italic;
    color: #9CA3AF;
  }

  @page {
    size: letter;
    margin: 0.5in;
  }
  @media print {
    h2, h3, .section { break-inside: avoid; }
    a { color: var(--accent); }
  }
</style>
</head>
<body>
  <div class="cover">
    ${t.footerText ? `<div class="confidential">${esc(t.footerText)}</div>` : ""}
    ${opts.eyebrow ? `<div class="eyebrow">${esc(opts.eyebrow)}</div>` : ""}
    ${opts.subtitle ? `<div class="subtitle">${esc(opts.subtitle)}</div>` : ""}
    <h1>${esc(opts.headline)}</h1>
    <div class="accent-rule"></div>
    <div class="date">${esc(today)}</div>
    ${opts.chips && opts.chips.length > 0
      ? `<div class="chips">${opts.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>`
      : ""}
  </div>

  <div class="body">
    ${opts.bodyHtml}
  </div>

  <div class="report-footer">
    ${t.companyName ? `<div><strong>${esc(t.companyName)}</strong>${t.tagline ? ` — ${esc(t.tagline)}` : ""}</div>` : ""}
    ${contacts ? `<div>${esc(contacts)}</div>` : ""}
    ${t.disclaimerText ? `<div class="disclaimer">${esc(t.disclaimerText)}</div>` : ""}
  </div>
</body>
</html>`;
}

/** Render a key-value table as HTML. Values are rendered with inline markdown. */
export function renderKvTable(rows: Array<[string, string]>): string {
  const filtered = rows.filter(([, v]) => v && v !== "—" && v.trim() !== "");
  if (filtered.length === 0) return "";
  return `<table class="kv-table"><tbody>${filtered
    .map(([k, v]) => `<tr><td class="key">${esc(k)}</td><td>${inlineMarkdownToHtml(v)}</td></tr>`)
    .join("")}</tbody></table>`;
}
