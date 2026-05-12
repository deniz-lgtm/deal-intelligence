/**
 * Stylized schedule PDF renderer.
 *
 * Three view presets shape the column set so the PDF reads well in
 * landscape Letter:
 *
 *   • gantt     — Gantt-first: WBS, Phase / Task, Gantt strip dominates
 *                 (~60% width), Progress, Status. Minimal text columns.
 *   • executive — Briefing read: WBS, Phase / Task, Start, Finish, Gantt,
 *                 Progress, Status, Owner.
 *   • detail    — Everything: WBS, Phase / Task, Start, Finish, Days,
 *                 Float, Critical, Gantt, Progress, Status, Owner,
 *                 Predecessor, Budget. Equivalent to the previous
 *                 portrait layout.
 *
 * A monthly time-axis is rendered inside the Gantt column header so the
 * per-row bars align to a shared scale rather than just floating
 * unlabeled.
 */

import {
  SCHEDULE_TRACK_LABELS,
  type DevPhase,
  type ScheduleTrack,
} from "@/lib/types";

export type ScheduleView = "gantt" | "executive" | "detail";

type ColumnId =
  | "wbs"
  | "label"
  | "start"
  | "finish"
  | "days"
  | "float"
  | "crit"
  | "gantt"
  | "progress"
  | "status"
  | "owner"
  | "pred"
  | "budget";

const VIEW_COLUMNS: Record<ScheduleView, ColumnId[]> = {
  gantt: ["wbs", "label", "gantt", "progress", "status"],
  executive: ["wbs", "label", "start", "finish", "gantt", "progress", "status", "owner"],
  detail: [
    "wbs",
    "label",
    "start",
    "finish",
    "days",
    "float",
    "crit",
    "gantt",
    "progress",
    "status",
    "owner",
    "pred",
    "budget",
  ],
};

const COLUMN_LABEL: Record<ColumnId, string> = {
  wbs: "WBS",
  label: "Phase / Task",
  start: "Start",
  finish: "Finish",
  days: "Days",
  float: "Float",
  crit: "Crit",
  gantt: "Gantt",
  progress: "Progress",
  status: "Status",
  owner: "Owner",
  pred: "Predecessor",
  budget: "Budget",
};

const COLUMN_WIDTH_CSS: Record<ColumnId, string> = {
  wbs: "width:32px",
  label: "min-width:170px",
  start: "width:62px",
  finish: "width:62px",
  days: "width:38px",
  float: "width:42px",
  crit: "width:30px",
  gantt: "", // gantt soaks up remainder via table-layout:fixed + the others having widths
  progress: "width:96px",
  status: "width:78px",
  owner: "width:80px",
  pred: "width:78px",
  budget: "width:74px",
};

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
  /** Column preset. Defaults to "executive" — good for landscape Letter. */
  view?: ScheduleView;
}

export function renderScheduleBodyHtml(opts: ScheduleBodyOpts): string {
  const { phases, withTrackSections = true, view = "executive" } = opts;
  const cols = VIEW_COLUMNS[view] ?? VIEW_COLUMNS.executive;
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

  // Timeline range. Pad 1 week on each side so end-of-window bars don't kiss
  // the edge of the column.
  const dated = allRows.filter((p) => p.start_date && p.end_date);
  const MS_PER_DAY = 86_400_000;
  const rawMin = dated.length
    ? Math.min(...dated.map((p) => new Date(p.start_date!).getTime()))
    : 0;
  const rawMax = dated.length
    ? Math.max(...dated.map((p) => new Date(p.end_date!).getTime()))
    : 0;
  const minMs = rawMin - 7 * MS_PER_DAY;
  const maxMs = rawMax + 7 * MS_PER_DAY;
  const rangeMs = Math.max(1, maxMs - minMs);
  const pctAt = (ms: number) => ((ms - minMs) / rangeMs) * 100;

  // Month ticks for the Gantt column header. One label per month inside
  // the [minMs, maxMs] window, with year stamped on Jan + the leftmost
  // tick.
  const monthTicks: { left: number; label: string; major: boolean }[] = [];
  if (dated.length) {
    const cursor = new Date(minMs);
    cursor.setUTCDate(1);
    let first = true;
    while (cursor.getTime() <= maxMs + MS_PER_DAY) {
      const left = pctAt(cursor.getTime());
      const isJan = cursor.getUTCMonth() === 0;
      monthTicks.push({
        left,
        label: cursor.toLocaleDateString("en-US", {
          month: "short",
          year: first || isJan ? "2-digit" : undefined,
        }),
        major: first || isJan,
      });
      first = false;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const todayPct =
    dated.length && Date.now() >= minMs && Date.now() <= maxMs ? pctAt(Date.now()) : null;

  const ganttCell = (p: DevPhase) => {
    if (!p.start_date || !p.end_date || rangeMs === 0) return "";
    const s = new Date(p.start_date).getTime();
    const e = new Date(p.end_date).getTime();
    const left = pctAt(s);
    const width = Math.max(1.5, pctAt(e) - left);
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
    const milestone = p.is_milestone || p.kind === "milestone"
      ? `<div class="gantt-diamond" style="left:${left.toFixed(2)}%"></div>`
      : "";
    return `<div class="gantt-track">
      ${monthTicks
        .map(
          (t) =>
            `<div class="gantt-tick${t.major ? " major" : ""}" style="left:${t.left.toFixed(2)}%"></div>`
        )
        .join("")}
      ${todayPct !== null ? `<div class="gantt-today" style="left:${todayPct.toFixed(2)}%"></div>` : ""}
      <div class="gantt-bar" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;${tone}">
        <div class="gantt-fill" style="width:${pct}%"></div>
      </div>
      ${milestone}
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

  const cellFor = (id: ColumnId, p: DevPhase, isChild: boolean, wbs: string): string => {
    switch (id) {
      case "wbs":
        return `<td class="wbs">${esc(wbs)}</td>`;
      case "label": {
        const kindGlyph = p.is_milestone || p.kind === "milestone" ? "◆ " : "";
        return `<td class="label">${isChild ? "<span class=\"indent\">└</span>" : ""}${kindGlyph}${esc(p.label)}</td>`;
      }
      case "start":
        return `<td>${fmtDate(p.start_date)}</td>`;
      case "finish":
        return `<td>${fmtDate(p.end_date)}</td>`;
      case "days":
        return `<td class="num">${p.duration_days ?? ""}</td>`;
      case "float": {
        const f = p.total_slack_days == null ? "" : `${Math.round(Number(p.total_slack_days))}d`;
        return `<td class="num">${esc(f)}</td>`;
      }
      case "crit":
        return `<td class="num crit">${p.is_critical ? "★" : ""}</td>`;
      case "gantt":
        return `<td class="gantt">${ganttCell(p)}</td>`;
      case "progress":
        return `<td class="prog">${progressCell(Number(p.pct_complete ?? 0))}</td>`;
      case "status":
        return `<td><span class="${statusChipClass(p.status)}">${esc(STATUS_LABEL(p.status))}</span></td>`;
      case "owner":
        return `<td>${esc(p.task_owner || "")}</td>`;
      case "pred":
        return `<td class="pred">${esc(predecessorLabel(p))}</td>`;
      case "budget":
        return `<td class="money">${esc(fmtMoney(p.budget == null ? null : Number(p.budget)))}</td>`;
    }
  };

  const renderRow = (p: DevPhase, isChild: boolean, wbs: string) => {
    const critClass = p.is_critical ? " row-critical" : "";
    const childClass = isChild ? " row-child" : "";
    return `<tr class="row${critClass}${childClass}">${cols
      .map((c) => cellFor(c, p, isChild, wbs))
      .join("")}</tr>`;
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
          return `<tr class="track-section"><td colspan="${cols.length}">${esc(SCHEDULE_TRACK_LABELS[t])}</td></tr>${renderRoots(rs)}`;
        })
        .join("")
    : renderRoots(roots);

  // KPI summary.
  const completeRows = allRows.filter((p) => p.status === "complete").length;
  const delayedRows = allRows.filter((p) => p.status === "delayed").length;
  const avgProgress =
    allRows.length > 0
      ? Math.round(allRows.reduce((s, p) => s + Number(p.pct_complete ?? 0), 0) / allRows.length)
      : 0;
  const firstStart = dated.length ? fmtDate(new Date(rawMin).toISOString()) : "—";
  const lastFinish = dated.length ? fmtDate(new Date(rawMax).toISOString()) : "—";
  const criticalCount = allRows.filter((p) => p.is_critical).length;

  const ganttHeader = cols.includes("gantt")
    ? `<div class="time-axis">
        ${monthTicks
          .map(
            (t) =>
              `<div class="axis-tick${t.major ? " major" : ""}" style="left:${t.left.toFixed(2)}%"><span>${esc(t.label)}</span></div>`
          )
          .join("")}
        ${todayPct !== null ? `<div class="axis-today" style="left:${todayPct.toFixed(2)}%"><span>Today</span></div>` : ""}
      </div>`
    : "";

  const headerCells = cols
    .map((c) => {
      const w = COLUMN_WIDTH_CSS[c];
      const label = c === "gantt" && ganttHeader ? ganttHeader : esc(COLUMN_LABEL[c]);
      return `<th${w ? ` style="${w}"` : ""}${c === "gantt" ? ' class="gantt-header"' : ""}>${label}</th>`;
    })
    .join("");

  return `
  <style>
    .kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; margin: 0.5rem 0 1rem; }
    .kpi { border: 1px solid #E5E7EB; padding: 0.5rem 0.6rem; border-radius: 4px; background: #F8FAFC; }
    .kpi .v { font-size: 1.05rem; font-weight: 600; color: #0F172A; font-variant-numeric: tabular-nums; }
    .kpi .l { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.1em; color: #64748B; margin-top: 2px; }

    table.schedule { width: 100%; border-collapse: collapse; font-size: 0.68rem; table-layout: fixed; }
    table.schedule th, table.schedule td { border-bottom: 1px solid #E5E7EB; padding: 4px 6px; vertical-align: middle; text-align: left; overflow: hidden; }
    table.schedule thead th { background: #0F172A; color: #fff; font-weight: 600; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 6px; }
    table.schedule tr.track-section td { background: #1F2937; color: #F1F5F9; font-weight: 700; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.12em; padding: 6px 8px; }
    table.schedule tr.row.row-critical td { background: #FEE2E2; color: #7F1D1D; }
    table.schedule tr.row.row-critical.row-child td { background: #FEF2F2; }
    table.schedule tr.row.row-child td { background: #FAFAFA; }

    table.schedule td.wbs { font-variant-numeric: tabular-nums; color: #64748B; }
    table.schedule td.label { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    table.schedule td.label .indent { color: #94A3B8; margin-right: 4px; }
    table.schedule .num { font-variant-numeric: tabular-nums; text-align: right; }
    table.schedule .crit { text-align: center; color: #B91C1C; font-weight: 700; }
    table.schedule .money { font-variant-numeric: tabular-nums; text-align: right; color: #0F172A; }
    table.schedule .pred { color: #475569; font-variant-numeric: tabular-nums; white-space: nowrap; }

    /* Gantt — the dominant column. */
    table.schedule .gantt-header { padding: 0 4px; position: relative; vertical-align: bottom; }
    .time-axis { position: relative; height: 28px; }
    .axis-tick { position: absolute; bottom: 0; height: 28px; border-left: 1px solid rgba(255,255,255,0.18); padding-left: 3px; color: rgba(255,255,255,0.75); }
    .axis-tick.major { border-left-color: rgba(255,255,255,0.55); color: #fff; }
    .axis-tick span { display: inline-block; padding-top: 4px; font-size: 0.58rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
    .axis-today { position: absolute; bottom: 0; height: 28px; border-left: 2px solid #EF4444; padding-left: 3px; color: #EF4444; }
    .axis-today span { display: inline-block; padding-top: 4px; font-size: 0.58rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    table.schedule td.gantt { padding: 5px 6px; }
    .gantt-track { position: relative; height: 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 2px; overflow: hidden; }
    .gantt-tick { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(15,23,42,0.05); }
    .gantt-tick.major { background: rgba(15,23,42,0.18); }
    .gantt-today { position: absolute; top: 0; bottom: 0; width: 1.5px; background: #EF4444; opacity: 0.85; z-index: 2; }
    .gantt-bar { position: absolute; top: 1px; bottom: 1px; border-radius: 2px; border: 1px solid; overflow: hidden; }
    .gantt-fill { height: 100%; background: rgba(15,118,110,0.55); }
    .gantt-diamond { position: absolute; top: 50%; width: 9px; height: 9px; background: #F59E0B; border: 1px solid #B45309; transform: translate(-50%, -50%) rotate(45deg); z-index: 3; }

    table.schedule .prog { padding: 5px 6px; }
    .pbar { position: relative; height: 14px; background: #F1F5F9; border-radius: 2px; overflow: hidden; }
    .pbar-fill { height: 100%; background: linear-gradient(90deg,#10B981,#0F766E); }
    .pbar-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.6rem; font-weight: 600; color: #0F172A; }
    .chip { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 0.58rem; font-weight: 600; white-space: nowrap; }
    .chip-complete { background: #D1FAE5; color: #065F46; }
    .chip-progress { background: #DBEAFE; color: #1E40AF; }
    .chip-delayed { background: #FEE2E2; color: #991B1B; }
    .chip-open { background: #F1F5F9; color: #475569; }
    .legend { display: flex; gap: 1rem; align-items: center; font-size: 0.62rem; color: #64748B; margin-top: 0.5rem; flex-wrap: wrap; }
    .legend .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; border: 1px solid #94a3b8; }
    .legend .diamond { display: inline-block; width: 8px; height: 8px; background: #F59E0B; border: 1px solid #B45309; transform: rotate(45deg); margin-right: 6px; vertical-align: middle; }
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
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${sections}</tbody>
  </table>

  <div class="legend">
    <span><span class="swatch" style="background:#FCA5A5"></span>Critical path</span>
    <span><span class="swatch" style="background:#93C5FD"></span>In progress</span>
    <span><span class="swatch" style="background:#86EFAC"></span>Complete</span>
    <span><span class="swatch" style="background:#E2E8F0"></span>Not started</span>
    <span><span class="diamond"></span>Milestone</span>
    <span><span class="swatch" style="background:#EF4444;border-color:#B91C1C"></span>Today</span>
  </div>
  `;
}
