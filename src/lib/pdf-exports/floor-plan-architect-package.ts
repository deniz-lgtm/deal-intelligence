/**
 * Architect-package PDF body renderer.
 *
 * Builds the bodyHtml passed into the shared report shell. Three sections:
 *   1. The captured floor plan canvas as a centered image.
 *   2. Area Schedule — per-room table (name, dimensions, area).
 *   3. Summary by room type with grand total + a basic efficiency note.
 *
 * The image is passed in as a data URL (PNG, captured client-side via
 * html-to-image). Puppeteer embeds it inline when it renders the HTML.
 */

import { formatBedroomBathroom, inferBedroomBathroom, type AreaSchedule } from "@/lib/floor-plan-area-schedule";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ArchitectPackageData {
  title: string;
  notes?: string | null;
  /** Inline PNG data URL of the plan canvas. */
  planImageDataUrl: string;
  schedule: AreaSchedule;
  /** Optional author/firm shown under the canvas. */
  preparedBy?: string | null;
}

export function renderArchitectPackageBodyHtml(data: ArchitectPackageData): string {
  const { title, notes, planImageDataUrl, schedule, preparedBy } = data;

  const efficiency = schedule.bboxFt2 && schedule.bboxFt2 > 0
    ? Math.round((schedule.totalFt2 / schedule.bboxFt2) * 100)
    : null;

  const brBaLabel = formatBedroomBathroom(inferBedroomBathroom(schedule.rows));

  // ── Section 1: canvas image ──────────────────────────────────────────
  const canvasSection = `
    <section style="margin-top: 6pt;">
      ${brBaLabel ? `
        <p style="margin: 0 0 10pt 0; font-size: 11pt;">
          <strong style="color: #0a0d12;">${esc(brBaLabel)}</strong>
          <span style="color: #6b6863;"> · ${Math.round(schedule.totalFt2)} ft² · ${schedule.rows.length} room${schedule.rows.length === 1 ? "" : "s"}</span>
        </p>
      ` : ""}
      <div style="border: 1px solid #e0d8c6; padding: 12pt; background: #ffffff;">
        <img
          src="${esc(planImageDataUrl)}"
          alt="${esc(title)}"
          style="display: block; max-width: 100%; height: auto; margin: 0 auto;"
        />
        <div style="margin-top: 8pt; display: flex; justify-content: space-between; font-size: 9pt; color: #6b6863;">
          <span>${esc(title)}</span>
          <span>1 grid = 1 ft · captured ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
        </div>
      </div>
      ${preparedBy ? `<p style="margin-top: 8pt; font-size: 9.5pt; color: #6b6863;"><em>Prepared by:</em> ${esc(preparedBy)}</p>` : ""}
    </section>
  `;

  // ── Section 2: detailed area schedule ────────────────────────────────
  const scheduleSection = schedule.rows.length > 0 ? `
    <h2 style="page-break-before: always;">Area Schedule</h2>
    <p>One row per room as drawn on the plan. Dimensions are in feet, areas are in ft².</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 10pt;">
      <thead>
        <tr style="background: #ebe4d4;">
          <th style="padding: 6pt 8pt; text-align: left; border-bottom: 2px solid #0a0d12;">Room</th>
          <th style="padding: 6pt 8pt; text-align: right; border-bottom: 2px solid #0a0d12; width: 80pt;">Width</th>
          <th style="padding: 6pt 8pt; text-align: right; border-bottom: 2px solid #0a0d12; width: 80pt;">Height</th>
          <th style="padding: 6pt 8pt; text-align: right; border-bottom: 2px solid #0a0d12; width: 80pt;">Area</th>
        </tr>
      </thead>
      <tbody>
        ${schedule.rows.map((row) => `
          <tr>
            <td style="padding: 5pt 8pt; border-bottom: 1px solid #ebe4d4;">${esc(row.label)}</td>
            <td style="padding: 5pt 8pt; text-align: right; border-bottom: 1px solid #ebe4d4; font-variant-numeric: tabular-nums;">${row.widthFt}′</td>
            <td style="padding: 5pt 8pt; text-align: right; border-bottom: 1px solid #ebe4d4; font-variant-numeric: tabular-nums;">${row.heightFt}′</td>
            <td style="padding: 5pt 8pt; text-align: right; border-bottom: 1px solid #ebe4d4; font-variant-numeric: tabular-nums; font-weight: 600;">${row.areaFt2} ft²</td>
          </tr>`).join("")}
        <tr style="background: #ebe4d4;">
          <td style="padding: 6pt 8pt; font-weight: 700; border-top: 2px solid #0a0d12;">Net Total</td>
          <td colspan="2" style="padding: 6pt 8pt; border-top: 2px solid #0a0d12;"></td>
          <td style="padding: 6pt 8pt; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; border-top: 2px solid #0a0d12;">${Math.round(schedule.totalFt2)} ft²</td>
        </tr>
      </tbody>
    </table>
  ` : `<h2>Area Schedule</h2><p style="color: #6b6863;"><em>No rooms drawn yet.</em></p>`;

  // ── Section 3: summary by room type + efficiency note ────────────────
  const summarySection = schedule.groups.length > 0 ? `
    <h2 style="margin-top: 24pt;">By Room Type</h2>
    <table style="width: 60%; border-collapse: collapse; margin-top: 8pt; font-size: 10pt;">
      <thead>
        <tr style="background: #ebe4d4;">
          <th style="padding: 6pt 8pt; text-align: left; border-bottom: 2px solid #0a0d12;">Type</th>
          <th style="padding: 6pt 8pt; text-align: right; border-bottom: 2px solid #0a0d12;">Count</th>
          <th style="padding: 6pt 8pt; text-align: right; border-bottom: 2px solid #0a0d12;">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${schedule.groups.map((g) => `
          <tr>
            <td style="padding: 5pt 8pt; border-bottom: 1px solid #ebe4d4;">${esc(g.label)}</td>
            <td style="padding: 5pt 8pt; text-align: right; border-bottom: 1px solid #ebe4d4; font-variant-numeric: tabular-nums;">${g.count}</td>
            <td style="padding: 5pt 8pt; text-align: right; border-bottom: 1px solid #ebe4d4; font-variant-numeric: tabular-nums; font-weight: 600;">${Math.round(g.totalFt2)} ft²</td>
          </tr>`).join("")}
      </tbody>
    </table>

    ${efficiency !== null && schedule.bboxFt2 !== null ? `
      <p style="margin-top: 18pt; font-size: 10pt; color: #6b6863;">
        <strong style="color: #0a0d12;">Envelope efficiency:</strong>
        Net area of <strong>${Math.round(schedule.totalFt2)} ft²</strong> fits in a bounding envelope of <strong>${Math.round(schedule.bboxFt2)} ft²</strong> — <strong>${efficiency}%</strong> efficient.
      </p>
    ` : ""}

    ${notes ? `
      <h2 style="margin-top: 24pt;">Notes</h2>
      <p style="white-space: pre-wrap;">${esc(notes)}</p>
    ` : ""}
  ` : "";

  return canvasSection + scheduleSection + summarySection;
}
