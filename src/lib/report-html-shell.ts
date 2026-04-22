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
  // Editorial design system — Fraunces + JetBrains Mono, brick/ochre/
  // forest/wine palette. Every report (DD Abstract, Investment Memo,
  // Pitch Deck, One-Pager, Zoning Report, LOI) uses this shell so the
  // full generator suite reads like one product line. Brand theme
  // colors from the deal's business plan are intentionally ignored —
  // the IC Package spec fixed the palette at six semantic colors;
  // brand differentiation happens in copy + confidentiality marks,
  // not color.
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const contacts = [t.website, t.email, t.phone].filter(Boolean).join("  ·  ");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(opts.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root {
    /* Editorial palette — fixed per the IC Package spec. */
    --ink: #0a0d12;
    --paper: #f4efe6;
    --paper-2: #ebe4d4;
    --paper-3: #e0d8c6;
    --accent: #a8301a;        /* brick · primary */
    --accent-2: #b8862e;      /* ochre · secondary */
    --accent-3: #1f4638;      /* forest · positive */
    --accent-4: #6b2a48;      /* wine · alert */
    --muted: #3a362e;
    --subtle: rgba(10, 13, 18, 0.22);
    --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: var(--font-display);
    color: var(--ink);
    background: var(--paper);
    font-size: 11pt;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  body {
    background-image:
      radial-gradient(circle at 15% 5%, rgba(168,48,26,.045) 0%, transparent 35%),
      radial-gradient(circle at 85% 95%, rgba(31,70,56,.04) 0%, transparent 40%);
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-display);
    color: var(--ink);
    margin: 1.4em 0 0.5em;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }
  h1 { font-size: 32pt; font-weight: 800; letter-spacing: -0.02em; }
  h2 { font-size: 18pt; font-weight: 600; border-bottom: 1px solid var(--ink); padding-bottom: 0.25em; }
  h3 { font-size: 14pt; font-weight: 600; }
  h4 { font-size: 12pt; font-weight: 600; }
  h1 em, h2 em, h3 em, h4 em { font-style: italic; color: var(--accent); font-weight: 400; }
  p { margin: 0.6em 0; color: #1a1d22; }
  p em { font-style: italic; color: var(--accent); font-weight: 500; }
  p strong { font-weight: 600; color: var(--ink); }
  ul, ol { margin: 0.6em 0 0.6em 1.4em; padding: 0; }
  li { margin: 0.25em 0; }
  blockquote {
    margin: 1em 0;
    padding: 0.8em 1em;
    border-left: 4px solid var(--accent);
    background: var(--paper-2);
    font-style: italic;
  }
  code {
    font-family: var(--font-mono);
    background: var(--paper-3);
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.92em;
  }
  pre {
    background: var(--paper-3);
    padding: 0.75em 1em;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.92em;
    font-family: var(--font-mono);
  }
  pre code { background: none; padding: 0; }
  hr {
    border: 0;
    border-top: 1px solid var(--subtle);
    margin: 1.5em 0;
  }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); }

  /* Editorial masthead — kicker + headline + meta row matching the IC
     Package template. Any brand/footer confidentiality text flows
     through the kicker. */
  .cover {
    padding: 20pt 40pt 32pt;
    border-top: 4px solid var(--ink);
    border-bottom: 1px solid var(--ink);
    margin: 0 40pt 40pt;
  }
  .cover .eyebrow, .cover .subtitle, .cover .confidential {
    font-family: var(--font-mono);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    font-size: 9pt;
    color: var(--muted);
  }
  .cover .confidential { color: var(--muted); margin-bottom: 14pt; }
  .cover .eyebrow { color: var(--muted); margin-bottom: 14pt; }
  .cover .subtitle { color: var(--muted); margin-top: 12pt; }
  .cover h1 {
    margin: 0;
    font-size: 44pt;
    line-height: 0.92;
  }
  .cover .accent-rule { display: none; }
  .cover .date {
    font-family: var(--font-mono);
    color: var(--muted);
    font-size: 10pt;
    font-weight: 500;
    letter-spacing: 0.05em;
    margin-top: 14pt;
  }
  .cover .chips {
    margin-top: 14pt;
    display: flex;
    flex-wrap: wrap;
    gap: 6pt;
    font-family: var(--font-mono);
    font-size: 9pt;
    color: var(--muted);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .cover .chips .chip {
    padding: 3pt 8pt;
    border: 1px solid var(--ink);
    background: var(--paper-2);
  }

  .body { padding: 0 40pt 40pt; }
  .body > :first-child { margin-top: 0; }

  /* Tables inherit the hairline + paper aesthetic from the IC Package. */
  table.report-table, .kv-table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    font-size: 10.5pt;
    background: var(--paper-2);
    border: 1px solid var(--ink);
  }
  table.report-table th {
    background: var(--paper-3);
    color: var(--muted);
    font-family: var(--font-mono);
    font-weight: 700;
    text-align: left;
    padding: 8pt 10pt;
    font-size: 9pt;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    border-bottom: 2px solid var(--ink);
  }
  table.report-table td, .kv-table td {
    padding: 7pt 10pt;
    border-bottom: 1px solid var(--subtle);
    vertical-align: top;
    font-family: var(--font-display);
  }
  table.report-table tr:last-child td, .kv-table tr:last-child td { border-bottom: none; }
  .kv-table td.key {
    width: 34%;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 9.5pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    background: var(--paper-3);
  }

  /* Section header — numbered + italic emphasis, mirrors the IC
     Package .section-head. Use .section with an optional .section-
     number + h2 inside to get the treatment. */
  .section {
    margin-top: 36pt;
    page-break-inside: avoid;
  }
  .section-number {
    font-family: var(--font-mono);
    color: var(--accent);
    font-size: 10pt;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin-bottom: 4pt;
  }
  .section h2 { margin-top: 0.2em; }

  /* Callouts — cream box with brick left border, matching the IC
     Package .ic-callout. Any generator can drop in a
     div.callout block with a div.callout-label plus body content. */
  .callout {
    background: var(--paper-2);
    border-left: 4px solid var(--accent);
    padding: 14pt 18pt;
    margin: 16pt 0;
    page-break-inside: avoid;
  }
  .callout .callout-label {
    font-family: var(--font-mono);
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 6pt;
  }

  .report-footer {
    margin-top: 40pt;
    padding: 16pt 40pt 40pt;
    border-top: 4px solid var(--ink);
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: 9pt;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 24pt;
    flex-wrap: wrap;
  }
  .report-footer .disclaimer {
    flex-basis: 100%;
    margin-top: 8pt;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 8.5pt;
    letter-spacing: 0;
    text-transform: none;
    color: #8a8578;
  }
  .report-footer strong { color: var(--ink); font-weight: 700; }

  @page {
    size: letter;
    margin: 0.5in;
  }
  @media print {
    body { background: var(--paper) !important; }
    h2, h3, .section, .callout { break-inside: avoid; }
    a { color: var(--accent); }
  }
</style>
</head>
<body>
  <div class="cover">
    ${t.footerText ? `<div class="confidential">${esc(t.footerText)}</div>` : ""}
    ${opts.eyebrow ? `<div class="eyebrow">${esc(opts.eyebrow)}</div>` : ""}
    <h1>${esc(opts.headline)}</h1>
    ${opts.subtitle ? `<div class="subtitle">${esc(opts.subtitle)}</div>` : ""}
    <div class="date">${esc(today)}</div>
    ${opts.chips && opts.chips.length > 0
      ? `<div class="chips">${opts.chips.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>`
      : ""}
  </div>

  <div class="body">
    ${opts.bodyHtml}
  </div>

  <div class="report-footer">
    <div>${t.companyName ? `<strong>${esc(t.companyName)}</strong>${t.tagline ? ` · ${esc(t.tagline)}` : ""}` : ""}</div>
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
