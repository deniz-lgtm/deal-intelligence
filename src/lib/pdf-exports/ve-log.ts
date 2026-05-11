/**
 * VE Log PDF render. Three sections:
 *   1. Roll-up — proposed / accepted / applied savings + schedule delta.
 *   2. Active items (accepted + applied) with savings, schedule, scope impact.
 *   3. Proposed / in-review + rejected items (combined, status-tagged).
 *
 * Designed for owner review or IC handoff. Mirrors the on-screen rollup
 * cards so the PDF is the canonical "what's been accepted, what's pending"
 * artifact for distribution.
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

export type VEStatus = "proposed" | "in_review" | "accepted" | "rejected" | "applied";

interface VEItem {
  id: string;
  number: number;
  title: string;
  description: string | null;
  proposer: string | null;
  cost_savings: number | string;
  schedule_impact_days: number | string;
  scope_impact: string | null;
  status: VEStatus;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<VEStatus, string> = {
  proposed: "Proposed",
  in_review: "In Review",
  accepted: "Accepted",
  rejected: "Rejected",
  applied: "Applied",
};

const STATUS_COLOR: Record<VEStatus, string> = {
  proposed: "#6b6863",       // muted
  in_review: "#1d4f7c",      // navy
  accepted: "#b8862e",       // ochre
  rejected: "#a8301a",       // brick
  applied: "#1f4638",        // forest
};

export function renderVeLogBodyHtml(items: VEItem[]): string {
  // Roll-up math mirrors the on-screen cards.
  const totals = items.reduce(
    (acc, i) => {
      const cs = Number(i.cost_savings) || 0;
      const sd = Number(i.schedule_impact_days) || 0;
      if (i.status === "proposed" || i.status === "in_review") acc.proposed += cs;
      if (i.status === "accepted") acc.accepted += cs;
      if (i.status === "applied") acc.applied += cs;
      if (i.status === "accepted" || i.status === "applied") acc.schedule += sd;
      return acc;
    },
    { proposed: 0, accepted: 0, applied: 0, schedule: 0 }
  );

  const active = items.filter((i) => i.status === "accepted" || i.status === "applied");
  const pending = items.filter((i) => i.status === "proposed" || i.status === "in_review");
  const rejected = items.filter((i) => i.status === "rejected");

  const scheduleSign = totals.schedule >= 0 ? "+" : "";
  const scheduleColor = totals.schedule > 0 ? "#b8862e" : totals.schedule < 0 ? "#1f4638" : "#6b6863";

  // ── Roll-up section ──────────────────────────────────────────────────
  const rollup = `
    <h2>Roll-Up</h2>
    <p>${items.length} VE item${items.length === 1 ? "" : "s"} proposed against the active budget.
      Accepted items are agreed to roll into the next budget version; applied items have already been incorporated.</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 12pt; font-size: 11pt;">
      <tr>
        <td style="padding: 12pt; background: #f4efe6; border: 1px solid #e0d8c6; vertical-align: top; width: 25%;">
          <div style="font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; color: #6b6863;">Proposed</div>
          <div style="font-size: 20pt; font-weight: 700; margin-top: 4pt; font-variant-numeric: tabular-nums;">${esc(fc(totals.proposed))}</div>
          <div style="font-size: 9pt; color: #6b6863; margin-top: 2pt;">${pending.length} pending item${pending.length === 1 ? "" : "s"}</div>
        </td>
        <td style="padding: 12pt; background: #f4efe6; border: 1px solid #e0d8c6; vertical-align: top; width: 25%;">
          <div style="font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; color: #6b6863;">Accepted</div>
          <div style="font-size: 20pt; font-weight: 700; margin-top: 4pt; color: #b8862e; font-variant-numeric: tabular-nums;">${esc(fc(totals.accepted))}</div>
          <div style="font-size: 9pt; color: #6b6863; margin-top: 2pt;">approved, awaiting budget roll-in</div>
        </td>
        <td style="padding: 12pt; background: #f4efe6; border: 1px solid #e0d8c6; vertical-align: top; width: 25%;">
          <div style="font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; color: #6b6863;">Applied</div>
          <div style="font-size: 20pt; font-weight: 700; margin-top: 4pt; color: #1f4638; font-variant-numeric: tabular-nums;">${esc(fc(totals.applied))}</div>
          <div style="font-size: 9pt; color: #6b6863; margin-top: 2pt;">incorporated into budget</div>
        </td>
        <td style="padding: 12pt; background: #f4efe6; border: 1px solid #e0d8c6; vertical-align: top; width: 25%;">
          <div style="font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; color: #6b6863;">Schedule Δ</div>
          <div style="font-size: 20pt; font-weight: 700; margin-top: 4pt; color: ${scheduleColor}; font-variant-numeric: tabular-nums;">${scheduleSign}${totals.schedule} d</div>
          <div style="font-size: 9pt; color: #6b6863; margin-top: 2pt;">net of accepted + applied</div>
        </td>
      </tr>
    </table>
  `;

  // ── Item table renderer ──────────────────────────────────────────────
  const renderTable = (rows: VEItem[]) => {
    if (rows.length === 0) {
      return `<p style="color: #6b6863; font-style: italic;">None.</p>`;
    }
    const body = rows
      .map((it) => {
        const cs = Number(it.cost_savings) || 0;
        const sd = Number(it.schedule_impact_days) || 0;
        const sdLabel = sd === 0 ? "—" : `${sd >= 0 ? "+" : ""}${sd}d`;
        return `
          <tr>
            <td style="padding: 8pt; border-bottom: 1px solid #e0d8c6; vertical-align: top; font-size: 9pt; font-variant-numeric: tabular-nums; color: #6b6863;">VE-${String(it.number).padStart(3, "0")}</td>
            <td style="padding: 8pt; border-bottom: 1px solid #e0d8c6; vertical-align: top;">
              <div style="font-weight: 600;">${esc(it.title)}</div>
              ${it.description ? `<div style="font-size: 9.5pt; color: #1a1d22; margin-top: 3pt;">${esc(it.description)}</div>` : ""}
              ${it.scope_impact ? `<div style="font-size: 9pt; color: #b8862e; margin-top: 3pt; font-style: italic;"><strong>Scope impact:</strong> ${esc(it.scope_impact)}</div>` : ""}
              ${it.decision_note ? `<div style="font-size: 9pt; color: #6b6863; margin-top: 3pt;"><strong>Decision note:</strong> ${esc(it.decision_note)}</div>` : ""}
            </td>
            <td style="padding: 8pt; border-bottom: 1px solid #e0d8c6; vertical-align: top; font-size: 9.5pt; color: #6b6863;">${esc(it.proposer || "—")}</td>
            <td style="padding: 8pt; border-bottom: 1px solid #e0d8c6; vertical-align: top; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: #1f4638;">${esc(fc(cs))}</td>
            <td style="padding: 8pt; border-bottom: 1px solid #e0d8c6; vertical-align: top; text-align: right; font-variant-numeric: tabular-nums;">${sdLabel}</td>
            <td style="padding: 8pt; border-bottom: 1px solid #e0d8c6; vertical-align: top;">
              <span style="display: inline-block; padding: 2pt 6pt; border-radius: 3pt; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #fff; background: ${STATUS_COLOR[it.status]};">
                ${STATUS_LABEL[it.status]}
              </span>
            </td>
          </tr>`;
      })
      .join("");
    return `
      <table style="width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 10pt;">
        <thead>
          <tr style="background: #ebe4d4;">
            <th style="padding: 8pt; text-align: left; border-bottom: 2px solid #0a0d12; width: 60pt;">#</th>
            <th style="padding: 8pt; text-align: left; border-bottom: 2px solid #0a0d12;">Item</th>
            <th style="padding: 8pt; text-align: left; border-bottom: 2px solid #0a0d12; width: 90pt;">Proposer</th>
            <th style="padding: 8pt; text-align: right; border-bottom: 2px solid #0a0d12; width: 80pt;">Savings</th>
            <th style="padding: 8pt; text-align: right; border-bottom: 2px solid #0a0d12; width: 60pt;">Sched Δ</th>
            <th style="padding: 8pt; text-align: left; border-bottom: 2px solid #0a0d12; width: 80pt;">Status</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  };

  const activeSection = `
    <h2 style="page-break-before: always;">Accepted & Applied (${active.length})</h2>
    <p>Items that have been agreed; "applied" entries are reflected in the active budget version. Use this section as the source of truth for what's locked in.</p>
    ${renderTable(active)}
  `;

  const pendingSection = pending.length > 0 ? `
    <h2 style="page-break-before: always;">Pending (${pending.length})</h2>
    <p>Items still proposed or in review. Owner decision required.</p>
    ${renderTable(pending)}
  ` : "";

  const rejectedSection = rejected.length > 0 ? `
    <h2 style="page-break-before: always;">Rejected (${rejected.length})</h2>
    <p>Items considered and declined — captured here for audit and to avoid re-litigating during the next VE pass.</p>
    ${renderTable(rejected)}
  ` : "";

  return rollup + activeSection + pendingSection + rejectedSection;
}
