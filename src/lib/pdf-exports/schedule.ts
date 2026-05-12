/**
 * Stylized schedule PDF renderer.
 *
 * Mirrors the columns of the Excel export (WBS, Track, Phase/Task,
 * Start, Finish, Days, Float, Critical, Progress, Status, Owner,
 * Predecessor, Budget) and renders a real CSS-drawn progress bar
 * plus a per-row mini-Gantt strip showing the bar position within
 * the deal's overall date range. Critical-path rows are tinted red
 * to match the in-app + Excel treatments.
 *
 * The output is HTML — wrap it with `renderReportHtml` and run it
 * through `htmlToPdf` from the route handler.
 */

import {
  SCHEDULE_TRACK_LABELS,
  type DevPhase,
  type ScheduleTrack,
} from "@/lib/types";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

const TRACK_ORDER: Record<ScheduleTrack, number> = {
  acquisition: 0,
  development: 1,
  construction: 2,
};

const STATUS_LABEL = (s: string | null | undefined) =>
  (s || "not_started")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

interface ScheduleBodyOpts {
  phases: DevPhase[];
  /** When true, group by track and emit section headers. */
  withTrackSections?: boolean;
}

export function renderScheduleBodyHtml(opts: ScheduleBodyOpts): string {
  const { phases, withTrackSections = true } = opts;
  const byId = new Map(phases.map((p) => [p.id, p]));

  const roots = phases
    .filter((p) => !p.parent_phase_id)
    .sort((a, b) => {
      if (withTrackSections) {
        const td =
          (TRACK_ORDER[(a.track ?? "development") as ScheduleTrack] ?? 1) -
          (TRACK_ORDER[(b.track ?? "development") as ScheduleTrack] ?? 1);
        if (td !== 0) return td;
      }
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999");
    });

  const childrenFor = (id: string) =>
    phases
      .filter((p) => p.parent_phase_id === id)
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999");
      });

  const allRows = roots.flatMap((r) => [r, ...childrenFor(r.id)]);

  // WBS map for predecessor labels.
  const wbsById = new Map<string, string>();
  const seedWbs = (rows: DevPhase[], prefix = "") => {
    rows.forEach((r, i) => {
      const w = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      wbsById.set(r.id, w);
      childrenFor(r.id).forEach((c, j) => wbsById.set(c.id, `${w}.${j + 1}`));
    });
  };
  if (withTrackSections) {
    (["acquisition", "development", "construction"] as ScheduleTrack[]).forEach((t, ti) => {
      const trackRoots = roots.filter((r) => (r.track ?? "development") === t);
      seedWbs(trackRoots, String(ti + 1));
    });
  } else {
    seedWbs(roots);
  }

  // Timeline range for the mini-Gantt strip.
  const dated = allRows.filter((p) => p.start_date && p.end_date);
  const minMs = dated.length
    ? Math.min(...dated.map((p) => new Date(p.start_date!).getTime()))
    : 0;
  const maxMs = dated.length
    ? Math.max(...dated.map((p) => new Date(p.end_date!).getTime()))
    : 0;
  const rangeMs = Math.max(1, maxMs - minMs);

  // KPI summary.
  const completeRows = allRows.filter((p) => p.status === "complete").length;
  const delayedRows = allRows.filter((p) => p.status === "delayed").length;
  const avgProgress =
    allRows.length > 0
      ? Math.round(allRows.reduce((s, p) => s + Number(p.pct_complete ?? 0), 0) / allRows.length)
      : 0;
  const firstStart = dated.length ? fmtDate(new Date(minMs).toISOString()) : "—";
  const lastFinish = dated.length ? fmtDate(new Date(maxMs).toISOString()) : "—";
  const criticalCount = allRows.filter((p) => p.is_critical).length;

  const ganttCell = (p: DevPhase) => {
    if (!p.start_date || !p.end_date || rangeMs === 0) return "";
    const s = new Date(p.start_date).getTime();
    const e = new Date(p.end_date).getTime();
    const left = ((s - minMs) / rangeMs) * 100;
    const width = Math.max(1.5, ((e - s) / rangeMs) * 100);
    const pct = Math.max(0, Math.min(100, Math.round(Number(p.pct_complete ?? 0))));
    const tone = p.is_critical
      ? "background:#FCA5A5;border-color:#B91C1C;"
      : p.status === "complete"
        ? "background:#86EFAC;border-color:#15803D;"
        : p.status === "in_progress"
          ? "background:#93C5FD;border-color:#1D4ED8;"
          : p.status === "delayed"
            ? "background:#FCA5A5;border-color:#B91C1C;"
            : "background:#E2E8F0;border-color:#64748B;";
    return `<div class="gantt-track">
      <div class="gantt-bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;${tone}">
        <div class="gantt-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
  };

  const predecessorLabel = (p: DevPhase) => {
    if (!p.predecessor_id) return "";
    const pred = byId.get(p.predecessor_id);
    if (!pred) return "";
    const w = wbsById.get(pred.id) ?? "";
    const lag = p.lag_days ?? 0;
    const lagTag = lag === 0 ? "FS" : `FS${lag > 0 ? "+" : ""}${lag}d`;
    return w ? `${w} ${lagTag}` : `${pred.label} ${lagTag}`;
  };

  const progressCell = (pct: number) => {
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    return `<div class="pbar"><div class="pbar-fill" style="width:${v}%"></div><span class="pbar-label">${v}%</span></div>`;
  };

  const statusChipClass = (s: string | null | undefined) => {
    if (s === "complete") return "chip chip-complete";
    if (s === "in_progress") return "chip chip-progress";
    if (s === "delayed") return "chip chip-delayed";
    return "chip chip-open";
  };

  const renderRow = (p: DevPhase, isChild: boolean, wbs: string) => {
    const critClass = p.is_critical ? " row-critical" : "";
    const childClass = isChild ? " row-child" : "";
    const floatStr = p.total_slack_days == null ? "" : `${Math.round(Number(p.total_slack_days))}d`;
    const kindGlyph = p.is_milestone || p.kind === "milestone" ? "◆ " : "";
    return `<tr class="row${critClass}${childClass}">
      <td class="wbs">${esc(wbs)}</td>
      <td class="label">${isChild ? "<span class=\"indent\">└</span>" : ""}${kindGlyph}${esc(p.label)}</td>
      <td>${fmtDate(p.start_date)}</td>
      <td>${fmtDate(p.end_date)}</td>
      <td class="num">${p.duration_days ?? ""}</td>
      <td class="num">${esc(floatStr)}</td>
      <td class="num crit">${p.is_critical ? "★" : ""}</td>
      <td class="gantt">${ganttCell(p)}</td>
      <td class="prog">${progressCell(Number(p.pct_complete ?? 0))}</td>
      <td><span class="${statusChipClass(p.status)}">${esc(STATUS_LABEL(p.status))}</span></td>
      <td>${esc(p.task_owner || "")}</td>
      <td class="pred">${esc(predecessorLabel(p))}</td>
      <td class="money">${esc(fmtMoney(p.budget == null ? null : Number(p.budget)))}</td>
    </tr>`;
  };

  const renderRoots = (rs: DevPhase[]) =>
    rs
      .map((root) => {
        const wbs = wbsById.get(root.id) ?? "";
        return [
          renderRow(root, false, wbs),
          ...childrenFor(root.id).map((c) => renderRow(c, true, wbsById.get(c.id) ?? "")),
        ].join("");
      })
      .join("");

  const sections = withTrackSections
    ? (["acquisition", "development", "construction"] as ScheduleTrack[])
        .map((t) => {
          const rs = roots.filter((r) => (r.track ?? "development") === t);
          if (rs.length === 0) return "";
          return `<tr class="track-section"><td colspan="13">${esc(SCHEDULE_TRACK_LABELS[t])}</td></tr>${renderRoots(rs)}`;
        })
        .join("")
    : renderRoots(roots);

  return `
  <style>
    .kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; margin: 0.5rem 0 1rem; }
    .kpi { border: 1px solid #E5E7EB; padding: 0.5rem 0.6rem; border-radius: 4px; background: #F8FAFC; }
    .kpi .v { font-size: 1.15rem; font-weight: 600; color: #0F172A; font-variant-numeric: tabular-nums; }
    .kpi .l { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: #64748B; margin-top: 2px; }
    table.schedule { width: 100%; border-collapse: collapse; font-size: 0.7rem; table-layout: fixed; }
    table.schedule th, table.schedule td { border-bottom: 1px solid #E5E7EB; padding: 4px 6px; vertical-align: middle; text-align: left; }
    table.schedule thead th { background: #0F172A; color: #fff; font-weight: 600; font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 6px; }
    table.schedule tr.track-section td { background: #1F2937; color: #F1F5F9; font-weight: 700; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.12em; padding: 6px 8px; }
    table.schedule tr.row.row-critical td { background: #FEE2E2; color: #7F1D1D; }
    table.schedule tr.row.row-critical.row-child td { background: #FEF2F2; }
    table.schedule tr.row.row-child td { background: #FAFAFA; }
    table.schedule td.wbs { font-variant-numeric: tabular-nums; color: #64748B; width: 32px; }
    table.schedule td.label { font-weight: 600; }
    table.schedule td.label .indent { color: #94A3B8; margin-right: 4px; }
    table.schedule .num { font-variant-numeric: tabular-nums; text-align: right; width: 38px; }
    table.schedule .crit { text-align: center; color: #B91C1C; font-weight: 700; }
    table.schedule .money { font-variant-numeric: tabular-nums; text-align: right; width: 70px; color: #0F172A; }
    table.schedule .pred { color: #475569; font-variant-numeric: tabular-nums; }
    table.schedule .gantt { width: 22%; min-width: 140px; padding: 4px; }
    .gantt-track { position: relative; height: 12px; background: #F1F5F9; border-radius: 2px; }
    .gantt-bar { position: absolute; top: 1px; bottom: 1px; border-radius: 2px; border: 1px solid; overflow: hidden; }
    .gantt-fill { height: 100%; background: rgba(15,118,110,0.55); }
    table.schedule .prog { width: 110px; }
    .pbar { position: relative; height: 12px; background: #F1F5F9; border-radius: 2px; overflow: hidden; }
    .pbar-fill { height: 100%; background: linear-gradient(90deg,#10B981,#0F766E); }
    .pbar-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; font-weight: 600; color: #0F172A; }
    .chip { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 0.6rem; font-weight: 600; }
    .chip-complete { background: #D1FAE5; color: #065F46; }
    .chip-progress { background: #DBEAFE; color: #1E40AF; }
    .chip-delayed { background: #FEE2E2; color: #991B1B; }
    .chip-open { background: #F1F5F9; color: #475569; }
    .legend { display: flex; gap: 1rem; align-items: center; font-size: 0.65rem; color: #64748B; margin-top: 0.5rem; }
    .legend .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; border: 1px solid #94a3b8; }
  </style>

  <div class="kpi-grid">
    <div class="kpi"><div class="v">${allRows.length}</div><div class="l">Rows</div></div>
    <div class="kpi"><div class="v">${completeRows}</div><div class="l">Complete</div></div>
    <div class="kpi"><div class="v">${delayedRows}</div><div class="l">Delayed</div></div>
    <div class="kpi"><div class="v">${criticalCount}</div><div class="l">Critical</div></div>
    <div class="kpi"><div class="v">${avgProgress}%</div><div class="l">Avg Progress</div></div>
    <div class="kpi"><div class="v">${esc(firstStart)} → ${esc(lastFinish)}</div><div class="l">Window</div></div>
  </div>

  <table class="schedule">
    <thead>
      <tr>
        <th style="width:32px">WBS</th>
        <th>Phase / Task</th>
        <th style="width:60px">Start</th>
        <th style="width:60px">Finish</th>
        <th style="width:38px">Days</th>
        <th style="width:38px">Float</th>
        <th style="width:28px">Crit</th>
        <th style="width:22%">Gantt</th>
        <th style="width:110px">Progress</th>
        <th style="width:74px">Status</th>
        <th style="width:80px">Owner</th>
        <th style="width:80px">Predecessor</th>
        <th style="width:70px">Budget</th>
      </tr>
    </thead>
    <tbody>${sections}</tbody>
  </table>

  <div class="legend">
    <span><span class="swatch" style="background:#FCA5A5"></span>Critical path</span>
    <span><span class="swatch" style="background:#93C5FD"></span>In progress</span>
    <span><span class="swatch" style="background:#86EFAC"></span>Complete</span>
    <span><span class="swatch" style="background:#E2E8F0"></span>Not started</span>
  </div>
  `;
}
