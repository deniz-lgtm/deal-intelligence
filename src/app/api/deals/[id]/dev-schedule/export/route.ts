import { NextRequest, NextResponse } from "next/server";
import { dealQueries, devPhaseQueries, getBrandingForDeal } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import {
  SCHEDULE_TRACK_LABELS,
  type DevPhase,
  type ScheduleTrack,
} from "@/lib/types";

// Opt out of static analysis at `next build`. Routes that call requireAuth()
// hit Clerk's auth() which reads headers(), which fails Next.js's static-page
// generation phase unless the route is explicitly marked dynamic.
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/[id]/dev-schedule/export?format=csv|ics&track=acquisition|development|construction|all
 *
 * CSV — flat table of every phase + child task, useful for dropping
 * into Excel / Google Sheets.
 *
 * ICS — standard iCalendar feed. Each phase / task becomes a VEVENT so
 * the analyst can import the schedule into Outlook / Google Calendar /
 * Asana timeline views. Tasks without dates get skipped in ICS
 * (calendar clients won't render a no-date event).
 *
 * `track` is optional and defaults to "all" so existing callers keep
 * working. When set to one of the three tracks, the export is scoped to
 * that track only; passing "all" exports every phase across the deal.
 */

const ICS_ESCAPE = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const CSV_ESCAPE = (s: string | null | undefined) => {
  if (s == null) return "";
  // Collapse embedded newlines to " · ". Excel, Numbers, and Google Sheets
  // all handle CR/LF inside quoted cells, but many analyst workflows pipe
  // the CSV through tools (Airtable import, pandas, Snowflake COPY) that
  // choke on multi-line cells. Collapsing is safer and still readable.
  const flat = String(s).replace(/\r\n|\r|\n/g, " · ");
  const needsQuote = /[",]/.test(flat);
  const body = flat.replace(/"/g, '""');
  return needsQuote ? `"${body}"` : body;
};

// Excel on Windows only auto-detects UTF-8 when the file starts with the
// byte-order mark. Without it, em-dashes, bullets, and non-ASCII names
// render as Mojibake. Prepended to every CSV body on the way out.
const UTF8_BOM = "\uFEFF";

type ScheduleBranding = {
  company_name?: string;
  tagline?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  footer_text?: string;
};

function asDateStamp(iso: string | null): string | null {
  if (!iso) return null;
  // iCalendar DATE format: YYYYMMDD. We treat phases as all-day events
  // so the export stays simple and predictable across clients.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function buildCsv(phases: DevPhase[], dealName: string): string {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const rows = [
    [
      "Deal",
      "Track",
      "Phase / Task",
      "Parent",
      "Predecessor",
      "Start Date",
      "End Date",
      "Duration (days)",
      "Status",
      "% Complete",
      "Category",
      "Owner",
      "Budget (USD)",
      "Notes",
    ].map(CSV_ESCAPE).join(","),
  ];
  const sorted = [...phases].sort((a, b) => {
    // Roots sorted by sort_order; children land right after their parent.
    const aKey = a.parent_phase_id
      ? `${byId.get(a.parent_phase_id)?.sort_order ?? 9999}-${a.sort_order}`
      : `${a.sort_order}-0`;
    const bKey = b.parent_phase_id
      ? `${byId.get(b.parent_phase_id)?.sort_order ?? 9999}-${b.sort_order}`
      : `${b.sort_order}-0`;
    return aKey.localeCompare(bKey);
  });
  for (const p of sorted) {
    const trackLabel = p.track
      ? SCHEDULE_TRACK_LABELS[p.track as ScheduleTrack] ?? p.track
      : "";
    rows.push(
      [
        CSV_ESCAPE(dealName),
        CSV_ESCAPE(trackLabel),
        CSV_ESCAPE(p.label),
        CSV_ESCAPE(p.parent_phase_id ? byId.get(p.parent_phase_id)?.label || "" : ""),
        CSV_ESCAPE(p.predecessor_id ? byId.get(p.predecessor_id)?.label || "" : ""),
        CSV_ESCAPE(p.start_date || ""),
        CSV_ESCAPE(p.end_date || ""),
        CSV_ESCAPE(p.duration_days != null ? String(p.duration_days) : ""),
        CSV_ESCAPE(p.status),
        CSV_ESCAPE(String(p.pct_complete ?? 0)),
        CSV_ESCAPE(p.task_category || ""),
        CSV_ESCAPE(p.task_owner || ""),
        CSV_ESCAPE(p.budget != null ? String(Number(p.budget)) : ""),
        CSV_ESCAPE(p.notes || ""),
      ].join(",")
    );
  }
  return rows.join("\r\n");
}

function XML_ESCAPE(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelColor(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : fallback;
}

function progressBar(value: number | null | undefined): string {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value ?? 0))));
  const filled = Math.round(pct / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${pct}%`;
}

function excelDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

function buildExcelXml(
  phases: DevPhase[],
  dealName: string,
  trackLabel: string,
  branding: ScheduleBranding | null
): string {
  const primary = excelColor(branding?.primary_color, "#1F4E78").replace("#", "");
  const secondary = excelColor(branding?.secondary_color, "#2F3B52").replace("#", "");
  const accent = excelColor(branding?.accent_color, "#10B981").replace("#", "");
  const company = branding?.company_name?.trim() || "Deal Intelligence";
  const footer = branding?.footer_text?.trim() || "CONFIDENTIAL";
  const byId = new Map(phases.map((p) => [p.id, p]));
  const roots = phases
    .filter((p) => !p.parent_phase_id)
    .sort((a, b) => {
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
  const statusLabel = (status: string | null | undefined) =>
    (status || "not_started").replace(/_/g, " ");
  const cell = (
    value: string | number | null | undefined,
    style = "Body",
    type: "String" | "Number" = "String"
  ) =>
    `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${XML_ESCAPE(value)}</Data></Cell>`;
  const blank = (style = "Body") => `<Cell ss:StyleID="${style}"/>`;
  const rowFor = (p: DevPhase, isChild: boolean) => {
    const style = isChild ? "Child" : "Phase";
    return `<Row ss:AutoFitHeight="1">
      ${cell(`${isChild ? "  - " : ""}${p.label}`, style)}
      ${cell(isChild ? "Task" : "Phase", style)}
      ${cell(excelDate(p.start_date), style)}
      ${cell(excelDate(p.end_date), style)}
      ${cell(p.duration_days ?? "", style, p.duration_days == null ? "String" : "Number")}
      ${cell(progressBar(p.pct_complete), style)}
      ${cell(statusLabel(p.status), style)}
      ${cell(p.task_owner || "", style)}
      ${cell(p.predecessor_id ? byId.get(p.predecessor_id)?.label || "" : "", style)}
      ${cell(p.notes || "", style)}
    </Row>`;
  };
  const scheduleRows = roots.flatMap((root) => [
    rowFor(root, false),
    ...childrenFor(root.id).map((child) => rowFor(child, true)),
  ]);

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Title"><Font ss:Bold="1" ss:Size="18" ss:Color="#FFFFFF"/><Interior ss:Color="#${primary}" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="Subtitle"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#${secondary}" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="Meta"><Font ss:Color="#666666"/><Interior ss:Color="#F3F6F8" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#${secondary}" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Phase"><Font ss:Bold="1" ss:Color="#111827"/><Interior ss:Color="#EAF2F8" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D1D5DB"/></Borders></Style>
  <Style ss:ID="Child"><Font ss:Color="#111827"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/></Borders></Style>
  <Style ss:ID="Body"><Font ss:Color="#111827"/></Style>
  <Style ss:ID="Footer"><Font ss:Color="#${accent}" ss:Bold="1"/></Style>
 </Styles>
 <Worksheet ss:Name="Schedule">
  <Table ss:ExpandedColumnCount="10" ss:DefaultRowHeight="18">
   <Column ss:Width="260"/><Column ss:Width="70"/><Column ss:Width="85"/><Column ss:Width="85"/><Column ss:Width="70"/><Column ss:Width="115"/><Column ss:Width="90"/><Column ss:Width="120"/><Column ss:Width="170"/><Column ss:Width="300"/>
   <Row ss:Height="30">${cell(`${dealName} Schedule`, "Title")}${blank("Title")}${blank("Title")}${blank("Title")}${blank("Title")}${blank("Title")}${blank("Title")}${blank("Title")}${blank("Title")}${blank("Title")}</Row>
   <Row>${cell(`${company}${trackLabel ? ` - ${trackLabel}` : ""}`, "Subtitle")}${blank("Subtitle")}${blank("Subtitle")}${blank("Subtitle")}${blank("Subtitle")}${blank("Subtitle")}${blank("Subtitle")}${blank("Subtitle")}${blank("Subtitle")}${blank("Subtitle")}</Row>
   <Row>${cell(`Exported ${new Date().toLocaleDateString("en-US")}`, "Meta")}${blank("Meta")}${blank("Meta")}${blank("Meta")}${blank("Meta")}${blank("Meta")}${blank("Meta")}${blank("Meta")}${blank("Meta")}${blank("Meta")}</Row>
   <Row>${cell("Phase / Task", "Header")}${cell("Type", "Header")}${cell("Start", "Header")}${cell("Finish", "Header")}${cell("Days", "Header")}${cell("Progress", "Header")}${cell("Status", "Header")}${cell("Owner", "Header")}${cell("Predecessor", "Header")}${cell("Notes", "Header")}</Row>
   ${scheduleRows.join("\n")}
   <Row>${cell(footer, "Footer")}${blank("Footer")}${blank("Footer")}${blank("Footer")}${blank("Footer")}${blank("Footer")}${blank("Footer")}${blank("Footer")}${blank("Footer")}${blank("Footer")}</Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/><FrozenNoSplit/><SplitHorizontal>4</SplitHorizontal><TopRowBottomPane>4</TopRowBottomPane>
   <FitToPage/><Print><FitWidth>1</FitWidth><FitHeight>0</FitHeight></Print>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

function buildIcs(phases: DevPhase[], dealName: string): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//deal-intelligence//dev-schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${ICS_ESCAPE(dealName + " — Development Schedule")}`,
  ];
  const nowStamp = asDateStamp(new Date().toISOString()) || "";
  for (const p of phases) {
    const start = asDateStamp(p.start_date);
    const end = asDateStamp(p.end_date);
    // Skip phases without either bound — calendar clients would render
    // them as a zero-width blob or drop them silently.
    if (!start && !end) continue;
    // iCalendar DTEND on a DATE value is *exclusive*, so we shift end
    // forward by a day to match the analyst's intent (phase visually
    // covers through end_date).
    const shiftedEnd = end ? shiftIsoOneDay(p.end_date || "") : null;
    const effectiveStart = start || end || "";
    const effectiveEnd = shiftedEnd || start || "";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${p.id}@deal-intelligence`,
      `DTSTAMP:${nowStamp}T000000Z`,
      `DTSTART;VALUE=DATE:${effectiveStart}`,
      `DTEND;VALUE=DATE:${effectiveEnd}`,
      `SUMMARY:${ICS_ESCAPE(
        `${p.parent_phase_id ? "↳ " : ""}${p.label}${
          p.task_owner ? ` (${p.task_owner})` : ""
        }`
      )}`,
      `DESCRIPTION:${ICS_ESCAPE(
        [
          p.task_category ? `Category: ${p.task_category}` : null,
          p.status ? `Status: ${p.status}` : null,
          p.pct_complete != null ? `Progress: ${p.pct_complete}%` : null,
          p.notes ? `Notes: ${p.notes}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      )}`,
      `STATUS:${p.status === "complete" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  // CRLF line endings per RFC 5545.
  return lines.join("\r\n");
}

function shiftIsoOneDay(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function slugify(s: string): string {
  return (s || "deal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "deal";
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(
      params.id,
      userId
    );
    if (accessError) return accessError;

    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "csv";
    if (format !== "csv" && format !== "ics" && format !== "xls") {
      return NextResponse.json(
        { error: "format must be 'csv', 'ics', or 'xls'" },
        { status: 400 }
      );
    }
    // Track scoping. Default = "all" so the export matches what an
    // analyst expects from the section-header button on the page they're
    // looking at, without forcing the URL to be track-aware. "all" + an
    // unrecognized value both fall through to "no filter".
    const trackParam = url.searchParams.get("track");
    const validTracks: readonly ScheduleTrack[] = [
      "acquisition",
      "development",
      "construction",
    ];
    const trackFilter: ScheduleTrack | null =
      trackParam && (validTracks as readonly string[]).includes(trackParam)
        ? (trackParam as ScheduleTrack)
        : null;
    const focusId = url.searchParams.get("focus");

    const [deal, allPhases, branding] = await Promise.all([
      dealQueries.getById(params.id),
      devPhaseQueries.getByDealId(params.id) as Promise<DevPhase[]>,
      getBrandingForDeal(params.id).catch(() => null) as Promise<ScheduleBranding | null>,
    ]);
    // Filtering is post-fetch so cross-track predecessor and parent
    // labels can still be looked up via byId in buildCsv. We only narrow
    // the rows that *appear* in the output.
    let phases = trackFilter
      ? allPhases.filter((p) => (p.track ?? "development") === trackFilter)
      : allPhases;
    if (focusId) {
      const focusRows = new Set([focusId]);
      for (const p of allPhases) {
        if (p.parent_phase_id === focusId) focusRows.add(p.id);
      }
      phases = phases.filter((p) => focusRows.has(p.id));
    }
    const dealName = (deal as { name?: string })?.name || "Deal";
    const slug = slugify(dealName);
    const focusSlug = focusId ? "-focus" : "";
    const trackSlug = trackFilter ? `-${trackFilter}` : "";

    if (format === "csv") {
      // Prepend UTF-8 BOM so Excel renders non-ASCII characters (em-dashes,
      // bullets, accented names) correctly instead of Mojibake.
      const body = UTF8_BOM + buildCsv(phases, dealName);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}${trackSlug}-schedule.csv"`,
        },
      });
    }
    if (format === "xls") {
      const trackLabel = trackFilter
        ? SCHEDULE_TRACK_LABELS[trackFilter] ?? trackFilter
        : focusId
          ? "Mini Schedule"
          : "All Tracks";
      const body = buildExcelXml(phases, dealName, trackLabel, branding);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}${trackSlug}${focusSlug}-schedule.xls"`,
        },
      });
    }
    const body = buildIcs(phases, dealName);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}${trackSlug}-schedule.ics"`,
      },
    });
  } catch (error) {
    console.error("GET /api/deals/[id]/dev-schedule/export error:", error);
    return NextResponse.json(
      { error: "Failed to export schedule" },
      { status: 500 }
    );
  }
}
