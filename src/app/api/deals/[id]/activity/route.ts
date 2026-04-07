import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, requireDealAccess } from "@/lib/auth";

interface ActivityEvent {
  type: string;
  description: string;
  timestamp: string;
  cost?: number;
  model?: string;
  tokens?: number;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const dealId = params.id;

  try {
    const { userId, errorResponse } = await requireAuth();
    if (errorResponse) return errorResponse;
    const { errorResponse: accessError } = await requireDealAccess(params.id, userId);
    if (accessError) return accessError;
    // Aggregate from multiple tables in parallel. Queries that target
    // optional tables are wrapped so missing tables don't fail the whole
    // endpoint.
    const safeQuery = async <T = Record<string, unknown>>(sql: string, values: unknown[]): Promise<{ rows: T[] }> => {
      try {
        return await pool.query(sql, values);
      } catch {
        return { rows: [] };
      }
    };

    const [omRows, chatRows, uwRows, docRows, loiRows, photoRows, checklistRows, ddAbstractRows, ipRows] = await Promise.all([
      pool.query(
        `SELECT id, status, model_used, tokens_used, cost_estimate, created_at
         FROM om_analyses WHERE deal_id = $1 ORDER BY created_at DESC`,
        [dealId]
      ),
      pool.query(
        `SELECT id, role, LEFT(content, 80) as preview, created_at
         FROM chat_messages WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [dealId]
      ),
      pool.query(
        `SELECT updated_at FROM underwriting WHERE deal_id = $1`,
        [dealId]
      ),
      pool.query(
        `SELECT id, original_name, uploaded_at FROM documents WHERE deal_id = $1 ORDER BY uploaded_at DESC`,
        [dealId]
      ),
      safeQuery<{ executed: boolean; updated_at: string }>(
        `SELECT executed, updated_at FROM loi WHERE deal_id = $1`,
        [dealId]
      ),
      safeQuery<{ original_name: string; uploaded_at: string }>(
        `SELECT original_name, uploaded_at FROM photos WHERE deal_id = $1 ORDER BY uploaded_at DESC LIMIT 50`,
        [dealId]
      ),
      safeQuery<{ item: string; status: string; updated_at: string }>(
        `SELECT item, status, updated_at FROM checklist_items
         WHERE deal_id = $1 AND status IN ('complete', 'issue')
         ORDER BY updated_at DESC LIMIT 25`,
        [dealId]
      ),
      safeQuery<{ original_name: string; uploaded_at: string }>(
        `SELECT original_name, uploaded_at FROM documents
         WHERE deal_id = $1 AND category = 'dd_abstract'
         ORDER BY uploaded_at DESC LIMIT 10`,
        [dealId]
      ),
      safeQuery<{ data: Record<string, unknown> }>(
        `SELECT data FROM underwriting WHERE deal_id = $1`,
        [dealId]
      ),
    ]);

    const events: ActivityEvent[] = [];

    // OM Analysis events
    for (const row of omRows.rows) {
      events.push({
        type: "om_analysis",
        description: `OM Analysis ${row.status === "complete" ? "completed" : row.status}`,
        timestamp: row.created_at,
        cost: row.cost_estimate ? Number(row.cost_estimate) : undefined,
        model: row.model_used || undefined,
        tokens: row.tokens_used || undefined,
      });
    }

    // Chat messages
    for (const row of chatRows.rows) {
      if (row.role === "user") {
        events.push({
          type: "chat",
          description: `Chat: "${row.preview}${row.preview?.length >= 80 ? "…" : ""}"`,
          timestamp: row.created_at,
        });
      }
    }

    // Underwriting saves
    for (const row of uwRows.rows) {
      events.push({
        type: "underwriting",
        description: "Underwriting updated",
        timestamp: row.updated_at,
      });
    }

    // Document uploads (excluding generated DD Abstracts which we surface
    // separately below)
    for (const row of docRows.rows) {
      events.push({
        type: "document",
        description: `Document uploaded: ${row.original_name}`,
        timestamp: row.uploaded_at,
      });
    }

    // LOI saves & execution
    for (const row of loiRows.rows) {
      events.push({
        type: "loi",
        description: row.executed ? "LOI executed" : "LOI updated",
        timestamp: row.updated_at,
      });
    }

    // Photo uploads
    for (const row of photoRows.rows) {
      events.push({
        type: "photo",
        description: `Photo uploaded: ${row.original_name}`,
        timestamp: row.uploaded_at,
      });
    }

    // Checklist completions / issues
    for (const row of checklistRows.rows) {
      events.push({
        type: "checklist",
        description: `Checklist ${row.status === "complete" ? "completed" : "flagged"}: ${row.item}`,
        timestamp: row.updated_at,
      });
    }

    // DD Abstract generations (saved as documents)
    for (const row of ddAbstractRows.rows) {
      events.push({
        type: "dd_abstract",
        description: `DD Abstract generated: ${row.original_name}`,
        timestamp: row.uploaded_at,
      });
    }

    // Investment Package generation (timestamp lives in underwriting JSONB)
    for (const row of ipRows.rows) {
      const data = row.data as Record<string, unknown> | null;
      const meta = data?.investment_package_meta as Record<string, unknown> | undefined;
      const generatedAt = meta?.generated_at as string | undefined;
      if (generatedAt) {
        events.push({
          type: "investment_package",
          description: "Investment Package generated",
          timestamp: generatedAt,
        });
      }
    }

    // Sort by timestamp descending
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Summary stats
    const totalCost = omRows.rows.reduce(
      (sum: number, r: { cost_estimate: string | null }) => sum + (r.cost_estimate ? Number(r.cost_estimate) : 0),
      0
    );
    const totalTokens = omRows.rows.reduce(
      (sum: number, r: { tokens_used: number | null }) => sum + (r.tokens_used || 0),
      0
    );
    const modelsUsed = Array.from(new Set(omRows.rows.map((r: { model_used: string | null }) => r.model_used).filter(Boolean))) as string[];

    return NextResponse.json({
      events,
      summary: {
        total_cost: totalCost,
        total_tokens: totalTokens,
        models_used: modelsUsed,
        event_count: events.length,
      },
    });
  } catch (err) {
    console.error("Activity API error:", err);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}
