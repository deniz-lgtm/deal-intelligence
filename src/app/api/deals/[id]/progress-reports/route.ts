import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { progressReportQueries, getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

async function ensureTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS progress_reports (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      report_type TEXT NOT NULL DEFAULT 'weekly',
      title TEXT NOT NULL DEFAULT '',
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      summary TEXT,
      work_completed TEXT,
      work_planned TEXT,
      issues TEXT,
      weather_delays TEXT,
      pct_complete INTEGER,
      ai_executive_summary TEXT,
      ai_budget_narrative TEXT,
      ai_schedule_narrative TEXT,
      ai_risk_narrative TEXT,
      contractor_invite_id TEXT,
      submitted_by_email TEXT,
      submitted_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    let reports;
    try {
      reports = await progressReportQueries.getByDealId(params.id);
    } catch {
      await ensureTable();
      reports = await progressReportQueries.getByDealId(params.id);
    }
    return NextResponse.json({ data: reports });
  } catch (error) {
    console.error("GET /api/deals/[id]/progress-reports error:", error);
    return NextResponse.json({ error: "Failed to fetch progress reports" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;

    const body = await req.json();

    if (!body.period_start || !body.period_end) {
      return NextResponse.json(
        { error: "period_start and period_end are required" },
        { status: 400 }
      );
    }

    const payload = {
      id: uuidv4(),
      deal_id: params.id,
      report_type: body.report_type ?? "weekly",
      title: body.title ?? "",
      period_start: body.period_start,
      period_end: body.period_end,
      status: body.status ?? "draft",
      summary: body.summary ?? null,
      work_completed: body.work_completed ?? null,
      work_planned: body.work_planned ?? null,
      issues: body.issues ?? null,
      weather_delays: body.weather_delays ?? null,
      pct_complete: body.pct_complete ?? null,
    };

    let report;
    try {
      report = await progressReportQueries.create(payload);
    } catch {
      await ensureTable();
      report = await progressReportQueries.create(payload);
    }

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error("POST /api/deals/[id]/progress-reports error:", error);
    return NextResponse.json({ error: "Failed to create progress report" }, { status: 500 });
  }
}
