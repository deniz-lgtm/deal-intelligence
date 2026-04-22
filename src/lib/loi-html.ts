/**
 * LOI HTML composer — pure, server-safe, shared between:
 *   - the LOI page's inline preview
 *   - the loi artifact generator (HTML → puppeteer PDF)
 *
 * Kept free of client-only imports so it can be called from both
 * browser and server contexts. Branding flows through as a plain
 * object; unresolved fields fall back to safe defaults.
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

export function generateLOIHtml(
  data: LOIData,
  address: string,
  branding?: BrandingData | null
): string {
  const b = branding ?? {};
  const primaryColor = b.primary_color || "#000000";
  const secondaryColor = b.secondary_color || "#333333";
  const accentColor = b.accent_color || "#666666";
  const headerFont = b.header_font || "Georgia";
  const bodyFont = b.body_font || "Georgia";
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
    ? `<img src="${b.logo_url}" alt="${companyName}" style="max-height: 80px; width: ${b.logo_width || 160}px; object-fit: contain;" />`
    : `<div style="width: 90px; height: 90px; border: 2px dashed #bbb; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #999;">LOGO</div>`;

  const entityName = companyName || "[ENTITY NAME]";
  const entityAddress = b.address || "[ENTITY ADDRESS LINE 1]<br/>[CITY, STATE ZIP]";
  const contactBits = [b.phone || "[PHONE]", b.email || "[EMAIL]"].join("  |  ");

  const headerHtml = `<div class="branded-header">
    <div style="display: flex; align-items: center; gap: 16px;">
      ${logoHtml}
      <div style="font-family: ${headerFont}, sans-serif; line-height: 1.4;">
        <div style="font-weight: 700; font-size: 14pt; color: ${secondaryColor};">${entityName}</div>
        <div style="font-size: 10pt; color: ${accentColor};">${entityAddress}</div>
        <div style="font-size: 10pt; color: ${accentColor};">${contactBits}</div>
      </div>
    </div>
  </div>`;

  const disclaimerHtml = b.disclaimer_text
    ? `<p class="disclaimer">${b.disclaimer_text}</p>`
    : "";

  const paymentTerms = data.as_is ? "All cash to Seller" : "[PAYMENT TERMS]";
  const financingLine = data.has_financing_contingency
    ? `${fmtDays(data.financing_contingency_days)} day financing contingency${data.lender_name ? ` (anticipated lender: ${data.lender_name})` : ""}`
    : "None — Buyer obtaining loan without contingency";
  const propertyRef = address || "[PROPERTY ADDRESS], [CITY, STATE]";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Letter of Intent${companyName ? ` — ${companyName}` : ""}</title>
<style>
  body { font-family: ${bodyFont}, Georgia, serif; font-size: 11pt; line-height: 1.55; color: #000; max-width: 780px; margin: 40px auto; padding: 0 40px; }
  p { margin: 8px 0; }
  ol { margin: 8px 0; padding-left: 24px; }
  ol li { margin: 4px 0; }
  .branded-header { padding-bottom: 16px; margin-bottom: 20px; border-bottom: 3px solid ${primaryColor}; }
  .section-title { font-weight: 700; margin-top: 18px; margin-bottom: 4px; color: ${secondaryColor}; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 24px; }
  .sig-line { border-bottom: 1px solid black; margin-top: 32px; margin-bottom: 4px; }
  .sig-label { font-size: 9pt; color: #333; }
  .nonbinding { font-size: 9pt; color: #555; border-top: 1px solid #ddd; padding-top: 12px; margin-top: 20px; line-height: 1.5; }
  .footer { font-size: 9pt; color: ${accentColor}; border-top: 1px solid ${primaryColor}40; padding-top: 10px; margin-top: 20px; display: flex; justify-content: space-between; }
  .disclaimer { font-size: 8pt; color: #999; margin-top: 12px; line-height: 1.4; }
  @media print { body { margin: 0; padding: 20px; } }
</style>
</head>
<body>
${headerHtml}

<p><strong>Date:</strong> ${dateStr}</p>

<p><strong>TO:</strong> ${data.seller_name || "[SELLER / SELLER'S REP NAME]"}<br/>
[Company / Brokerage Name]<br/>
${data.seller_address || "[Address]"}<br/>
[Email]</p>

<p><strong>Re:</strong> Letter of Intent for the purchase of <strong>${propertyRef}</strong> (the &ldquo;Property&rdquo;)</p>

<p>For your consideration, please find the following Letter of Intent for the above-referenced Property at the terms outlined below.</p>

<p>This letter sets forth the general terms and conditions for the proposed acquisition of the Property, but shall remain non-binding:</p>

<p class="section-title">Proposed Terms</p>
<ol>
  <li><strong>Purchase Price:</strong> ${fmt(data.purchase_price)}</li>
  <li><strong>Terms:</strong> ${paymentTerms}</li>
  <li><strong>Earnest Money:</strong> ${fmt(data.earnest_money)}${data.earnest_money_hard_days ? ` (non-refundable after ${data.earnest_money_hard_days} days)` : " due upon execution of PSA"}</li>
  <li><strong>Form of PSA:</strong> [PSA TERMS]</li>
  <li><strong>Inspection Contingency:</strong> ${fmtDays(data.due_diligence_days)} days</li>
  <li><strong>Financing Contingency:</strong> ${financingLine}</li>
  <li><strong>Title &amp; Escrow:</strong> [TITLE/ESCROW TERMS]</li>
  <li><strong>Buyer&rsquo;s Broker:</strong> ${data.broker_name || "[BROKER NAME / ENTITY]"}${data.broker_commission ? ` — ${data.broker_commission}` : ""}</li>
  <li><strong>Closing Timeline:</strong> ${data.closing_days ? `${data.closing_days} days from removal of inspection contingencies` : "[CLOSING TERMS]"}</li>
</ol>

<p class="section-title">Additional Terms (Optional)</p>
<ol start="10">
  <li><strong>Seller Representations:</strong> [REPS &amp; WARRANTIES TERMS]</li>
  <li><strong>Assignment:</strong> [ASSIGNMENT RIGHTS]</li>
  <li><strong>Seller&rsquo;s Deliverables:</strong> [DUE DILIGENCE ITEMS]</li>
  <li><strong>Conditions Precedent:</strong> [CONDITIONS]</li>
  ${data.additional_terms ? `<li>${data.additional_terms.replace(/\n/g, "<br/>")}</li>` : `<li>[ADDITIONAL TERM LABEL]: [ADDITIONAL TERM DETAIL]</li>`}
</ol>

<p>This sets out the key parameters. Please respond by <strong>[RESPONSE DEADLINE DATE]</strong>.</p>

<p class="nonbinding">Please understand that this is not a binding commitment. This letter is not an offer, solicitation of an offer, or an acceptance, and creates no contractual, good faith, or other obligations. Such obligations can be created only by a formal Purchase and Sale Agreement, executed by all parties thereto. The undersigned reserves the right to discontinue discussion at any time, for any reason or for no reason, prior to the mutual execution of a formal Purchase and Sale Agreement. Seller will not have any obligations to Buyer, and Buyer will not acquire any rights or causes of action against Seller, unless Seller and Buyer both execute and deliver the Purchase and Sale Agreement.</p>

<p class="section-title">Signatures</p>
<div class="sig-grid">
  <div>
    <strong>BUYER:</strong>
    <div class="sig-line"></div><p class="sig-label">Signature</p>
    <div class="sig-line"></div><p class="sig-label">Printed Name / Title</p>
    <div class="sig-line"></div><p class="sig-label">Date</p>
  </div>
  <div>
    <strong>SELLER (ACCEPTANCE):</strong>
    <div class="sig-line"></div><p class="sig-label">Signature</p>
    <div class="sig-line"></div><p class="sig-label">Printed Name / Title</p>
    <div class="sig-line"></div><p class="sig-label">Date</p>
  </div>
</div>

<div class="footer">
  <span>${footerText}</span>
  <span>${companyName}</span>
</div>
${disclaimerHtml}
</body>
</html>`;
}
