import { NextRequest, NextResponse } from "next/server";
import { dealQueries, devPhaseQueries } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";
import type { DevPhase } from "@/lib/types";

/**
 * GET /api/deals/[id]/dev-schedule/export?format=csv|ics
 *
 * CSV — flat table of every phase + child task, useful for dropping
 * into Excel / Google Sheets.
 *
 * ICS — standard iCalendar feed. Each phase / task becomes a VEVENT so
 * the analyst can import the schedule into Outlook / Google Calendar /
 * Asana timeline views. Tasks without dates get skipped in ICS
 * (calendar clients won't render a no-date event).
 */

const ICS_ESCAPE = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const CSV_ESCAPE = (s: string) => {
  if (s == null) return "";
  const needsQuote = /[",\n]/.test(s);
  const body = s.replace(/"/g, '""');
  return needsQuote ? `"${body}"` : body;
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
    rows.push(
      [
        CSV_ESCAPE(dealName),
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
        CSV_ESCAPE(p.notes || ""),
      ].join(",")
    );
  }
  return rows.join("\r\n");
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

    const format = new URL(req.url).searchParams.get("format") || "csv";
    if (format !== "csv" && format !== "ics") {
      return NextResponse.json(
        { error: "format must be 'csv' or 'ics'" },
        { status: 400 }
      );
    }
    const [deal, phases] = await Promise.all([
      dealQueries.getById(params.id),
      devPhaseQueries.getByDealId(params.id) as Promise<DevPhase[]>,
    ]);
    const dealName = (deal as { name?: string })?.name || "Deal";
    const slug = slugify(dealName);

    if (format === "csv") {
      const body = buildCsv(phases, dealName);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}-schedule.csv"`,
        },
      });
    }
    const body = buildIcs(phases, dealName);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-schedule.ics"`,
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
