import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

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
    // Aggregate from multiple tables in parallel
    const [omRows, chatRows, uwRows, docRows] = await Promise.all([
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

    // Document uploads
    for (const row of docRows.rows) {
      events.push({
        type: "document",
        description: `Document uploaded: ${row.original_name}`,
        timestamp: row.uploaded_at,
      });
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
