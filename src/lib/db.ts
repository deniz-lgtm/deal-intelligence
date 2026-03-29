import { Pool } from "pg";

// ─── Connection Pool ──────────────────────────────────────────────────────────

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "Add a Postgres database in your Railway project and it will be set automatically."
    );
  }

  _pool = new Pool({
    connectionString,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  _pool.on("error", (err) => {
    console.error("Unexpected Postgres pool error:", err);
  });

  return _pool;
}

// ─── Schema Init ──────────────────────────────────────────────────────────────

export async function initSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      zip TEXT NOT NULL DEFAULT '',
      property_type TEXT NOT NULL DEFAULT 'other',
      status TEXT NOT NULL DEFAULT 'diligence',
      starred BOOLEAN NOT NULL DEFAULT false,
      asking_price REAL,
      square_footage REAL,
      units INTEGER,
      bedrooms INTEGER,
      year_built INTEGER,
      notes TEXT,
      loi_executed BOOLEAN NOT NULL DEFAULT false,
      psa_executed BOOLEAN NOT NULL DEFAULT false,
      -- OM Intelligence fields
      om_score INTEGER,
      om_extracted JSONB,
      -- Proforma output fields
      proforma_outputs JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      content_text TEXT,
      ai_summary TEXT,
      ai_tags JSONB,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_documents_deal_id ON documents(deal_id);
    CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);

    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      caption TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_photos_deal_id ON photos(deal_id);

    CREATE TABLE IF NOT EXISTS underwriting (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS loi (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}',
      executed BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      item TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      ai_filled BOOLEAN NOT NULL DEFAULT false,
      source_document_ids JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_checklist_deal_id ON checklist_items(deal_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_chat_deal_id ON chat_messages(deal_id);

    CREATE TABLE IF NOT EXISTS om_analyses (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id          TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      document_id      TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      -- Property
      property_name    TEXT,
      address          TEXT,
      property_type    TEXT,
      year_built       INT,
      sf               INT,
      unit_count       INT,
      -- Financials
      asking_price     NUMERIC,
      noi              NUMERIC,
      cap_rate         NUMERIC,
      grm              NUMERIC,
      cash_on_cash     NUMERIC,
      irr              NUMERIC,
      equity_multiple  NUMERIC,
      dscr             NUMERIC,
      vacancy_rate     NUMERIC,
      expense_ratio    NUMERIC,
      price_per_sf     NUMERIC,
      price_per_unit   NUMERIC,
      -- Assumptions
      rent_growth      TEXT,
      hold_period      TEXT,
      leverage         TEXT,
      exit_cap_rate    TEXT,
      -- Results
      deal_score       INT,
      score_reasoning  TEXT,
      summary          TEXT,
      recommendations  JSONB,
      red_flags        JSONB,
      -- Meta
      deal_context     TEXT,
      model_used       TEXT,
      tokens_used      INT,
      cost_estimate    NUMERIC,
      processing_ms    INT,
      error_message    TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE om_analyses ADD COLUMN IF NOT EXISTS deal_context TEXT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS context_notes TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS dropbox_folder_path TEXT;

    CREATE TABLE IF NOT EXISTS dropbox_accounts (
      id TEXT PRIMARY KEY DEFAULT 'default',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      account_id TEXT,
      display_name TEXT,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );


    CREATE INDEX IF NOT EXISTS idx_om_analyses_deal_id ON om_analyses(deal_id);

    CREATE TABLE IF NOT EXISTS om_qa (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      analysis_id   TEXT NOT NULL,
      deal_id       TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      question      TEXT NOT NULL,
      answer        TEXT NOT NULL,
      model_used    TEXT,
      tokens_used   INT,
      cost_estimate NUMERIC,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_om_qa_analysis_id ON om_qa(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_om_qa_deal_id ON om_qa(deal_id);

    CREATE TABLE IF NOT EXISTS business_plans (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      description TEXT NOT NULL,
      is_default  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS investment_theses JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_markets JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS property_types JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS hold_period_min INTEGER;
    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS hold_period_max INTEGER;
    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_irr_min NUMERIC;
    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_irr_max NUMERIC;
    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_equity_multiple_min NUMERIC;
    ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_equity_multiple_max NUMERIC;

    ALTER TABLE deals ADD COLUMN IF NOT EXISTS business_plan_id TEXT;
  `);
}

// ─── Deal queries ─────────────────────────────────────────────────────────────

export const dealQueries = {
  getAll: async () => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deals ORDER BY starred DESC, updated_at DESC"
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM deals WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  create: async (deal: Record<string, unknown>) => {
    const pool = getPool();
    const cols = [
      "id", "name", "address", "city", "state", "zip", "property_type", "status",
      "starred", "asking_price", "square_footage", "units", "bedrooms", "year_built", "notes",
      "loi_executed", "psa_executed",
    ];
    const vals: unknown[] = [
      deal.id, deal.name, deal.address, deal.city, deal.state, deal.zip,
      deal.property_type, deal.status, deal.starred,
      deal.asking_price ?? null, deal.square_footage ?? null,
      deal.units ?? null, deal.bedrooms ?? null,
      deal.year_built ?? null, deal.notes ?? null,
      deal.loi_executed ?? false, deal.psa_executed ?? false,
    ];
    if (deal.business_plan_id) {
      cols.push("business_plan_id");
      vals.push(deal.business_plan_id);
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(",");
    await pool.query(
      `INSERT INTO deals (${cols.join(", ")}) VALUES (${placeholders})`,
      vals
    );
    return dealQueries.getById(deal.id as string);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const keys = Object.keys(updates);
    if (keys.length === 0) return dealQueries.getById(id);

    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]);
    values.push(id);

    await pool.query(
      `UPDATE deals SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length}`,
      values
    );
    return dealQueries.getById(id);
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deals WHERE id = $1", [id]);
  },

  appendContextNote: async (id: string, note: string) => {
    const pool = getPool();
    await pool.query(
      `UPDATE deals
       SET context_notes = CASE
         WHEN context_notes IS NULL OR context_notes = '' THEN $1
         ELSE context_notes || E'\n\n' || $1
       END,
       updated_at = NOW()
       WHERE id = $2`,
      [note, id]
    );
    return dealQueries.getById(id);
  },
};

// ─── Document queries ─────────────────────────────────────────────────────────

export const documentQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM documents WHERE deal_id = $1 ORDER BY category, uploaded_at DESC",
      [dealId]
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM documents WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  create: async (doc: Record<string, unknown>) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO documents
        (id, deal_id, name, original_name, category, file_path,
         file_size, mime_type, content_text, ai_summary, ai_tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        doc.id,
        doc.deal_id,
        doc.name,
        doc.original_name,
        doc.category,
        doc.file_path,
        doc.file_size,
        doc.mime_type,
        doc.content_text ?? null,
        doc.ai_summary ?? null,
        doc.ai_tags ? JSON.stringify(doc.ai_tags) : null,
      ]
    );
    return documentQueries.getById(doc.id as string);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const keys = Object.keys(updates);
    if (keys.length === 0) return documentQueries.getById(id);
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]);
    await pool.query(
      `UPDATE documents SET ${setClauses}, uploaded_at = NOW() WHERE id = $${values.length + 1}`,
      [...values, id]
    );
    return documentQueries.getById(id);
  },

  delete: async (id: string) => {
    const pool = getPool();
    const doc = await documentQueries.getById(id);
    await pool.query("DELETE FROM documents WHERE id = $1", [id]);
    return doc;
  },
};

// ─── Photo queries ─────────────────────────────────────────────────────────────

export const photoQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM photos WHERE deal_id = $1 ORDER BY uploaded_at ASC",
      [dealId]
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM photos WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  create: async (photo: Record<string, unknown>) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO photos
        (id, deal_id, name, original_name, file_path, file_size, mime_type, caption)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        photo.id,
        photo.deal_id,
        photo.name,
        photo.original_name,
        photo.file_path,
        photo.file_size,
        photo.mime_type,
        photo.caption ?? null,
      ]
    );
    return photoQueries.getById(photo.id as string);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const keys = Object.keys(updates);
    if (keys.length === 0) return photoQueries.getById(id);

    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]);
    values.push(id);

    await pool.query(
      `UPDATE photos SET ${setClauses} WHERE id = $${values.length}`,
      values
    );
    return photoQueries.getById(id);
  },

  delete: async (id: string) => {
    const pool = getPool();
    const photo = await photoQueries.getById(id);
    await pool.query("DELETE FROM photos WHERE id = $1", [id]);
    return photo;
  },
};

// ─── Underwriting queries ─────────────────────────────────────────────────────

export const underwritingQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM underwriting WHERE deal_id = $1",
      [dealId]
    );
    return res.rows[0] ?? null;
  },

  upsert: async (dealId: string, id: string, data: string) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO underwriting (id, deal_id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (deal_id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [id, dealId, data]
    );
    return underwritingQueries.getByDealId(dealId);
  },
};

// ─── LOI queries ──────────────────────────────────────────────────────────────

export const loiQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM loi WHERE deal_id = $1",
      [dealId]
    );
    return res.rows[0] ?? null;
  },

  upsert: async (dealId: string, id: string, data: string, executed: boolean) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO loi (id, deal_id, data, executed, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (deal_id) DO UPDATE SET
         data = EXCLUDED.data,
         executed = EXCLUDED.executed,
         updated_at = NOW()`,
      [id, dealId, data, executed]
    );
    return loiQueries.getByDealId(dealId);
  },
};

// ─── Checklist queries ────────────────────────────────────────────────────────

export const checklistQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM checklist_items WHERE deal_id = $1 ORDER BY category, item",
      [dealId]
    );
    return res.rows;
  },

  upsert: async (item: Record<string, unknown>) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO checklist_items
        (id, deal_id, category, item, status, notes, ai_filled, source_document_ids, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT(id) DO UPDATE SET
         status = EXCLUDED.status,
         notes = EXCLUDED.notes,
         ai_filled = EXCLUDED.ai_filled,
         source_document_ids = EXCLUDED.source_document_ids,
         updated_at = NOW()`,
      [
        item.id,
        item.deal_id,
        item.category,
        item.item,
        item.status,
        item.notes ?? null,
        item.ai_filled ?? false,
        item.source_document_ids
          ? JSON.stringify(item.source_document_ids)
          : null,
      ]
    );
  },

  updateStatus: async (id: string, status: string, notes: string | null) => {
    const pool = getPool();
    await pool.query(
      "UPDATE checklist_items SET status = $1, notes = $2, updated_at = NOW() WHERE id = $3",
      [status, notes, id]
    );
  },

  bulkUpsert: async (items: Record<string, unknown>[]) => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of items) {
        await client.query(
          `INSERT INTO checklist_items
            (id, deal_id, category, item, status, notes, ai_filled, source_document_ids, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT(id) DO UPDATE SET
             status = EXCLUDED.status,
             notes = EXCLUDED.notes,
             ai_filled = EXCLUDED.ai_filled,
             source_document_ids = EXCLUDED.source_document_ids,
             updated_at = NOW()`,
          [
            item.id,
            item.deal_id,
            item.category,
            item.item,
            item.status,
            item.notes ?? null,
            item.ai_filled ?? false,
            item.source_document_ids
              ? JSON.stringify(item.source_document_ids)
              : null,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
};

// ─── Chat queries ─────────────────────────────────────────────────────────────

export const chatQueries = {
  getByDealId: async (dealId: string, limit = 50) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM chat_messages WHERE deal_id = $1 ORDER BY created_at ASC LIMIT $2",
      [dealId, limit]
    );
    return res.rows;
  },

  create: async (msg: Record<string, unknown>) => {
    const pool = getPool();
    await pool.query(
      "INSERT INTO chat_messages (id, deal_id, role, content, metadata) VALUES ($1,$2,$3,$4,$5)",
      [msg.id, msg.deal_id, msg.role, msg.content, msg.metadata ? JSON.stringify(msg.metadata) : null]
    );
  },

  clear: async (dealId: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM chat_messages WHERE deal_id = $1", [dealId]);
  },
};

// ─── OM Analysis queries ──────────────────────────────────────────────────────

export interface OmAnalysisRow {
  id: string;
  deal_id: string;
  document_id: string | null;
  status: "pending" | "processing" | "complete" | "error";
  // Property
  property_name: string | null;
  address: string | null;
  property_type: string | null;
  year_built: number | null;
  sf: number | null;
  unit_count: number | null;
  // Financials
  asking_price: number | null;
  noi: number | null;
  cap_rate: number | null;
  grm: number | null;
  cash_on_cash: number | null;
  irr: number | null;
  equity_multiple: number | null;
  dscr: number | null;
  vacancy_rate: number | null;
  expense_ratio: number | null;
  price_per_sf: number | null;
  price_per_unit: number | null;
  // Assumptions
  rent_growth: string | null;
  hold_period: string | null;
  leverage: string | null;
  exit_cap_rate: string | null;
  // Results
  deal_score: number | null;
  score_reasoning: string | null;
  summary: string | null;
  recommendations: string[] | null;
  red_flags: Array<{
    severity: "critical" | "high" | "medium" | "low";
    category: string;
    description: string;
    recommendation: string;
  }> | null;
  // Meta
  deal_context: string | null;
  model_used: string | null;
  tokens_used: number | null;
  cost_estimate: number | null;
  processing_ms: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export const omAnalysisQueries = {
  getByDealId: async (dealId: string): Promise<OmAnalysisRow | null> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM om_analyses WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 1",
      [dealId]
    );
    return res.rows[0] ?? null;
  },

  getAllByDealId: async (dealId: string): Promise<OmAnalysisRow[]> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM om_analyses WHERE deal_id = $1 ORDER BY created_at DESC",
      [dealId]
    );
    return res.rows;
  },

  getById: async (id: string): Promise<OmAnalysisRow | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM om_analyses WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  create: async (dealId: string, documentId: string | null): Promise<OmAnalysisRow> => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO om_analyses (deal_id, document_id, status)
       VALUES ($1, $2, 'processing')
       RETURNING *`,
      [dealId, documentId]
    );
    return res.rows[0];
  },

  updateStatus: async (id: string, status: string, errorMessage?: string): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `UPDATE om_analyses SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
      [status, errorMessage ?? null, id]
    );
  },

  setResult: async (id: string, result: Partial<OmAnalysisRow>): Promise<OmAnalysisRow | null> => {
    const pool = getPool();
    const keys = Object.keys(result).filter((k) => k !== "id" && k !== "deal_id" && k !== "created_at");
    if (keys.length === 0) return omAnalysisQueries.getById(id);

    const setClauses = keys
      .map((k, i) => {
        if (k === "recommendations" || k === "red_flags") return `"${k}" = $${i + 1}::jsonb`;
        return `"${k}" = $${i + 1}`;
      })
      .join(", ");
    const values = keys.map((k) => {
      const v = result[k as keyof OmAnalysisRow];
      if (k === "recommendations" || k === "red_flags") return JSON.stringify(v);
      return v;
    });

    await pool.query(
      `UPDATE om_analyses SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length + 1}`,
      [...values, id]
    );
    return omAnalysisQueries.getById(id);
  },
};

// ─── OM Q&A queries ───────────────────────────────────────────────────────────

export interface OmQaRow {
  id: string;
  analysis_id: string;
  deal_id: string;
  question: string;
  answer: string;
  model_used: string | null;
  tokens_used: number | null;
  cost_estimate: number | null;
  created_at: string;
}

export const omQaQueries = {
  getByDealId: async (dealId: string): Promise<OmQaRow[]> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM om_qa WHERE deal_id = $1 ORDER BY created_at ASC",
      [dealId]
    );
    return res.rows;
  },

  getByAnalysisId: async (analysisId: string): Promise<OmQaRow[]> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM om_qa WHERE analysis_id = $1 ORDER BY created_at ASC",
      [analysisId]
    );
    return res.rows;
  },

  create: async (row: {
    analysis_id: string;
    deal_id: string;
    question: string;
    answer: string;
    model_used?: string;
    tokens_used?: number;
    cost_estimate?: number;
  }): Promise<OmQaRow> => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO om_qa (analysis_id, deal_id, question, answer, model_used, tokens_used, cost_estimate)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        row.analysis_id,
        row.deal_id,
        row.question,
        row.answer,
        row.model_used ?? null,
        row.tokens_used ?? null,
        row.cost_estimate ?? null,
      ]
    );
    return res.rows[0];
  },

  clearByDealId: async (dealId: string): Promise<void> => {
    const pool = getPool();
    await pool.query("DELETE FROM om_qa WHERE deal_id = $1", [dealId]);
  },
};

// ─── Business Plan queries ────────────────────────────────────────────────────

export interface BusinessPlanRow {
  id: string;
  name: string;
  description: string;
  investment_theses: string[]; // JSONB array
  target_markets: string[];   // JSONB array
  property_types: string[];   // JSONB array
  hold_period_min: number | null;
  hold_period_max: number | null;
  target_irr_min: number | null;
  target_irr_max: number | null;
  target_equity_multiple_min: number | null;
  target_equity_multiple_max: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export const businessPlanQueries = {
  getAll: async (): Promise<BusinessPlanRow[]> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM business_plans ORDER BY is_default DESC, name ASC"
    );
    return res.rows;
  },

  getById: async (id: string): Promise<BusinessPlanRow | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM business_plans WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  getDefault: async (): Promise<BusinessPlanRow | null> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM business_plans WHERE is_default = true LIMIT 1"
    );
    return res.rows[0] ?? null;
  },

  create: async (plan: {
    name: string;
    description: string;
    is_default?: boolean;
    investment_theses?: string[];
    target_markets?: string[];
    property_types?: string[];
    hold_period_min?: number | null;
    hold_period_max?: number | null;
    target_irr_min?: number | null;
    target_irr_max?: number | null;
    target_equity_multiple_min?: number | null;
    target_equity_multiple_max?: number | null;
  }): Promise<BusinessPlanRow> => {
    const pool = getPool();
    const insertQuery = `INSERT INTO business_plans (name, description, is_default, investment_theses, target_markets, property_types,
        hold_period_min, hold_period_max, target_irr_min, target_irr_max, target_equity_multiple_min, target_equity_multiple_max)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)
       RETURNING *`;
    const insertParams = [
      plan.name,
      plan.description,
      plan.is_default ?? false,
      JSON.stringify(plan.investment_theses ?? []),
      JSON.stringify(plan.target_markets ?? []),
      JSON.stringify(plan.property_types ?? []),
      plan.hold_period_min ?? null,
      plan.hold_period_max ?? null,
      plan.target_irr_min ?? null,
      plan.target_irr_max ?? null,
      plan.target_equity_multiple_min ?? null,
      plan.target_equity_multiple_max ?? null,
    ];
    try {
      const res = await pool.query(insertQuery, insertParams);
      return res.rows[0];
    } catch (err) {
      // If columns are missing, re-run schema migration and retry once
      if (err instanceof Error && err.message.includes("does not exist")) {
        console.warn("Business plans schema incomplete, running migration...", err.message);
        await pool.query(`
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS investment_theses JSONB NOT NULL DEFAULT '[]';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_markets JSONB NOT NULL DEFAULT '[]';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS property_types JSONB NOT NULL DEFAULT '[]';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS hold_period_min INTEGER;
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS hold_period_max INTEGER;
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_irr_min NUMERIC;
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_irr_max NUMERIC;
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_equity_multiple_min NUMERIC;
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_equity_multiple_max NUMERIC;
        `);
        const res = await pool.query(insertQuery, insertParams);
        return res.rows[0];
      }
      throw err;
    }
  },

  update: async (id: string, updates: Record<string, unknown>): Promise<BusinessPlanRow | null> => {
    const pool = getPool();
    const keys = Object.keys(updates);
    if (keys.length === 0) return businessPlanQueries.getById(id);

    const jsonbFields = new Set(["investment_theses", "target_markets", "property_types"]);
    const setClauses = keys.map((k, i) => {
      if (jsonbFields.has(k)) return `"${k}" = $${i + 1}::jsonb`;
      return `"${k}" = $${i + 1}`;
    }).join(", ");
    const values = keys.map((k) => {
      if (jsonbFields.has(k)) return JSON.stringify(updates[k]);
      return updates[k];
    });

    await pool.query(
      `UPDATE business_plans SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length + 1}`,
      [...values, id]
    );
    return businessPlanQueries.getById(id);
  },

  setDefault: async (id: string): Promise<void> => {
    const pool = getPool();
    // Clear all defaults first, then set the target
    await pool.query("UPDATE business_plans SET is_default = false, updated_at = NOW() WHERE is_default = true");
    await pool.query("UPDATE business_plans SET is_default = true, updated_at = NOW() WHERE id = $1", [id]);
  },

  delete: async (id: string): Promise<void> => {
    const pool = getPool();
    await pool.query("DELETE FROM business_plans WHERE id = $1", [id]);
  },
};

// ─── Dropbox queries ──────────────────────────────────────────────────────────

export interface DropboxAccount {
  id: string;
  access_token: string;
  refresh_token: string | null;
  account_id: string | null;
  display_name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export const dropboxQueries = {
  get: async (): Promise<DropboxAccount | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM dropbox_accounts WHERE id = 'default'");
    return res.rows[0] ?? null;
  },

  upsert: async (data: {
    access_token: string;
    refresh_token?: string;
    account_id?: string;
    display_name?: string;
    email?: string;
  }): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO dropbox_accounts (id, access_token, refresh_token, account_id, display_name, email, updated_at)
       VALUES ('default', $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, dropbox_accounts.refresh_token),
         account_id = COALESCE(EXCLUDED.account_id, dropbox_accounts.account_id),
         display_name = COALESCE(EXCLUDED.display_name, dropbox_accounts.display_name),
         email = COALESCE(EXCLUDED.email, dropbox_accounts.email),
         updated_at = NOW()`,
      [
        data.access_token,
        data.refresh_token ?? null,
        data.account_id ?? null,
        data.display_name ?? null,
        data.email ?? null,
      ]
    );
  },

  updateToken: async (accessToken: string): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE dropbox_accounts SET access_token = $1, updated_at = NOW() WHERE id = 'default'",
      [accessToken]
    );
  },

  disconnect: async (): Promise<void> => {
    const pool = getPool();
    await pool.query("DELETE FROM dropbox_accounts WHERE id = 'default'");
  },
};
