/**
 * Bid Leveling Memo PDF render.
 *
 * Builds the bodyHtml passed into `renderReportHtml`. Three sections:
 *   1. Executive summary — bids with original totals, adjusted totals,
 *      and apples-to-apples winner.
 *   2. Leveling table — full canonical scope × bidder matrix with
 *      included/excluded/alternate/unclear markers.
 *   3. Clarifying questions — per-contractor list with status.
 *
 * The leveling math mirrors the on-screen client component
 * (`/pre-construction/bids` page) so the PDF matches what the user sees.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const fc = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(Number(n));

interface Bid {
  id: string;
  contractor_name: string;
  contractor_company: string | null;
  bid_date: string | null;
  total_amount: number | null;
  status: string;
}

interface ScopeItem {
  id: string;
  division: string | null;
  scope: string;
}

interface BidItem {
  bid_id: string;
  scope_item_id: string;
  amount: number | null;
  status: "included" | "excluded" | "alternate" | "unclear";
  qualifier_note: string | null;
}

interface Question {
  bid_id: string;
  question: string;
  category: string | null;
  status: string;
  answer: string | null;
}

export interface BidLevelingPdfData {
  bids: Bid[];
  scope_items: ScopeItem[];
  bid_items: BidItem[];
  questions: Question[];
}

const STATUS_CHAR: Record<BidItem["status"], string> = {
  included: "✓",
  excluded: "✕",
  alternate: "ALT",
  unclear: "?",
};

const STATUS_COLOR: Record<BidItem["status"], string> = {
  included: "#1f4638",       // forest
  excluded: "#a8301a",       // brick
  alternate: "#1d4f7c",      // navy
  unclear: "#b8862e",        // ochre
};

const QUESTION_CATEGORY_LABEL: Record<string, string> = {
  exclusion_clarification: "Exclusion clarification",
  scope_gap: "Scope gap",
  assumption_diff: "Assumption difference",
  pricing_outlier: "Pricing outlier",
  other: "Other",
};

/**
 * Compute imputed/adjusted totals — mirrors the math in
 * `/pre-construction/bids/page.tsx`. Imputes the median of OTHER bids
 * that included a scope item when this bid excluded or was unclear on it.
 */
function computeAdjustedTotals(data: BidLevelingPdfData): Map<string, { included: number; imputed: number; adjusted: number; imputationCount: number }> {
  const out = new Map<string, { included: number; imputed: number; adjusted: number; imputationCount: number }>();
  const cellMap = new Map<string, BidItem>();
  for (const bi of data.bid_items) cellMap.set(`${bi.bid_id}::${bi.scope_item_id}`, bi);

  const includedByScope = new Map<string, Array<{ bid_id: string; amount: number }>>();
  for (const bi of data.bid_items) {
    if (bi.status === "included" && bi.amount !== null && bi.amount !== undefined) {
      const arr = includedByScope.get(bi.scope_item_id) ?? [];
      arr.push({ bid_id: bi.bid_id, amount: Number(bi.amount) });
      includedByScope.set(bi.scope_item_id, arr);
    }
  }

  const median = (arr: number[]) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  for (const bid of data.bids) {
    let included = 0;
    let imputed = 0;
    let imputationCount = 0;
    for (const scope of data.scope_items) {
      const cell = cellMap.get(`${bid.id}::${scope.id}`);
      if (cell?.status === "included" && cell.amount !== null && cell.amount !== undefined) {
        included += Number(cell.amount);
      } else if (!cell || cell.status === "excluded" || cell.status === "unclear") {
        const others = (includedByScope.get(scope.id) ?? []).filter((e) => e.bid_id !== bid.id);
        const m = median(others.map((e) => e.amount));
        if (m !== null) {
          imputed += m;
          imputationCount++;
        }
      }
    }
    out.set(bid.id, { included, imputed, adjusted: included + imputed, imputationCount });
  }
  return out;
}

export function renderBidLevelingBodyHtml(data: BidLevelingPdfData): string {
  const adjusted = computeAdjustedTotals(data);
  let lowestAdjusted: number | null = null;
  for (const v of Array.from(adjusted.values())) {
    if (v.adjusted > 0 && (lowestAdjusted === null || v.adjusted < lowestAdjusted)) {
      lowestAdjusted = v.adjusted;
    }
  }

  const cellMap = new Map<string, BidItem>();
  for (const bi of data.bid_items) cellMap.set(`${bi.bid_id}::${bi.scope_item_id}`, bi);

  // Group scope items by division so the table reads like the on-screen leveler.
  const grouped: Record<string, ScopeItem[]> = {};
  for (const s of data.scope_items) {
    const div = s.division || "Other";
    (grouped[div] ||= []).push(s);
  }

  const questionsByBid: Record<string, Question[]> = {};
  for (const q of data.questions) (questionsByBid[q.bid_id] ||= []).push(q);

  const totalsCount = data.bids.length;
  const anyImputations = Array.from(adjusted.values()).some((a) => a.imputationCount > 0);

  // ── Section 1: Executive summary ──────────────────────────────────────
  const summaryRows = data.bids
    .map((b) => {
      const adj = adjusted.get(b.id);
      const isLow = adj && lowestAdjusted !== null && Math.abs(adj.adjusted - lowestAdjusted) < 1;
      const delta = adj && lowestAdjusted !== null ? adj.adjusted - lowestAdjusted : 0;
      return `
        <tr>
          <td style="padding: 6pt 8pt; border-bottom: 1px solid #e0d8c6;">
            <div style="font-weight: 600;">${esc(b.contractor_name)}</div>
            ${b.contractor_company ? `<div style="font-size: 9pt; color: #6b6863;">${esc(b.contractor_company)}</div>` : ""}
          </td>
          <td style="padding: 6pt 8pt; text-align: right; border-bottom: 1px solid #e0d8c6; font-variant-numeric: tabular-nums;">${esc(fc(b.total_amount))}</td>
          <td style="padding: 6pt 8pt; text-align: right; border-bottom: 1px solid #e0d8c6; font-variant-numeric: tabular-nums; color: #b8862e;">
            ${adj && adj.imputationCount > 0 ? `+ ${esc(fc(adj.imputed))} <span style="font-size: 9pt;">(${adj.imputationCount})</span>` : "—"}
          </td>
          <td style="padding: 6pt 8pt; text-align: right; border-bottom: 1px solid #e0d8c6; font-variant-numeric: tabular-nums; font-weight: 700; ${isLow ? "background: #1f463814; color: #1f4638;" : ""}">
            ${adj ? esc(fc(adj.adjusted)) : "—"}
            ${isLow ? `<div style="font-size: 8pt; font-weight: 500;">⊙ apples-to-apples low</div>` : delta > 0 && lowestAdjusted !== null ? `<div style="font-size: 8pt; color: #6b6863; font-weight: 400;">+${esc(fc(delta))} vs low</div>` : ""}
          </td>
        </tr>`;
    })
    .join("");

  const summarySection = `
    <h2>Executive Summary</h2>
    <p>Comparing ${totalsCount} contractor bid${totalsCount === 1 ? "" : "s"} across ${data.scope_items.length} canonical scope item${data.scope_items.length === 1 ? "" : "s"}. Adjusted Total imputes the median of other bids' amounts for scope items this bid excluded or was unclear on, surfacing the apples-to-apples comparison.</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 16pt; font-size: 10pt;">
      <thead>
        <tr style="background: #ebe4d4;">
          <th style="padding: 8pt; text-align: left; border-bottom: 2px solid #0a0d12;">Contractor</th>
          <th style="padding: 8pt; text-align: right; border-bottom: 2px solid #0a0d12;">Total Bid</th>
          <th style="padding: 8pt; text-align: right; border-bottom: 2px solid #0a0d12;">+ Imputed Gaps</th>
          <th style="padding: 8pt; text-align: right; border-bottom: 2px solid #0a0d12;">Adjusted Total</th>
        </tr>
      </thead>
      <tbody>${summaryRows}</tbody>
    </table>
    ${anyImputations
      ? `<p style="margin-top: 10pt; font-size: 9pt; color: #6b6863;"><em>Imputed gaps</em> = sum of median amounts charged by other bidders for scope this contractor excluded or was unclear on.</p>`
      : ""}
  `;

  // ── Section 2: Leveling table ────────────────────────────────────────
  const bidColumns = data.bids.map((b) => esc(b.contractor_name)).join("");
  const groupBlocks = Object.entries(grouped)
    .map(([div, items]) => {
      const rows = items
        .map((s) => {
          const cells = data.bids
            .map((b) => {
              const cell = cellMap.get(`${b.id}::${s.id}`);
              if (!cell) {
                return `<td style="padding: 4pt 6pt; text-align: right; border-bottom: 1px solid #ebe4d4; color: #c5c0b6; font-size: 9pt;">—</td>`;
              }
              const symbol = STATUS_CHAR[cell.status];
              const color = STATUS_COLOR[cell.status];
              const amount = cell.amount !== null && cell.amount !== undefined ? fc(cell.amount) : "";
              return `
                <td style="padding: 4pt 6pt; text-align: right; border-bottom: 1px solid #ebe4d4; font-size: 9pt; font-variant-numeric: tabular-nums;">
                  <span style="color: ${color}; font-weight: 700; margin-right: 4pt;">${symbol}</span>
                  ${esc(amount)}
                  ${cell.qualifier_note ? `<div style="font-size: 8pt; color: #b8862e; font-style: italic;">${esc(cell.qualifier_note)}</div>` : ""}
                </td>`;
            })
            .join("");
          return `
            <tr>
              <td style="padding: 4pt 6pt; border-bottom: 1px solid #ebe4d4; font-size: 9pt; font-weight: 500;">${esc(s.scope)}</td>
              ${cells}
            </tr>`;
        })
        .join("");
      const divCells = data.bids.map(() => `<td></td>`).join("");
      return `
        <tr style="background: #f4efe6;">
          <td colspan="${1 + data.bids.length}" style="padding: 6pt 8pt; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.1em; color: #6b6863; border-bottom: 1px solid #ebe4d4;">${esc(div)}${divCells ? "" : ""}</td>
        </tr>
        ${rows}`;
    })
    .join("");

  // Bid totals + adjusted totals row
  const totalCells = data.bids
    .map((b) => `<td style="padding: 6pt; text-align: right; border-top: 2px solid #0a0d12; font-weight: 600; font-variant-numeric: tabular-nums; font-size: 9pt;">${esc(fc(b.total_amount))}</td>`)
    .join("");
  const adjustedCells = data.bids
    .map((b) => {
      const adj = adjusted.get(b.id);
      const isLow = adj && lowestAdjusted !== null && Math.abs(adj.adjusted - lowestAdjusted) < 1;
      return `<td style="padding: 6pt; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; font-size: 9pt; ${isLow ? "background: #1f463814; color: #1f4638;" : ""}">${esc(adj ? fc(adj.adjusted) : "—")}</td>`;
    })
    .join("");

  const levelingSection = `
    <h2 style="page-break-before: always;">Leveling Table</h2>
    <p>Each cell shows the contractor's amount for that scope item, marked with their status:
      <span style="color: #1f4638; font-weight: 700;">✓</span> Included &nbsp;
      <span style="color: #a8301a; font-weight: 700;">✕</span> Excluded &nbsp;
      <span style="color: #1d4f7c; font-weight: 700;">ALT</span> Alternate &nbsp;
      <span style="color: #b8862e; font-weight: 700;">?</span> Unclear
    </p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 10pt; font-size: 9pt;">
      <thead>
        <tr style="background: #ebe4d4;">
          <th style="padding: 6pt; text-align: left; border-bottom: 2px solid #0a0d12;">Scope Item</th>
          ${data.bids.map((b) => `<th style="padding: 6pt; text-align: right; border-bottom: 2px solid #0a0d12;">${esc(b.contractor_name)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${groupBlocks}
        <tr style="background: #f4efe6;">
          <td style="padding: 6pt; border-top: 2px solid #0a0d12; font-weight: 600; font-size: 9pt;">Total Bid</td>
          ${totalCells}
        </tr>
        <tr style="background: #ebe4d4;">
          <td style="padding: 6pt; font-weight: 700; font-size: 9pt;">Adjusted Total</td>
          ${adjustedCells}
        </tr>
      </tbody>
    </table>
  `;

  // ── Section 3: Clarifying questions ──────────────────────────────────
  const questionsSection = data.bids.some((b) => (questionsByBid[b.id] ?? []).length > 0)
    ? `
      <h2 style="page-break-before: always;">Clarifying Questions</h2>
      <p>Open questions generated from gap analysis, by contractor. Send these before award decision.</p>
      ${data.bids
        .map((b) => {
          const qs = questionsByBid[b.id] ?? [];
          if (qs.length === 0) return "";
          const qRows = qs
            .map((q) => `
              <li style="margin: 6pt 0;">
                <span style="font-size: 9pt; text-transform: uppercase; letter-spacing: 0.08em; color: #b8862e; font-weight: 600;">${esc(QUESTION_CATEGORY_LABEL[q.category || "other"])}</span>
                <div style="margin-top: 2pt;">${esc(q.question)}</div>
                ${q.answer ? `<div style="margin-top: 4pt; padding-left: 10pt; border-left: 2px solid #1f4638; color: #1f4638; font-style: italic; font-size: 9.5pt;">${esc(q.answer)}</div>` : ""}
              </li>`)
            .join("");
          return `
            <h3 style="margin-top: 16pt;">${esc(b.contractor_name)}${b.contractor_company ? ` <span style="color: #6b6863; font-weight: 400; font-size: 12pt;">— ${esc(b.contractor_company)}</span>` : ""}</h3>
            <ul style="padding-left: 18pt;">${qRows}</ul>`;
        })
        .join("")}`
    : "";

  return summarySection + levelingSection + questionsSection;
}
