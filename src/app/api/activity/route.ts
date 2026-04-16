import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireAuth, syncCurrentUser } from "@/lib/auth";

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
  const { userId, errorResponse } = await requireAuth();
  if (errorResponse) return errorResponse;
  await syncCurrentUser(userId);

  const pool = getPool();

  // Sub-query to get only deal IDs the user can access (owner, shared, or legacy)
  const accessibleDeals = `(
    SELECT DISTINCT d.id FROM deals d
    LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
    WHERE d.owner_id = $1 OR ds.deal_id IS NOT NULL
  )`;

  try {
    const [omRows, chatRows, uwRows, docRows, statusRows] = await Promise.all([
      pool.query(
        `SELECT a.id, a.deal_id, d.name as deal_name, a.status, a.model_used, a.tokens_used, a.cost_estimate, a.created_at
         FROM om_analyses a JOIN deals d ON d.id = a.deal_id
         WHERE a.deal_id IN ${accessibleDeals}
         ORDER BY a.created_at DESC LIMIT 50`,
        [userId]
      ),
      pool.query(
        `SELECT c.id, c.deal_id, d.name as deal_name, c.role, LEFT(c.content, 80) as preview, c.created_at
         FROM chat_messages c JOIN deals d ON d.id = c.deal_id
         WHERE c.role = 'user' AND c.deal_id IN ${accessibleDeals}
         ORDER BY c.created_at DESC LIMIT 30`,
        [userId]
      ),
      pool.query(
        `SELECT u.deal_id, d.name as deal_name, u.updated_at
         FROM underwriting u JOIN deals d ON d.id = u.deal_id
         WHERE u.deal_id IN ${accessibleDeals}
         ORDER BY u.updated_at DESC LIMIT 20`,
        [userId]
      ),
      pool.query(
        `SELECT doc.id, doc.deal_id, d.name as deal_name, doc.original_name, doc.uploaded_at
         FROM documents doc JOIN deals d ON d.id = doc.deal_id
         WHERE doc.deal_id IN ${accessibleDeals}
         ORDER BY doc.uploaded_at DESC LIMIT 30`,
        [userId]
      ),
      pool.query(
        `SELECT d.id as deal_id, d.name as deal_name, d.status, d.created_at, d.updated_at
         FROM deals d
         WHERE d.id IN ${accessibleDeals}
         ORDER BY d.updated_at DESC LIMIT 20`,
        [userId]
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
