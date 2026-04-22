/**
 * LOI HTML composer — pure, server-safe, shared between:
 *   - the LOI page's inline preview
 *   - the loi artifact generator (HTML → puppeteer PDF)
 *
 * Uses the editorial design system (Fraunces + JetBrains Mono, brick/
 * ochre/forest palette) so an LOI reads like the rest of the
 * generated artifacts — the binding terms, the pitch deck, and the
 * IC Package all look like they came from the same firm. The `branding`
 * argument is still honored for the header (logo + entity info) and
 * disclaimer text; the typography + palette are fixed.
 */

import type { LOIData } from "@/lib/types";

export interface BrandingData {
  company_name?: string | null;
  tagline?: string | null;
  logo_url?: string | null;
  logo_width?: number | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  accent_color?: string | null;
  header_font?: string | null;
  body_font?: string | null;
  footer_text?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  disclaimer_text?: string | null;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generateLOIHtml(
  data: LOIData,
  address: string,
  branding?: BrandingData | null
): string {
  const b = branding ?? {};
  const footerText = b.footer_text || "CONFIDENTIAL";
  const companyName = b.company_name || "";

  const fmt = (n: number | null) => (n ? `$${n.toLocaleString()}` : "_____________");
  const fmtDays = (n: number | null) => (n ? `${n}` : "___");
  const dateStr = data.loi_date
    ? new Date(data.loi_date + "T00:00:00").toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "_______________";

  const logoHtml = b.logo_url
    ? `<img src="${esc(b.logo_url)}" alt="${esc(companyName)}" style="max-height: 64px; width: ${b.logo_width || 140}px; object-fit: contain;" />`
    : `<div class="logo-placeholder">LOGO</div>`;

  const entityName = companyName || "[ENTITY NAME]";
  const entityAddress = b.address || "[ENTITY ADDRESS LINE 1]<br/>[CITY, STATE ZIP]";
  const contactBits = [b.phone || "[PHONE]", b.email || "[EMAIL]"].join("  ·  ");

  const paymentTerms = data.as_is ? "All cash to Seller" : "[PAYMENT TERMS]";
  const financingLine = data.has_financing_contingency
    ? `${fmtDays(data.financing_contingency_days)} day financing contingency${
        data.lender_name ? ` (anticipated lender: ${esc(data.lender_name)})` : ""
      }`
    : "None — Buyer obtaining loan without contingency";
  const propertyRef = address || "[PROPERTY ADDRESS], [CITY, STATE]";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Letter of Intent${companyName ? ` — ${esc(companyName)}` : ""}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #0a0d12;
    --paper: #f4efe6;
    --paper-2: #ebe4d4;
    --paper-3: #e0d8c6;
    --accent: #a8301a;
    --accent-2: #b8862e;
    --muted: #3a362e;
    --subtle: rgba(10, 13, 18, 0.22);
    --font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: var(--font-display);
    color: var(--ink);
    background: var(--paper);
    font-size: 11pt;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  body {
    max-width: 800px;
    margin: 40px auto;
    padding: 0 40px 60px;
  }
  p { margin: 10px 0; }
  p em { font-style: italic; color: var(--accent); font-weight: 500; }
  p strong { font-weight: 600; }
  ol { margin: 12px 0 16px 24px; }
  ol li { margin: 6px 0; }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); }

  .branded-header {
    border-top: 4px solid var(--ink);
    border-bottom: 1px solid var(--ink);
    padding: 16px 0 20px;
    margin-bottom: 28px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 20px;
    align-items: end;
  }
  .branded-header .kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--muted);
    margin-bottom: 10px;
  }
  .branded-header .entity-block {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .branded-header .entity-info {
    font-family: var(--font-display);
    line-height: 1.4;
  }
  .branded-header .entity-info .name {
    font-weight: 700;
    font-size: 16pt;
    color: var(--ink);
    letter-spacing: -0.01em;
  }
  .branded-header .entity-info .meta {
    font-family: var(--font-mono);
    font-size: 9.5pt;
    color: var(--muted);
    font-weight: 500;
    letter-spacing: 0.05em;
    margin-top: 4px;
  }
  .branded-header .date-block {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 9.5pt;
    color: var(--muted);
    font-weight: 500;
    letter-spacing: 0.08em;
  }
  .branded-header .date-block strong {
    color: var(--ink);
    font-weight: 700;
  }
  .logo-placeholder {
    width: 64px;
    height: 64px;
    border: 2px dashed var(--subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 8pt;
    color: var(--muted);
    letter-spacing: 0.15em;
  }

  h1 {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 28pt;
    letter-spacing: -0.02em;
    line-height: 1.05;
    margin-bottom: 16px;
  }
  h1 em { font-style: italic; color: var(--accent); font-weight: 400; }

  .section-title {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 9.5pt;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--accent);
    margin-top: 24px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--ink);
  }

  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    margin-top: 28px;
  }
  .sig-grid > div > strong {
    font-family: var(--font-mono);
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .sig-line {
    border-bottom: 1px solid var(--ink);
    margin-top: 28px;
    margin-bottom: 4px;
  }
  .sig-label {
    font-family: var(--font-mono);
    font-size: 8.5pt;
    font-weight: 500;
    color: var(--muted);
    letter-spacing: 0.05em;
  }

  .nonbinding {
    font-size: 9.5pt;
    color: var(--muted);
    border-top: 1px solid var(--subtle);
    padding-top: 14px;
    margin-top: 24px;
    line-height: 1.55;
    font-style: italic;
  }
  .footer {
    font-family: var(--font-mono);
    font-size: 9pt;
    font-weight: 700;
    color: var(--muted);
    border-top: 4px solid var(--ink);
    padding-top: 14px;
    margin-top: 32px;
    display: flex;
    justify-content: space-between;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .disclaimer {
    font-family: var(--font-display);
    font-size: 8.5pt;
    font-style: italic;
    color: #8a8578;
    margin-top: 16px;
    line-height: 1.5;
  }

  @media print {
    body { margin: 0; padding: 20px 40px; background: var(--paper); }
    .branded-header, .section-title, .sig-grid { break-inside: avoid; }
  }
</style>
</head>
<body>

<div class="branded-header">
  <div>
    <div class="kicker">Letter of Intent · Confidential</div>
    <div class="entity-block">
      ${logoHtml}
      <div class="entity-info">
        <div class="name">${esc(entityName)}</div>
        <div class="meta">${entityAddress}</div>
        <div class="meta">${esc(contactBits)}</div>
      </div>
    </div>
  </div>
  <div class="date-block">
    <strong>DATED ${esc(dateStr).toUpperCase()}</strong>
  </div>
</div>

<p><strong>TO:</strong> ${esc(data.seller_name || "[SELLER / SELLER'S REP NAME]")}<br/>
[Company / Brokerage Name]<br/>
${esc(data.seller_address || "[Address]")}<br/>
[Email]</p>

<p><strong>Re:</strong> Letter of Intent for the purchase of <strong>${esc(propertyRef)}</strong> (the &ldquo;Property&rdquo;)</p>

<p>For your consideration, please find the following Letter of Intent for the above-referenced Property at the terms outlined below. This letter sets forth the general terms and conditions for the proposed acquisition, but shall remain <em>non-binding</em>.</p>

<div class="section-title">Proposed Terms</div>
<ol>
  <li><strong>Purchase Price:</strong> ${fmt(data.purchase_price)}</li>
  <li><strong>Terms:</strong> ${paymentTerms}</li>
  <li><strong>Earnest Money:</strong> ${fmt(data.earnest_money)}${
    data.earnest_money_hard_days
      ? ` (non-refundable after ${data.earnest_money_hard_days} days)`
      : " due upon execution of PSA"
  }</li>
  <li><strong>Form of PSA:</strong> [PSA TERMS]</li>
  <li><strong>Inspection Contingency:</strong> ${fmtDays(data.due_diligence_days)} days</li>
  <li><strong>Financing Contingency:</strong> ${financingLine}</li>
  <li><strong>Title &amp; Escrow:</strong> [TITLE/ESCROW TERMS]</li>
  <li><strong>Buyer&rsquo;s Broker:</strong> ${esc(data.broker_name || "[BROKER NAME / ENTITY]")}${
    data.broker_commission ? ` — ${esc(data.broker_commission)}` : ""
  }</li>
  <li><strong>Closing Timeline:</strong> ${
    data.closing_days
      ? `${data.closing_days} days from removal of inspection contingencies`
      : "[CLOSING TERMS]"
  }</li>
</ol>

<div class="section-title">Additional Terms (Optional)</div>
<ol start="10">
  <li><strong>Seller Representations:</strong> [REPS &amp; WARRANTIES TERMS]</li>
  <li><strong>Assignment:</strong> [ASSIGNMENT RIGHTS]</li>
  <li><strong>Seller&rsquo;s Deliverables:</strong> [DUE DILIGENCE ITEMS]</li>
  <li><strong>Conditions Precedent:</strong> [CONDITIONS]</li>
  ${
    data.additional_terms
      ? `<li>${esc(data.additional_terms).replace(/\n/g, "<br/>")}</li>`
      : `<li>[ADDITIONAL TERM LABEL]: [ADDITIONAL TERM DETAIL]</li>`
  }
</ol>

<p>This sets out the key parameters. Please respond by <strong>[RESPONSE DEADLINE DATE]</strong>.</p>

<p class="nonbinding">Please understand that this is not a binding commitment. This letter is not an offer, solicitation of an offer, or an acceptance, and creates no contractual, good faith, or other obligations. Such obligations can be created only by a formal Purchase and Sale Agreement, executed by all parties thereto. The undersigned reserves the right to discontinue discussion at any time, for any reason or for no reason, prior to the mutual execution of a formal Purchase and Sale Agreement. Seller will not have any obligations to Buyer, and Buyer will not acquire any rights or causes of action against Seller, unless Seller and Buyer both execute and deliver the Purchase and Sale Agreement.</p>

<div class="section-title">Signatures</div>
<div class="sig-grid">
  <div>
    <strong>BUYER</strong>
    <div class="sig-line"></div><div class="sig-label">Signature</div>
    <div class="sig-line"></div><div class="sig-label">Printed Name / Title</div>
    <div class="sig-line"></div><div class="sig-label">Date</div>
  </div>
  <div>
    <strong>SELLER (Acceptance)</strong>
    <div class="sig-line"></div><div class="sig-label">Signature</div>
    <div class="sig-line"></div><div class="sig-label">Printed Name / Title</div>
    <div class="sig-line"></div><div class="sig-label">Date</div>
  </div>
</div>

<div class="footer">
  <span>${esc(footerText)}</span>
  <span>${esc(companyName)}</span>
</div>
${b.disclaimer_text ? `<p class="disclaimer">${esc(b.disclaimer_text)}</p>` : ""}

</body>
</html>`;
}
