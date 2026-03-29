import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ActivityEvent {
  type: string;
  description: string;
  timestamp: string;
  deal_id: string;
  deal_name: string;
  cost?: number;
  model?: string;
  tokens?: number;
}

export async function GET() {
  const pool = getPool();

  try {
    const [omRows, chatRows, uwRows, docRows, statusRows] = await Promise.all([
      pool.query(
        `SELECT a.id, a.deal_id, d.name as deal_name, a.status, a.model_used, a.tokens_used, a.cost_estimate, a.created_at
         FROM om_analyses a JOIN deals d ON d.id = a.deal_id
         ORDER BY a.created_at DESC LIMIT 50`
      ),
      pool.query(
        `SELECT c.id, c.deal_id, d.name as deal_name, c.role, LEFT(c.content, 80) as preview, c.created_at
         FROM chat_messages c JOIN deals d ON d.id = c.deal_id
         WHERE c.role = 'user'
         ORDER BY c.created_at DESC LIMIT 30`
      ),
      pool.query(
        `SELECT u.deal_id, d.name as deal_name, u.updated_at
         FROM underwriting u JOIN deals d ON d.id = u.deal_id
         ORDER BY u.updated_at DESC LIMIT 20`
      ),
      pool.query(
        `SELECT doc.id, doc.deal_id, d.name as deal_name, doc.original_name, doc.uploaded_at
         FROM documents doc JOIN deals d ON d.id = doc.deal_id
         ORDER BY doc.uploaded_at DESC LIMIT 30`
      ),
      // Deal status changes tracked via updated_at on deals
      pool.query(
        `SELECT id as deal_id, name as deal_name, status, created_at, updated_at
         FROM deals
         ORDER BY updated_at DESC LIMIT 20`
      ),
    ]);

    const events: ActivityEvent[] = [];

    for (const row of omRows.rows) {
      events.push({
        type: "om_analysis",
        description: `OM Analysis ${row.status === "complete" ? "completed" : row.status}`,
        timestamp: row.created_at,
        deal_id: row.deal_id,
        deal_name: row.deal_name,
        cost: row.cost_estimate ? Number(row.cost_estimate) : undefined,
        model: row.model_used || undefined,
        tokens: row.tokens_used || undefined,
      });
    }

    for (const row of chatRows.rows) {
      events.push({
        type: "chat",
        description: `"${row.preview}${row.preview?.length >= 80 ? "…" : ""}"`,
        timestamp: row.created_at,
        deal_id: row.deal_id,
        deal_name: row.deal_name,
      });
    }

    for (const row of uwRows.rows) {
      events.push({
        type: "underwriting",
        description: "Underwriting model updated",
        timestamp: row.updated_at,
        deal_id: row.deal_id,
        deal_name: row.deal_name,
      });
    }

    for (const row of docRows.rows) {
      events.push({
        type: "document",
        description: `Uploaded ${row.original_name}`,
        timestamp: row.uploaded_at,
        deal_id: row.deal_id,
        deal_name: row.deal_name,
      });
    }

    // Deal creation events
    for (const row of statusRows.rows) {
      events.push({
        type: "deal",
        description: `Deal created`,
        timestamp: row.created_at,
        deal_id: row.deal_id,
        deal_name: row.deal_name,
      });
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Limit to 50 most recent
    const trimmed = events.slice(0, 50);

    return NextResponse.json({ data: trimmed });
  } catch (err) {
    console.error("Global activity API error:", err);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}
