import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { contactQueries, getPool } from "@/lib/db";
import { requirePermission } from "@/lib/auth";

async function ensureContactsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'broker',
      company TEXT,
      title TEXT,
      notes TEXT,
      tags JSONB NOT NULL DEFAULT '[]',
      owner_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_contacts_role ON contacts(role)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_contacts_name_lower ON contacts(LOWER(name))`
  );
}

export async function GET(req: NextRequest) {
  const { errorResponse } = await requirePermission("contacts.access");
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || undefined;
    const role = searchParams.get("role") || undefined;

    let rows;
    try {
      rows = await contactQueries.getAll({ q, role });
    } catch {
      await ensureContactsTable();
      rows = await contactQueries.getAll({ q, role });
    }
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/contacts error:", error);
    return NextResponse.json({ error: "Failed to fetch contacts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId, errorResponse } = await requirePermission("contacts.access");
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const payload = {
      id: uuidv4(),
      name: body.name.trim(),
      email: body.email?.trim() || null,
      phone: body.phone?.trim() || null,
      role: body.role || "broker",
      company: body.company?.trim() || null,
      title: body.title?.trim() || null,
      notes: body.notes?.trim() || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      owner_id: userId,
    };

    let row;
    try {
      row = await contactQueries.create(payload);
    } catch {
      await ensureContactsTable();
      row = await contactQueries.create(payload);
    }

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    console.error("POST /api/contacts error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Failed to create contact: ${message}` }, { status: 500 });
  }
}
