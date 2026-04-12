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

  // Fire-and-forget: ensure all ALTER-added columns exist on first connection
  ensureColumns().catch(() => {});

  return _pool;
}

// ─── Lazy Column Migration ───────────────────────────────────────────────────
// Runs once per process to ensure all ALTER-added columns exist.
// This prevents "column does not exist" errors when the DB hasn't been
// restarted since new columns were added to initSchema().

let _columnsMigrated = false;

export async function ensureColumns(): Promise<void> {
  if (_columnsMigrated) return;
  _columnsMigrated = true; // Set early to prevent concurrent runs

  const pool = getPool();
  const alters = [
    // Ensure tables that may be missing on older deployments
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS deal_shares (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'edit' CHECK (permission IN ('view', 'edit')),
      shared_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(deal_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_shares_deal_id ON deal_shares(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deal_shares_user_id ON deal_shares(user_id)`,
    // deals table
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS business_plan_id TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS context_notes TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS dropbox_folder_path TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS investment_strategy TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS owner_id TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS uw_score INTEGER",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS uw_score_reasoning TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS final_score INTEGER",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS final_score_reasoning TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS land_acres REAL",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS lat NUMERIC",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS lng NUMERIC",
    // Inbox / AI Deal Sourcing columns
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS auto_ingested BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS inbox_reviewed_at TIMESTAMPTZ",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS ingested_from_path TEXT",
    "ALTER TABLE dropbox_accounts ADD COLUMN IF NOT EXISTS watched_folder_path TEXT",
    "ALTER TABLE dropbox_accounts ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ",
    "CREATE INDEX IF NOT EXISTS idx_deals_auto_ingested ON deals(auto_ingested) WHERE auto_ingested = true",
    "CREATE INDEX IF NOT EXISTS idx_deals_ingested_from_path ON deals(ingested_from_path) WHERE ingested_from_path IS NOT NULL",
    // documents table
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_key BOOLEAN NOT NULL DEFAULT false",
    // Document Intelligence Pipeline: version chains
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS parent_document_id TEXT",
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS auto_diff_result JSONB",
    "CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_document_id) WHERE parent_document_id IS NOT NULL",
    // photos table
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS is_cover BOOLEAN NOT NULL DEFAULT false",
    // chat_messages table
    "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB",
    // business_plans table
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS investment_theses JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_markets JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS property_types JSONB NOT NULL DEFAULT '[]'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS hold_period_min INTEGER",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS hold_period_max INTEGER",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_irr_min NUMERIC",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_irr_max NUMERIC",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_equity_multiple_min NUMERIC",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_equity_multiple_max NUMERIC",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_company_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_tagline TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_logo_url TEXT",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_logo_width INTEGER",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_primary_color TEXT NOT NULL DEFAULT '#4F46E5'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_secondary_color TEXT NOT NULL DEFAULT '#2F3B52'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_accent_color TEXT NOT NULL DEFAULT '#10B981'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_header_font TEXT NOT NULL DEFAULT 'Helvetica'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_body_font TEXT NOT NULL DEFAULT 'Calibri'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_footer_text TEXT NOT NULL DEFAULT 'CONFIDENTIAL'",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_website TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_email TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_phone TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_address TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_disclaimer_text TEXT NOT NULL DEFAULT ''",
    // Project management tables (must exist before any task/milestone queries)
    `CREATE TABLE IF NOT EXISTS deal_milestones (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      stage TEXT,
      target_date DATE,
      completed_at TIMESTAMPTZ,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_milestones_deal_id ON deal_milestones(deal_id)`,
    `CREATE TABLE IF NOT EXISTS deal_tasks (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      assignee TEXT,
      due_date DATE,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'todo',
      milestone_id TEXT REFERENCES deal_milestones(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_tasks_deal_id ON deal_tasks(deal_id)`,
    `CREATE TABLE IF NOT EXISTS deal_dev_phases (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      phase_key TEXT NOT NULL,
      label TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      pct_complete INTEGER NOT NULL DEFAULT 0,
      budget NUMERIC,
      status TEXT NOT NULL DEFAULT 'not_started',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_dev_phases_deal_id ON deal_dev_phases(deal_id)`,
    `CREATE TABLE IF NOT EXISTS deal_predev_costs (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      vendor TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'estimated',
      incurred_date DATE,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_predev_costs_deal_id ON deal_predev_costs(deal_id)`,
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS predev_settings JSONB",
    // Dev phases: predecessor/successor scheduling
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS duration_days INTEGER",
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS predecessor_id TEXT",
    "ALTER TABLE deal_dev_phases ADD COLUMN IF NOT EXISTS lag_days INTEGER NOT NULL DEFAULT 0",
    // Communication tracking: stakeholder correspondence log
    `CREATE TABLE IF NOT EXISTS deal_communications (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      stakeholder_type TEXT NOT NULL DEFAULT 'broker',
      stakeholder_name TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'email',
      direction TEXT NOT NULL DEFAULT 'outbound',
      subject TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      follow_up_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_communications_deal_id ON deal_communications(deal_id)`,
    // Communication tracking: questions for brokers / others by phase
    `CREATE TABLE IF NOT EXISTS deal_questions (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      target_role TEXT NOT NULL DEFAULT 'broker',
      phase TEXT NOT NULL DEFAULT 'sourcing',
      question TEXT NOT NULL,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL DEFAULT 'manual',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_questions_deal_id ON deal_questions(deal_id)`,
    // Contacts (CRM): workspace-shared people directory
    `CREATE TABLE IF NOT EXISTS contacts (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_role ON contacts(role)`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_name_lower ON contacts(LOWER(name))`,
    // Contacts (CRM): join table linking contacts to deals
    `CREATE TABLE IF NOT EXISTS deal_contacts (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      role_on_deal TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(deal_id, contact_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_contacts_deal_id ON deal_contacts(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deal_contacts_contact_id ON deal_contacts(contact_id)`,
    // Communications: optional FK to contacts
    `ALTER TABLE deal_communications ADD COLUMN IF NOT EXISTS contact_id TEXT`,
    // Comps & submarket (ensure present on already-migrated DBs)
    `CREATE TABLE IF NOT EXISTS comps (
      id TEXT PRIMARY KEY,
      deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
      source_deal_id TEXT,
      comp_type TEXT NOT NULL CHECK (comp_type IN ('sale', 'rent')),
      name TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      property_type TEXT,
      year_built INTEGER,
      units INTEGER,
      total_sf NUMERIC,
      sale_price NUMERIC,
      sale_date DATE,
      cap_rate NUMERIC,
      noi NUMERIC,
      price_per_unit NUMERIC,
      price_per_sf NUMERIC,
      rent_per_unit NUMERIC,
      rent_per_sf NUMERIC,
      rent_per_bed NUMERIC,
      occupancy_pct NUMERIC,
      lease_type TEXT,
      distance_mi NUMERIC,
      lat NUMERIC,
      lng NUMERIC,
      selected BOOLEAN NOT NULL DEFAULT true,
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      source_note TEXT,
      extra JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_comps_deal_id ON comps(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comps_type ON comps(deal_id, comp_type)`,
    `CREATE INDEX IF NOT EXISTS idx_comps_source_deal_id ON comps(source_deal_id)`,
    // Migrate existing installs: drop the NOT NULL on deal_id and change the
    // FK from CASCADE to SET NULL so workspace-only comps can exist. Also
    // add the new source_deal_id and lat/lng columns. These DO blocks are
    // idempotent.
    `ALTER TABLE comps ADD COLUMN IF NOT EXISTS source_deal_id TEXT`,
    `ALTER TABLE comps ADD COLUMN IF NOT EXISTS lat NUMERIC`,
    `ALTER TABLE comps ADD COLUMN IF NOT EXISTS lng NUMERIC`,
    `ALTER TABLE comps ALTER COLUMN deal_id DROP NOT NULL`,
    `DO $$ BEGIN
       ALTER TABLE comps DROP CONSTRAINT IF EXISTS comps_deal_id_fkey;
       ALTER TABLE comps ADD CONSTRAINT comps_deal_id_fkey
         FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;
     EXCEPTION WHEN OTHERS THEN NULL; END $$`,
    `CREATE TABLE IF NOT EXISTS submarket_metrics (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
      submarket_name TEXT,
      msa TEXT,
      market_cap_rate NUMERIC,
      market_rent_growth NUMERIC,
      market_vacancy NUMERIC,
      absorption_units NUMERIC,
      deliveries_units NUMERIC,
      narrative TEXT,
      sources JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // ── Deal Room (guest-accessible document sharing) ──────────────────────
    `CREATE TABLE IF NOT EXISTS deal_rooms (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      nda_required BOOLEAN NOT NULL DEFAULT true,
      nda_text TEXT,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_rooms_deal_id ON deal_rooms(deal_id)`,
    `CREATE TABLE IF NOT EXISTS deal_room_documents (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(room_id, document_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_documents_room ON deal_room_documents(room_id)`,
    `CREATE TABLE IF NOT EXISTS deal_room_invites (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      nda_accepted_at TIMESTAMPTZ,
      nda_accepted_name TEXT,
      revoked_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_invites_room ON deal_room_invites(room_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_invites_token_hash ON deal_room_invites(token_hash)`,
    // Activity log survives invite deletion (no FK on invite_id) so we
    // keep the audit trail even after revocation + clean-up.
    `CREATE TABLE IF NOT EXISTS deal_room_activity (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
      invite_id TEXT,
      email TEXT,
      event TEXT NOT NULL,
      document_id TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_activity_room ON deal_room_activity(room_id, created_at DESC)`,
    // Deal Room Q&A threads
    `CREATE TABLE IF NOT EXISTS deal_room_threads (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
      invite_id TEXT,
      author_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      document_id TEXT,
      resolved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_threads_room ON deal_room_threads(room_id)`,
    `CREATE TABLE IF NOT EXISTS deal_room_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES deal_room_threads(id) ON DELETE CASCADE,
      author_email TEXT NOT NULL,
      author_role TEXT NOT NULL DEFAULT 'guest',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_messages_thread ON deal_room_messages(thread_id)`,
    // Site walks (migration-safe create for older deployments)
    `CREATE TABLE IF NOT EXISTS site_walks (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      walk_date DATE NOT NULL DEFAULT CURRENT_DATE,
      status TEXT NOT NULL DEFAULT 'draft',
      attendees JSONB NOT NULL DEFAULT '[]',
      property_contact TEXT,
      weather TEXT,
      summary TEXT,
      ai_report TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_site_walks_deal_id ON site_walks(deal_id)`,
    `CREATE TABLE IF NOT EXISTS site_walk_recordings (
      id TEXT PRIMARY KEY,
      site_walk_id TEXT NOT NULL REFERENCES site_walks(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL,
      media_type TEXT NOT NULL,
      duration_seconds INTEGER,
      transcript_raw TEXT,
      transcript_cleaned TEXT,
      processing_status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_recordings_walk_id ON site_walk_recordings(site_walk_id)`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_recordings_deal_id ON site_walk_recordings(deal_id)`,
    `CREATE TABLE IF NOT EXISTS site_walk_photos (
      id TEXT PRIMARY KEY,
      site_walk_id TEXT NOT NULL REFERENCES site_walks(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      area_tag TEXT NOT NULL DEFAULT 'general',
      unit_label TEXT,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      caption TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_photos_walk_id ON site_walk_photos(site_walk_id)`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_photos_deal_id ON site_walk_photos(deal_id)`,
    `CREATE TABLE IF NOT EXISTS site_walk_deficiencies (
      id TEXT PRIMARY KEY,
      site_walk_id TEXT NOT NULL REFERENCES site_walks(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      area_tag TEXT NOT NULL DEFAULT 'general',
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'minor',
      category TEXT NOT NULL DEFAULT 'other',
      estimated_cost NUMERIC,
      photo_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_deficiencies_walk_id ON site_walk_deficiencies(site_walk_id)`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_deficiencies_deal_id ON site_walk_deficiencies(deal_id)`,
    // ── Execution / Post-Closing ─────────────────────────────────────────────
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS execution_phase TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS execution_started_at TIMESTAMPTZ",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS hardcost_settings JSONB",
    // Hard Cost Budget Tracker (mirrors deal_predev_costs)
    `CREATE TABLE IF NOT EXISTS deal_hardcost_items (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      vendor TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'estimated',
      incurred_date DATE,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_hardcost_items_deal_id ON deal_hardcost_items(deal_id)`,
    // Draw Schedule
    `CREATE TABLE IF NOT EXISTS deal_draws (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      draw_number INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      submitted_date DATE,
      approved_date DATE,
      funded_date DATE,
      amount_requested NUMERIC NOT NULL DEFAULT 0,
      amount_approved NUMERIC,
      retainage_held NUMERIC NOT NULL DEFAULT 0,
      pct_complete_claimed INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_draws_deal_id ON deal_draws(deal_id)`,
    // Draw line items
    `CREATE TABLE IF NOT EXISTS deal_draw_items (
      id TEXT PRIMARY KEY,
      draw_id TEXT NOT NULL REFERENCES deal_draws(id) ON DELETE CASCADE,
      hardcost_item_id TEXT REFERENCES deal_hardcost_items(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      amount_requested NUMERIC NOT NULL DEFAULT 0,
      amount_approved NUMERIC,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_draw_items_draw_id ON deal_draw_items(draw_id)`,
    // Permit & Approval Tracker
    `CREATE TABLE IF NOT EXISTS deal_permits (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      permit_type TEXT NOT NULL,
      jurisdiction TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      submitted_date DATE,
      expected_date DATE,
      actual_date DATE,
      fee NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'not_submitted',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_permits_deal_id ON deal_permits(deal_id)`,
    // Vendor / Contractor Directory
    `CREATE TABLE IF NOT EXISTS deal_vendors (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Other',
      company TEXT,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'prospective',
      engagement_date DATE,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_vendors_deal_id ON deal_vendors(deal_id)`,
    // Progress Reports
    `CREATE TABLE IF NOT EXISTS progress_reports (
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
      weather_delays INTEGER,
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_progress_reports_deal_id ON progress_reports(deal_id)`,
    // Progress Report Photos
    `CREATE TABLE IF NOT EXISTS progress_report_photos (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES progress_reports(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT,
      original_name TEXT,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      caption TEXT,
      category TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_progress_report_photos_report_id ON progress_report_photos(report_id)`,
    // Progress Report Contractor Invites (magic-link tokens like deal rooms)
    `CREATE TABLE IF NOT EXISTS progress_report_invites (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      revoked_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_progress_report_invites_deal_id ON progress_report_invites(deal_id)`,
  ];

  // Run each statement individually so one failure doesn't block the rest
  for (const sql of alters) {
    try {
      await pool.query(sql);
    } catch (err) {
      // Tables might not exist yet (first boot) — that's fine, initSchema will handle it
      console.warn("ensureColumns warning:", (err as Error).message?.slice(0, 120));
    }
  }
}

// ─── Schema Init ──────────────────────────────────────────────────────────────

export async function initSchema(): Promise<void> {
  const pool = getPool();

  // Run each table creation separately so one failure doesn't prevent others
  const queries = [
    // Core tables
    `CREATE TABLE IF NOT EXISTS deals (
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
      business_plan_id TEXT,
      land_acres REAL,
      om_score INTEGER,
      om_extracted JSONB,
      proforma_outputs JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS documents (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_documents_deal_id ON documents(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category)`,
    `CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      caption TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_photos_deal_id ON photos(deal_id)`,
    `CREATE TABLE IF NOT EXISTS underwriting (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS loi (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}',
      executed BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS checklist_items (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      item TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      ai_filled BOOLEAN NOT NULL DEFAULT false,
      source_document_ids JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_checklist_deal_id ON checklist_items(deal_id)`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_deal_id ON chat_messages(deal_id)`,
    `CREATE TABLE IF NOT EXISTS om_analyses (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id          TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      document_id      TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      property_name    TEXT,
      address          TEXT,
      property_type    TEXT,
      year_built       INT,
      sf               INT,
      unit_count       INT,
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
      rent_growth      TEXT,
      hold_period      TEXT,
      leverage         TEXT,
      exit_cap_rate    TEXT,
      deal_score       INT,
      score_reasoning  TEXT,
      summary          TEXT,
      recommendations  JSONB,
      red_flags        JSONB,
      deal_context     TEXT,
      model_used       TEXT,
      tokens_used      INT,
      cost_estimate    NUMERIC,
      processing_ms    INT,
      error_message    TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE om_analyses ADD COLUMN IF NOT EXISTS deal_context TEXT`,
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS context_notes TEXT`,
    `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB`,
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS dropbox_folder_path TEXT`,
    `CREATE TABLE IF NOT EXISTS dropbox_accounts (
      id TEXT PRIMARY KEY DEFAULT 'default',
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      account_id TEXT,
      display_name TEXT,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_om_analyses_deal_id ON om_analyses(deal_id)`,
    `CREATE TABLE IF NOT EXISTS om_qa (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      analysis_id   TEXT NOT NULL,
      deal_id       TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      question      TEXT NOT NULL,
      answer        TEXT NOT NULL,
      model_used    TEXT,
      tokens_used   INT,
      cost_estimate NUMERIC,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_om_qa_analysis_id ON om_qa(analysis_id)`,
    `CREATE INDEX IF NOT EXISTS idx_om_qa_deal_id ON om_qa(deal_id)`,
    // Business plans table + extended columns
    `CREATE TABLE IF NOT EXISTS business_plans (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      description TEXT NOT NULL,
      is_default  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS investment_theses JSONB NOT NULL DEFAULT '[]'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_markets JSONB NOT NULL DEFAULT '[]'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS property_types JSONB NOT NULL DEFAULT '[]'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS hold_period_min INTEGER`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS hold_period_max INTEGER`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_irr_min NUMERIC`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_irr_max NUMERIC`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_equity_multiple_min NUMERIC`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS target_equity_multiple_max NUMERIC`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS owner_id TEXT`,
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS business_plan_id TEXT`,
    // Deal notes table (unified notes system)
    `CREATE TABLE IF NOT EXISTS deal_notes (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'context',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_notes_deal_id ON deal_notes(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deal_notes_category ON deal_notes(deal_id, category)`,
    // Multi-user: users table (synced from Clerk)
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Multi-user: deal sharing
    `CREATE TABLE IF NOT EXISTS deal_shares (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'edit' CHECK (permission IN ('view', 'edit')),
      shared_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(deal_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_shares_deal_id ON deal_shares(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deal_shares_user_id ON deal_shares(user_id)`,
    // Branding columns on business_plans
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_company_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_tagline TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_logo_url TEXT`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_logo_width INTEGER`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_primary_color TEXT NOT NULL DEFAULT '#4F46E5'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_secondary_color TEXT NOT NULL DEFAULT '#2F3B52'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_accent_color TEXT NOT NULL DEFAULT '#10B981'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_header_font TEXT NOT NULL DEFAULT 'Helvetica'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_body_font TEXT NOT NULL DEFAULT 'Calibri'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_footer_text TEXT NOT NULL DEFAULT 'CONFIDENTIAL'`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_website TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_email TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_phone TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_address TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_disclaimer_text TEXT NOT NULL DEFAULT ''`,
    // Project management tables
    `CREATE TABLE IF NOT EXISTS deal_milestones (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      stage TEXT,
      target_date DATE,
      completed_at TIMESTAMPTZ,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_milestones_deal_id ON deal_milestones(deal_id)`,
    `CREATE TABLE IF NOT EXISTS deal_tasks (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      assignee TEXT,
      due_date DATE,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'todo',
      milestone_id TEXT REFERENCES deal_milestones(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_tasks_deal_id ON deal_tasks(deal_id)`,
    // Admin: generic key/value app settings
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Admin: editable AI system prompts
    `CREATE TABLE IF NOT EXISTS ai_prompts (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      default_prompt TEXT NOT NULL,
      prompt TEXT NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Admin: editable deal pipeline stages
    `CREATE TABLE IF NOT EXISTS pipeline_stages (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      is_terminal BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Admin: editable diligence checklist template
    `CREATE TABLE IF NOT EXISTS checklist_template_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      item TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Admin: audit log of admin actions
    `CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)`,
    // Project management: development phases
    `CREATE TABLE IF NOT EXISTS deal_dev_phases (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      phase_key TEXT NOT NULL,
      label TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      pct_complete INTEGER NOT NULL DEFAULT 0,
      budget NUMERIC,
      status TEXT NOT NULL DEFAULT 'not_started',
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_dev_phases_deal_id ON deal_dev_phases(deal_id)`,
    // Project management: pre-development costs
    `CREATE TABLE IF NOT EXISTS deal_predev_costs (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      vendor TEXT,
      amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'estimated',
      incurred_date DATE,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_predev_costs_deal_id ON deal_predev_costs(deal_id)`,
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS predev_settings JSONB`,
    // Comps: unified sale + rent comp store (paste-mode first)
    `CREATE TABLE IF NOT EXISTS comps (
      id TEXT PRIMARY KEY,
      deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
      source_deal_id TEXT,
      comp_type TEXT NOT NULL CHECK (comp_type IN ('sale', 'rent')),
      name TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      property_type TEXT,
      year_built INTEGER,
      units INTEGER,
      total_sf NUMERIC,
      sale_price NUMERIC,
      sale_date DATE,
      cap_rate NUMERIC,
      noi NUMERIC,
      price_per_unit NUMERIC,
      price_per_sf NUMERIC,
      rent_per_unit NUMERIC,
      rent_per_sf NUMERIC,
      rent_per_bed NUMERIC,
      occupancy_pct NUMERIC,
      lease_type TEXT,
      distance_mi NUMERIC,
      lat NUMERIC,
      lng NUMERIC,
      selected BOOLEAN NOT NULL DEFAULT true,
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      source_note TEXT,
      extra JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_comps_deal_id ON comps(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comps_type ON comps(deal_id, comp_type)`,
    `CREATE INDEX IF NOT EXISTS idx_comps_source_deal_id ON comps(source_deal_id)`,
    // Migrate existing installs: drop the NOT NULL on deal_id and change the
    // FK from CASCADE to SET NULL so workspace-only comps can exist. Also
    // add the new source_deal_id and lat/lng columns. These DO blocks are
    // idempotent.
    `ALTER TABLE comps ADD COLUMN IF NOT EXISTS source_deal_id TEXT`,
    `ALTER TABLE comps ADD COLUMN IF NOT EXISTS lat NUMERIC`,
    `ALTER TABLE comps ADD COLUMN IF NOT EXISTS lng NUMERIC`,
    `ALTER TABLE comps ALTER COLUMN deal_id DROP NOT NULL`,
    `DO $$ BEGIN
       ALTER TABLE comps DROP CONSTRAINT IF EXISTS comps_deal_id_fkey;
       ALTER TABLE comps ADD CONSTRAINT comps_deal_id_fkey
         FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;
     EXCEPTION WHEN OTHERS THEN NULL; END $$`,
    // Submarket metrics: one row per deal
    `CREATE TABLE IF NOT EXISTS submarket_metrics (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
      submarket_name TEXT,
      msa TEXT,
      market_cap_rate NUMERIC,
      market_rent_growth NUMERIC,
      market_vacancy NUMERIC,
      absorption_units NUMERIC,
      deliveries_units NUMERIC,
      narrative TEXT,
      sources JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // ── Deal Room (guest-accessible document sharing) ──────────────────────
    `CREATE TABLE IF NOT EXISTS deal_rooms (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      nda_required BOOLEAN NOT NULL DEFAULT true,
      nda_text TEXT,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_rooms_deal_id ON deal_rooms(deal_id)`,
    `CREATE TABLE IF NOT EXISTS deal_room_documents (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(room_id, document_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_documents_room ON deal_room_documents(room_id)`,
    `CREATE TABLE IF NOT EXISTS deal_room_invites (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      nda_accepted_at TIMESTAMPTZ,
      nda_accepted_name TEXT,
      revoked_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_invites_room ON deal_room_invites(room_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_invites_token_hash ON deal_room_invites(token_hash)`,
    `CREATE TABLE IF NOT EXISTS deal_room_activity (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
      invite_id TEXT,
      email TEXT,
      event TEXT NOT NULL,
      document_id TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_activity_room ON deal_room_activity(room_id, created_at DESC)`,
    // Deal Room Q&A threads
    `CREATE TABLE IF NOT EXISTS deal_room_threads (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES deal_rooms(id) ON DELETE CASCADE,
      invite_id TEXT,
      author_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      document_id TEXT,
      resolved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_threads_room ON deal_room_threads(room_id)`,
    `CREATE TABLE IF NOT EXISTS deal_room_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES deal_room_threads(id) ON DELETE CASCADE,
      author_email TEXT NOT NULL,
      author_role TEXT NOT NULL DEFAULT 'guest',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_deal_room_messages_thread ON deal_room_messages(thread_id)`,
    // ── Site Walks ─────────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS site_walks (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      walk_date DATE NOT NULL DEFAULT CURRENT_DATE,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed')),
      attendees JSONB NOT NULL DEFAULT '[]',
      property_contact TEXT,
      weather TEXT,
      summary TEXT,
      ai_report TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_site_walks_deal_id ON site_walks(deal_id)`,
    `CREATE TABLE IF NOT EXISTS site_walk_recordings (
      id TEXT PRIMARY KEY,
      site_walk_id TEXT NOT NULL REFERENCES site_walks(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('audio','video')),
      duration_seconds INTEGER,
      transcript_raw TEXT,
      transcript_cleaned TEXT,
      processing_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (processing_status IN ('pending','uploading','transcribing','processing','completed','error')),
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_recordings_walk_id ON site_walk_recordings(site_walk_id)`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_recordings_deal_id ON site_walk_recordings(deal_id)`,
    `CREATE TABLE IF NOT EXISTS site_walk_photos (
      id TEXT PRIMARY KEY,
      site_walk_id TEXT NOT NULL REFERENCES site_walks(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      area_tag TEXT NOT NULL DEFAULT 'general',
      unit_label TEXT,
      name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
      caption TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_photos_walk_id ON site_walk_photos(site_walk_id)`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_photos_deal_id ON site_walk_photos(deal_id)`,
    `CREATE TABLE IF NOT EXISTS site_walk_deficiencies (
      id TEXT PRIMARY KEY,
      site_walk_id TEXT NOT NULL REFERENCES site_walks(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      area_tag TEXT NOT NULL DEFAULT 'general',
      description TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'minor'
        CHECK (severity IN ('minor','moderate','major','critical')),
      category TEXT NOT NULL DEFAULT 'other',
      estimated_cost NUMERIC,
      photo_id TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','in_progress','resolved','deferred')),
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_deficiencies_walk_id ON site_walk_deficiencies(site_walk_id)`,
    `CREATE INDEX IF NOT EXISTS idx_site_walk_deficiencies_deal_id ON site_walk_deficiencies(deal_id)`,
  ];

  for (const query of queries) {
    try {
      await pool.query(query);
    } catch (err) {
      console.error("Schema init warning:", (err as Error).message, "\nQuery:", query.slice(0, 120));
    }
  }

  // Ensure critical columns exist (belt-and-suspenders for production)
  const criticalAlters = [
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS business_plan_id TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS context_notes TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS dropbox_folder_path TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS investment_strategy TEXT",
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_key BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE photos ADD COLUMN IF NOT EXISTS is_cover BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS uw_score INTEGER",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS uw_score_reasoning TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS final_score INTEGER",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS final_score_reasoning TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS owner_id TEXT",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS land_acres REAL",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS lat NUMERIC",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS lng NUMERIC",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS auto_ingested BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS inbox_reviewed_at TIMESTAMPTZ",
    "ALTER TABLE deals ADD COLUMN IF NOT EXISTS ingested_from_path TEXT",
    "ALTER TABLE dropbox_accounts ADD COLUMN IF NOT EXISTS watched_folder_path TEXT",
    "ALTER TABLE dropbox_accounts ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ",
    // Backfill: ensure no row has null role/permissions (can happen if a
    // column was added nullable in a prior schema rev, then later constrained)
    "UPDATE users SET role = 'user' WHERE role IS NULL",
    "UPDATE users SET permissions = '[]'::jsonb WHERE permissions IS NULL",
  ];
  for (const alter of criticalAlters) {
    try {
      await pool.query(alter);
    } catch (err) {
      console.error("Critical ALTER failed:", (err as Error).message);
    }
  }
}

// ─── Deal queries ─────────────────────────────────────────────────────────────

export const dealQueries = {
  // Returns all deals visible to a user (owns OR shared with OR legacy null-owner)
  getAll: async (userId?: string) => {
    const pool = getPool();
    // Compute total_project_cost from underwriting JSONB for display on dashboard
    const totalCostExpr = `
      CASE
        WHEN u.data IS NOT NULL AND (u.data->>'development_mode')::boolean = true THEN
          COALESCE((u.data->>'land_cost')::numeric, 0)
          + COALESCE((u.data->>'hard_cost_per_sf')::numeric, 0) * COALESCE((u.data->>'max_gsf')::numeric, 0)
          + COALESCE((u.data->>'hard_cost_per_sf')::numeric, 0) * COALESCE((u.data->>'max_gsf')::numeric, 0) * COALESCE((u.data->>'soft_cost_pct')::numeric, 0) / 100
          + COALESCE((u.data->>'land_cost')::numeric, 0) * COALESCE((u.data->>'closing_costs_pct')::numeric, 0) / 100
        WHEN u.data IS NOT NULL THEN
          COALESCE((u.data->>'purchase_price')::numeric, 0)
          + COALESCE((u.data->>'purchase_price')::numeric, 0) * COALESCE((u.data->>'closing_costs_pct')::numeric, 0) / 100
        ELSE NULL
      END as total_project_cost`;
    if (!userId) {
      const res = await pool.query(`SELECT d.*, ${totalCostExpr} FROM deals d LEFT JOIN underwriting u ON u.deal_id = d.id ORDER BY d.starred DESC, d.updated_at DESC`);
      return res.rows;
    }
    const res = await pool.query(
      `SELECT DISTINCT d.*, ${totalCostExpr} FROM deals d
       LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
       LEFT JOIN underwriting u ON u.deal_id = d.id
       WHERE d.owner_id IS NULL OR d.owner_id = $1 OR ds.deal_id IS NOT NULL
       ORDER BY d.starred DESC, d.updated_at DESC`,
      [userId]
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM deals WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  // Access-checked variant: returns deal only if user is owner, has a share, or deal has no owner (legacy)
  getByIdWithAccess: async (id: string, userId: string) => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT DISTINCT d.* FROM deals d
       LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $2
       WHERE d.id = $1
         AND (d.owner_id IS NULL OR d.owner_id = $2 OR ds.deal_id IS NOT NULL)`,
      [id, userId]
    );
    return res.rows[0] ?? null;
  },

  create: async (deal: Record<string, unknown>) => {
    const pool = getPool();

    // Ensure optional columns exist (self-healing migration)
    await ensureColumns();

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
    if (deal.investment_strategy) {
      cols.push("investment_strategy");
      vals.push(deal.investment_strategy);
    }
    if (deal.land_acres != null) {
      cols.push("land_acres");
      vals.push(deal.land_acres);
    }
    if (deal.business_plan_id) {
      cols.push("business_plan_id");
      vals.push(deal.business_plan_id);
    }
    if (deal.owner_id) {
      cols.push("owner_id");
      vals.push(deal.owner_id);
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(",");
    await pool.query(
      `INSERT INTO deals (${cols.join(", ")}) VALUES (${placeholders})`,
      vals
    );
    return dealQueries.getById(deal.id as string);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    await ensureColumns();
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

  // ── Inbox / AI Deal Sourcing helpers ─────────────────────────────────────

  /** Returns true if any deal was already ingested from the given Dropbox path. */
  ingestedPathExists: async (path: string): Promise<boolean> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT 1 FROM deals WHERE ingested_from_path = $1 LIMIT 1",
      [path]
    );
    return res.rowCount != null && res.rowCount > 0;
  },

  /**
   * Returns auto-ingested deals that haven't been marked reviewed yet,
   * newest first. Used by the /inbox page.
   */
  getPendingInboxItems: async (limit = 50) => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT d.*, u.data AS underwriting_data
       FROM deals d
       LEFT JOIN underwriting u ON u.deal_id = d.id
       WHERE d.auto_ingested = true
         AND d.inbox_reviewed_at IS NULL
       ORDER BY d.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  },

  /** Count of unreviewed inbox items (for the left-rail badge). */
  countPendingInbox: async (): Promise<number> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT COUNT(*)::int AS c FROM deals WHERE auto_ingested = true AND inbox_reviewed_at IS NULL"
    );
    return Number(res.rows[0]?.c ?? 0);
  },

  markInboxReviewed: async (id: string): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE deals SET inbox_reviewed_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
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

// ─── Deal Notes queries ──────────────────────────────────────────────────────

// Categories where notes are included in AI memory
const MEMORY_CATEGORIES = ["context", "thesis", "risk", "site_walk"];

export const dealNoteQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_notes WHERE deal_id = $1 ORDER BY created_at DESC",
      [dealId]
    );
    return res.rows;
  },

  create: async (note: { id: string; deal_id: string; text: string; category: string; source?: string }) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO deal_notes (id, deal_id, text, category, source, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [note.id, note.deal_id, note.text, note.category, note.source ?? "manual"]
    );
    // Also sync to legacy context_notes if it's a memory category
    if (MEMORY_CATEGORIES.includes(note.category)) {
      await dealQueries.appendContextNote(note.deal_id, note.text);
    }
    return dealNoteQueries.getById(note.id);
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM deal_notes WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    const note = await dealNoteQueries.getById(id);
    await pool.query("DELETE FROM deal_notes WHERE id = $1", [id]);
    // Rebuild context_notes from remaining memory notes
    if (note && MEMORY_CATEGORIES.includes(note.category)) {
      await dealNoteQueries.rebuildContextNotes(note.deal_id);
    }
    return note;
  },

  /** Get concatenated text of all memory-included notes for AI consumption */
  getMemoryText: async (dealId: string): Promise<string> => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT text, category FROM deal_notes
       WHERE deal_id = $1 AND category = ANY($2)
       ORDER BY created_at ASC`,
      [dealId, MEMORY_CATEGORIES]
    );
    return res.rows.map((r: { text: string }) => r.text).join("\n\n");
  },

  /** Rebuild the legacy context_notes column from deal_notes */
  rebuildContextNotes: async (dealId: string): Promise<void> => {
    const memoryText = await dealNoteQueries.getMemoryText(dealId);
    const pool = getPool();
    await pool.query(
      `UPDATE deals SET context_notes = $1, updated_at = NOW() WHERE id = $2`,
      [memoryText || null, dealId]
    );
  },
};

// ─── Site Walk queries ───────────────────────────────────────────────────────

function parseSiteWalkRow(row: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  if (!row) return null;
  const attendees = row.attendees;
  let parsed: unknown[] = [];
  if (Array.isArray(attendees)) {
    parsed = attendees;
  } else if (typeof attendees === "string") {
    try {
      const p = JSON.parse(attendees);
      if (Array.isArray(p)) parsed = p;
    } catch {
      parsed = [];
    }
  }
  return { ...row, attendees: parsed };
}

export const siteWalkQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM site_walks WHERE deal_id = $1 ORDER BY walk_date DESC, created_at DESC",
      [dealId]
    );
    return res.rows.map(parseSiteWalkRow);
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM site_walks WHERE id = $1", [id]);
    return parseSiteWalkRow(res.rows[0]);
  },

  create: async (walk: {
    id: string;
    deal_id: string;
    title?: string;
    walk_date?: string;
    status?: string;
    attendees?: string[];
    property_contact?: string | null;
    weather?: string | null;
    summary?: string | null;
    created_by?: string | null;
  }) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO site_walks
        (id, deal_id, title, walk_date, status, attendees, property_contact, weather, summary, created_by)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6::jsonb, $7, $8, $9, $10)`,
      [
        walk.id,
        walk.deal_id,
        walk.title ?? "",
        walk.walk_date ?? null,
        walk.status ?? "draft",
        JSON.stringify(walk.attendees ?? []),
        walk.property_contact ?? null,
        walk.weather ?? null,
        walk.summary ?? null,
        walk.created_by ?? null,
      ]
    );
    return siteWalkQueries.getById(walk.id);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const keys = Object.keys(updates).filter((k) =>
      ["title", "walk_date", "status", "attendees", "property_contact", "weather", "summary", "ai_report"].includes(k)
    );
    if (keys.length === 0) return siteWalkQueries.getById(id);
    const setClauses = keys.map((k, i) => {
      if (k === "attendees") return `"${k}" = $${i + 1}::jsonb`;
      return `"${k}" = $${i + 1}`;
    }).join(", ");
    const values = keys.map((k) => {
      const v = updates[k];
      if (k === "attendees") return JSON.stringify(v ?? []);
      return v;
    });
    await pool.query(
      `UPDATE site_walks SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length + 1}`,
      [...values, id]
    );
    return siteWalkQueries.getById(id);
  },

  delete: async (id: string) => {
    const pool = getPool();
    const existing = await siteWalkQueries.getById(id);
    await pool.query("DELETE FROM site_walks WHERE id = $1", [id]);
    return existing;
  },
};

export const siteWalkRecordingQueries = {
  getByWalkId: async (walkId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM site_walk_recordings WHERE site_walk_id = $1 ORDER BY created_at ASC",
      [walkId]
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM site_walk_recordings WHERE id = $1",
      [id]
    );
    return res.rows[0] ?? null;
  },

  create: async (rec: {
    id: string;
    site_walk_id: string;
    deal_id: string;
    file_path: string;
    original_name: string;
    file_size: number;
    mime_type: string;
    media_type: string;
    processing_status?: string;
  }) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO site_walk_recordings
        (id, site_walk_id, deal_id, file_path, original_name, file_size, mime_type, media_type, processing_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        rec.id,
        rec.site_walk_id,
        rec.deal_id,
        rec.file_path,
        rec.original_name,
        rec.file_size,
        rec.mime_type,
        rec.media_type,
        rec.processing_status ?? "pending",
      ]
    );
    return siteWalkRecordingQueries.getById(rec.id);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const allowed = [
      "processing_status",
      "error_message",
      "transcript_raw",
      "transcript_cleaned",
      "duration_seconds",
    ];
    const keys = Object.keys(updates).filter((k) => allowed.includes(k));
    if (keys.length === 0) return siteWalkRecordingQueries.getById(id);
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]);
    await pool.query(
      `UPDATE site_walk_recordings SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length + 1}`,
      [...values, id]
    );
    return siteWalkRecordingQueries.getById(id);
  },

  delete: async (id: string) => {
    const pool = getPool();
    const existing = await siteWalkRecordingQueries.getById(id);
    await pool.query("DELETE FROM site_walk_recordings WHERE id = $1", [id]);
    return existing;
  },
};

export const siteWalkPhotoQueries = {
  getByWalkId: async (walkId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM site_walk_photos WHERE site_walk_id = $1 ORDER BY area_tag ASC, sort_order ASC, created_at ASC",
      [walkId]
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM site_walk_photos WHERE id = $1",
      [id]
    );
    return res.rows[0] ?? null;
  },

  create: async (photo: {
    id: string;
    site_walk_id: string;
    deal_id: string;
    area_tag: string;
    unit_label?: string | null;
    name: string;
    original_name: string;
    file_path: string;
    file_size: number;
    mime_type: string;
    caption?: string | null;
  }) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO site_walk_photos
        (id, site_walk_id, deal_id, area_tag, unit_label, name, original_name, file_path, file_size, mime_type, caption)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        photo.id,
        photo.site_walk_id,
        photo.deal_id,
        photo.area_tag,
        photo.unit_label ?? null,
        photo.name,
        photo.original_name,
        photo.file_path,
        photo.file_size,
        photo.mime_type,
        photo.caption ?? null,
      ]
    );
    return siteWalkPhotoQueries.getById(photo.id);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const allowed = ["area_tag", "unit_label", "caption", "sort_order"];
    const keys = Object.keys(updates).filter((k) => allowed.includes(k));
    if (keys.length === 0) return siteWalkPhotoQueries.getById(id);
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]);
    await pool.query(
      `UPDATE site_walk_photos SET ${setClauses} WHERE id = $${values.length + 1}`,
      [...values, id]
    );
    return siteWalkPhotoQueries.getById(id);
  },

  delete: async (id: string) => {
    const pool = getPool();
    const existing = await siteWalkPhotoQueries.getById(id);
    await pool.query("DELETE FROM site_walk_photos WHERE id = $1", [id]);
    return existing;
  },
};

export const siteWalkDeficiencyQueries = {
  getByWalkId: async (walkId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM site_walk_deficiencies WHERE site_walk_id = $1 ORDER BY severity DESC, created_at ASC",
      [walkId]
    );
    return res.rows;
  },

  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM site_walk_deficiencies WHERE deal_id = $1 ORDER BY created_at DESC",
      [dealId]
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM site_walk_deficiencies WHERE id = $1",
      [id]
    );
    return res.rows[0] ?? null;
  },

  create: async (def: {
    id: string;
    site_walk_id: string;
    deal_id: string;
    area_tag?: string;
    description: string;
    severity?: string;
    category?: string;
    estimated_cost?: number | null;
    photo_id?: string | null;
    status?: string;
    notes?: string | null;
  }) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO site_walk_deficiencies
        (id, site_walk_id, deal_id, area_tag, description, severity, category, estimated_cost, photo_id, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        def.id,
        def.site_walk_id,
        def.deal_id,
        def.area_tag ?? "general",
        def.description,
        def.severity ?? "minor",
        def.category ?? "other",
        def.estimated_cost ?? null,
        def.photo_id ?? null,
        def.status ?? "open",
        def.notes ?? null,
      ]
    );
    return siteWalkDeficiencyQueries.getById(def.id);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const allowed = [
      "area_tag",
      "description",
      "severity",
      "category",
      "estimated_cost",
      "photo_id",
      "status",
      "notes",
      "sort_order",
    ];
    const keys = Object.keys(updates).filter((k) => allowed.includes(k));
    if (keys.length === 0) return siteWalkDeficiencyQueries.getById(id);
    const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]);
    await pool.query(
      `UPDATE site_walk_deficiencies SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length + 1}`,
      [...values, id]
    );
    return siteWalkDeficiencyQueries.getById(id);
  },

  delete: async (id: string) => {
    const pool = getPool();
    const existing = await siteWalkDeficiencyQueries.getById(id);
    await pool.query("DELETE FROM site_walk_deficiencies WHERE id = $1", [id]);
    return existing;
  },
};

// ─── Document queries ─────────────────────────────────────────────────────────

export const documentQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM documents WHERE deal_id = $1 ORDER BY is_key DESC, category, uploaded_at DESC",
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
         file_size, mime_type, content_text, ai_summary, ai_tags,
         parent_document_id, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
        doc.parent_document_id ?? null,
        (doc.version as number | undefined) ?? 1,
      ]
    );
    return documentQueries.getById(doc.id as string);
  },

  /**
   * Return the full version chain for a document, ordered oldest → newest.
   * Starts from any node in the chain and walks both directions.
   */
  getVersionChain: async (docId: string): Promise<Record<string, unknown>[]> => {
    const pool = getPool();
    // Recursive CTE walks down to descendants; a second query walks up to
    // ancestors. Simpler to just find the root then query all with that root.
    const start = await pool.query(
      "SELECT id, deal_id, category FROM documents WHERE id = $1",
      [docId]
    );
    if (start.rows.length === 0) return [];
    const seed = start.rows[0];

    // Find root by walking ancestors via a recursive CTE
    const rootRes = await pool.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_document_id FROM documents WHERE id = $1
         UNION ALL
         SELECT d.id, d.parent_document_id
         FROM documents d
         JOIN ancestors a ON d.id = a.parent_document_id
       )
       SELECT id FROM ancestors WHERE parent_document_id IS NULL LIMIT 1`,
      [docId]
    );
    const rootId = rootRes.rows[0]?.id ?? seed.id;

    // All descendants of the root
    const chainRes = await pool.query(
      `WITH RECURSIVE chain AS (
         SELECT * FROM documents WHERE id = $1
         UNION ALL
         SELECT d.* FROM documents d
         JOIN chain c ON d.parent_document_id = c.id
       )
       SELECT * FROM chain ORDER BY version ASC, uploaded_at ASC`,
      [rootId]
    );
    return chainRes.rows;
  },

  /**
   * Given a new document's category + original filename, find the most
   * recent document in the same deal that looks like a prior version of
   * the same file. Used by the upload pipeline to auto-chain versions.
   * Returns null if nothing plausible matches.
   */
  findLikelyPrevVersion: async (
    dealId: string,
    category: string,
    originalName: string
  ): Promise<Record<string, unknown> | null> => {
    const pool = getPool();
    // Normalize the filename for comparison: lowercase, strip extension,
    // strip common version suffixes and dates.
    const normalize = (s: string): string =>
      s
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/, "") // strip extension
        .replace(/[_\-\s](v|version|rev)\s*\d+/gi, "") // v2, _rev3
        .replace(/\b(final|latest|updated|new|draft)\b/gi, "")
        .replace(/\b\d{4}[-._]\d{1,2}[-._]\d{1,2}\b/g, "") // 2024-04-01
        .replace(/\b\d{1,2}[-._]\d{1,2}[-._]\d{2,4}\b/g, "") // 4-1-24
        .replace(/[^a-z0-9]/g, "")
        .trim();

    const target = normalize(originalName);
    if (!target || target.length < 3) return null;

    // Pull recent docs of the same category, filter client-side for
    // similarity. Cheap — typical deal has < 100 docs per category.
    const res = await pool.query(
      `SELECT * FROM documents
       WHERE deal_id = $1 AND category = $2
       ORDER BY uploaded_at DESC
       LIMIT 50`,
      [dealId, category]
    );

    for (const row of res.rows) {
      const candidate = normalize(row.original_name);
      if (candidate === target && candidate.length >= 3) return row;
    }
    return null;
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
      "SELECT * FROM photos WHERE deal_id = $1 ORDER BY is_cover DESC, uploaded_at ASC",
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

  setCover: async (dealId: string, photoId: string) => {
    const pool = getPool();
    // Only one photo per deal can be the cover
    await pool.query(
      `UPDATE photos SET is_cover = (id = $2) WHERE deal_id = $1`,
      [dealId, photoId]
    );
    return photoQueries.getById(photoId);
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

// ─── Comps queries ────────────────────────────────────────────────────────────

const COMP_COLUMNS = [
  "name",
  "address",
  "city",
  "state",
  "property_type",
  "year_built",
  "units",
  "total_sf",
  "sale_price",
  "sale_date",
  "cap_rate",
  "noi",
  "price_per_unit",
  "price_per_sf",
  "rent_per_unit",
  "rent_per_sf",
  "rent_per_bed",
  "occupancy_pct",
  "lease_type",
  "distance_mi",
  "lat",
  "lng",
  "selected",
  "source",
  "source_url",
  "source_note",
] as const;

export const compQueries = {
  getByDealId: async (dealId: string, compType?: "sale" | "rent") => {
    const pool = getPool();
    const res = compType
      ? await pool.query(
          "SELECT * FROM comps WHERE deal_id = $1 AND comp_type = $2 ORDER BY created_at DESC",
          [dealId, compType]
        )
      : await pool.query(
          "SELECT * FROM comps WHERE deal_id = $1 ORDER BY comp_type, created_at DESC",
          [dealId]
        );
    return res.rows;
  },

  /**
   * Workspace-wide comp query: all comps across deals the user can access,
   * PLUS all orphan workspace-level comps (deal_id IS NULL). Joins in the
   * source deal name for display + provenance.
   *
   * Filters are additive: omitting a param means "don't filter on that field".
   */
  getWorkspace: async (
    userId: string,
    filters: {
      compType?: "sale" | "rent";
      propertyType?: string;
      search?: string;   // matches name / address / city / state / source_note
      limit?: number;
    } = {}
  ) => {
    const pool = getPool();
    const conditions: string[] = [];
    const values: unknown[] = [userId];
    let i = 2;

    // Either the comp is attached to a deal the user can see, OR it's a
    // workspace-level comp (no deal) whose source_deal_id (if any) is also
    // one the user can see, OR it's a pure workspace comp with no source.
    conditions.push(`(
      c.deal_id IS NULL
      OR c.deal_id IN (
        SELECT DISTINCT d.id FROM deals d
        LEFT JOIN deal_shares ds ON d.id = ds.deal_id AND ds.user_id = $1
        WHERE d.owner_id IS NULL OR d.owner_id = $1 OR ds.deal_id IS NOT NULL
      )
    )`);

    if (filters.compType) {
      conditions.push(`c.comp_type = $${i++}`);
      values.push(filters.compType);
    }
    if (filters.propertyType) {
      conditions.push(`c.property_type = $${i++}`);
      values.push(filters.propertyType);
    }
    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim().toLowerCase()}%`;
      conditions.push(
        `(LOWER(c.name) LIKE $${i} OR LOWER(c.address) LIKE $${i} OR LOWER(c.city) LIKE $${i} OR LOWER(c.state) LIKE $${i} OR LOWER(c.source_note) LIKE $${i})`
      );
      values.push(q);
      i++;
    }
    const limit = Math.max(1, Math.min(500, filters.limit ?? 200));

    const sql = `
      SELECT c.*,
             d_attached.name  AS attached_deal_name,
             d_source.name    AS source_deal_name,
             d_source.status  AS source_deal_status
      FROM comps c
      LEFT JOIN deals d_attached ON d_attached.id = c.deal_id
      LEFT JOIN deals d_source   ON d_source.id   = c.source_deal_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT ${limit}
    `;
    const res = await pool.query(sql, values);
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM comps WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  create: async (comp: Record<string, unknown>) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO comps (
         id, deal_id, source_deal_id, comp_type,
         name, address, city, state, property_type, year_built,
         units, total_sf,
         sale_price, sale_date, cap_rate, noi, price_per_unit, price_per_sf,
         rent_per_unit, rent_per_sf, rent_per_bed, occupancy_pct, lease_type,
         distance_mi, selected, source, source_url, source_note, extra,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9, $10,
         $11, $12,
         $13, $14, $15, $16, $17, $18,
         $19, $20, $21, $22, $23,
         $24, $25, $26, $27, $28, $29::jsonb,
         NOW(), NOW()
       )`,
      [
        comp.id,
        comp.deal_id ?? null,
        comp.source_deal_id ?? null,
        comp.comp_type,
        comp.name ?? null,
        comp.address ?? null,
        comp.city ?? null,
        comp.state ?? null,
        comp.property_type ?? null,
        comp.year_built ?? null,
        comp.units ?? null,
        comp.total_sf ?? null,
        comp.sale_price ?? null,
        comp.sale_date ?? null,
        comp.cap_rate ?? null,
        comp.noi ?? null,
        comp.price_per_unit ?? null,
        comp.price_per_sf ?? null,
        comp.rent_per_unit ?? null,
        comp.rent_per_sf ?? null,
        comp.rent_per_bed ?? null,
        comp.occupancy_pct ?? null,
        comp.lease_type ?? null,
        comp.distance_mi ?? null,
        comp.selected ?? true,
        comp.source ?? "manual",
        comp.source_url ?? null,
        comp.source_note ?? null,
        JSON.stringify(comp.extra ?? {}),
      ]
    );
    return compQueries.getById(comp.id as string);
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const keys = Object.keys(updates).filter((k) =>
      (COMP_COLUMNS as readonly string[]).includes(k)
    );
    if (keys.length === 0 && !("extra" in updates)) {
      return compQueries.getById(id);
    }
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const k of keys) {
      setClauses.push(`"${k}" = $${i++}`);
      values.push(updates[k]);
    }
    if ("extra" in updates) {
      setClauses.push(`extra = $${i++}::jsonb`);
      values.push(JSON.stringify(updates.extra ?? {}));
    }
    setClauses.push("updated_at = NOW()");
    values.push(id);
    await pool.query(
      `UPDATE comps SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
      values
    );
    return compQueries.getById(id);
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM comps WHERE id = $1", [id]);
  },

  setSelected: async (id: string, selected: boolean) => {
    const pool = getPool();
    await pool.query(
      "UPDATE comps SET selected = $1, updated_at = NOW() WHERE id = $2",
      [selected, id]
    );
  },
};

// ─── Submarket metrics queries ───────────────────────────────────────────────

export const submarketMetricsQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM submarket_metrics WHERE deal_id = $1",
      [dealId]
    );
    return res.rows[0] ?? null;
  },

  upsert: async (dealId: string, id: string, data: Record<string, unknown>) => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO submarket_metrics (
         id, deal_id, submarket_name, msa,
         market_cap_rate, market_rent_growth, market_vacancy,
         absorption_units, deliveries_units,
         narrative, sources, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
       ON CONFLICT (deal_id) DO UPDATE SET
         submarket_name = EXCLUDED.submarket_name,
         msa = EXCLUDED.msa,
         market_cap_rate = EXCLUDED.market_cap_rate,
         market_rent_growth = EXCLUDED.market_rent_growth,
         market_vacancy = EXCLUDED.market_vacancy,
         absorption_units = EXCLUDED.absorption_units,
         deliveries_units = EXCLUDED.deliveries_units,
         narrative = EXCLUDED.narrative,
         sources = EXCLUDED.sources,
         updated_at = NOW()`,
      [
        id,
        dealId,
        data.submarket_name ?? null,
        data.msa ?? null,
        data.market_cap_rate ?? null,
        data.market_rent_growth ?? null,
        data.market_vacancy ?? null,
        data.absorption_units ?? null,
        data.deliveries_units ?? null,
        data.narrative ?? null,
        JSON.stringify(data.sources ?? []),
      ]
    );
    return submarketMetricsQueries.getByDealId(dealId);
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

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM checklist_items WHERE id = $1", [id]);
    return res.rows[0] ?? null;
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
  owner_id: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export const businessPlanQueries = {
  getAll: async (userId?: string): Promise<BusinessPlanRow[]> => {
    const pool = getPool();
    if (!userId) {
      const res = await pool.query(
        "SELECT * FROM business_plans ORDER BY is_default DESC, name ASC"
      );
      return res.rows;
    }
    const res = await pool.query(
      "SELECT * FROM business_plans WHERE owner_id IS NULL OR owner_id = $1 ORDER BY is_default DESC, name ASC",
      [userId]
    );
    return res.rows;
  },

  getById: async (id: string): Promise<BusinessPlanRow | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM business_plans WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  getByIdWithAccess: async (id: string, userId: string): Promise<BusinessPlanRow | null> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM business_plans WHERE id = $1 AND (owner_id IS NULL OR owner_id = $2)",
      [id, userId]
    );
    return res.rows[0] ?? null;
  },

  getDefault: async (userId?: string): Promise<BusinessPlanRow | null> => {
    const pool = getPool();
    if (!userId) {
      const res = await pool.query(
        "SELECT * FROM business_plans WHERE is_default = true LIMIT 1"
      );
      return res.rows[0] ?? null;
    }
    const res = await pool.query(
      "SELECT * FROM business_plans WHERE is_default = true AND (owner_id IS NULL OR owner_id = $1) LIMIT 1",
      [userId]
    );
    return res.rows[0] ?? null;
  },

  create: async (plan: {
    name: string;
    description: string;
    is_default?: boolean;
    owner_id?: string;
    investment_theses?: string[];
    target_markets?: string[];
    property_types?: string[];
    hold_period_min?: number | null;
    hold_period_max?: number | null;
    target_irr_min?: number | null;
    target_irr_max?: number | null;
    target_equity_multiple_min?: number | null;
    target_equity_multiple_max?: number | null;
    branding_company_name?: string;
    branding_tagline?: string;
    branding_logo_url?: string | null;
    branding_logo_width?: number | null;
    branding_primary_color?: string;
    branding_secondary_color?: string;
    branding_accent_color?: string;
    branding_header_font?: string;
    branding_body_font?: string;
    branding_footer_text?: string;
    branding_website?: string;
    branding_email?: string;
    branding_phone?: string;
    branding_address?: string;
    branding_disclaimer_text?: string;
  }): Promise<BusinessPlanRow> => {
    const pool = getPool();
    const insertQuery = `INSERT INTO business_plans (name, description, is_default, owner_id, investment_theses, target_markets, property_types,
        hold_period_min, hold_period_max, target_irr_min, target_irr_max, target_equity_multiple_min, target_equity_multiple_max,
        branding_company_name, branding_tagline, branding_logo_url, branding_logo_width,
        branding_primary_color, branding_secondary_color, branding_accent_color,
        branding_header_font, branding_body_font, branding_footer_text,
        branding_website, branding_email, branding_phone, branding_address, branding_disclaimer_text)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
       RETURNING *`;
    const insertParams = [
      plan.name,
      plan.description,
      plan.is_default ?? false,
      plan.owner_id ?? null,
      JSON.stringify(plan.investment_theses ?? []),
      JSON.stringify(plan.target_markets ?? []),
      JSON.stringify(plan.property_types ?? []),
      plan.hold_period_min ?? null,
      plan.hold_period_max ?? null,
      plan.target_irr_min ?? null,
      plan.target_irr_max ?? null,
      plan.target_equity_multiple_min ?? null,
      plan.target_equity_multiple_max ?? null,
      plan.branding_company_name ?? "",
      plan.branding_tagline ?? "",
      plan.branding_logo_url ?? null,
      plan.branding_logo_width ?? null,
      plan.branding_primary_color ?? "#4F46E5",
      plan.branding_secondary_color ?? "#2F3B52",
      plan.branding_accent_color ?? "#10B981",
      plan.branding_header_font ?? "Helvetica",
      plan.branding_body_font ?? "Calibri",
      plan.branding_footer_text ?? "CONFIDENTIAL",
      plan.branding_website ?? "",
      plan.branding_email ?? "",
      plan.branding_phone ?? "",
      plan.branding_address ?? "",
      plan.branding_disclaimer_text ?? "",
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
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS owner_id TEXT;
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_company_name TEXT NOT NULL DEFAULT '';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_tagline TEXT NOT NULL DEFAULT '';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_logo_url TEXT;
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_logo_width INTEGER;
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_primary_color TEXT NOT NULL DEFAULT '#4F46E5';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_secondary_color TEXT NOT NULL DEFAULT '#2F3B52';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_accent_color TEXT NOT NULL DEFAULT '#10B981';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_header_font TEXT NOT NULL DEFAULT 'Helvetica';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_body_font TEXT NOT NULL DEFAULT 'Calibri';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_footer_text TEXT NOT NULL DEFAULT 'CONFIDENTIAL';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_website TEXT NOT NULL DEFAULT '';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_email TEXT NOT NULL DEFAULT '';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_phone TEXT NOT NULL DEFAULT '';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_address TEXT NOT NULL DEFAULT '';
          ALTER TABLE business_plans ADD COLUMN IF NOT EXISTS branding_disclaimer_text TEXT NOT NULL DEFAULT '';
        `);
        const res = await pool.query(insertQuery, insertParams);
        return res.rows[0];
      }
      throw err;
    }
  },

  update: async (id: string, updates: Record<string, unknown>): Promise<BusinessPlanRow | null> => {
    await ensureColumns();
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

  setDefault: async (id: string, userId?: string): Promise<void> => {
    const pool = getPool();
    // Clear all defaults for this user first, then set the target
    if (userId) {
      await pool.query("UPDATE business_plans SET is_default = false, updated_at = NOW() WHERE is_default = true AND (owner_id IS NULL OR owner_id = $1)", [userId]);
    } else {
      await pool.query("UPDATE business_plans SET is_default = false, updated_at = NOW() WHERE is_default = true");
    }
    await pool.query("UPDATE business_plans SET is_default = true, updated_at = NOW() WHERE id = $1", [id]);
  },

  delete: async (id: string): Promise<void> => {
    const pool = getPool();
    await pool.query("DELETE FROM business_plans WHERE id = $1", [id]);
  },
};

// ─── Branding helper (fetch from deal's business plan) ───────────────────────

export async function getBrandingForDeal(dealId: string): Promise<Record<string, unknown> | null> {
  await ensureColumns();
  const pool = getPool();
  const res = await pool.query(
    `SELECT bp.* FROM business_plans bp
     JOIN deals d ON d.business_plan_id = bp.id::text
     WHERE d.id = $1`,
    [dealId]
  );
  const row = res.rows[0];
  if (!row) return null;
  // Normalize branding_ prefix fields into a flat object for document generators
  return {
    company_name: row.branding_company_name || "",
    tagline: row.branding_tagline || "",
    logo_url: row.branding_logo_url || null,
    logo_width: row.branding_logo_width || null,
    primary_color: row.branding_primary_color || "#4F46E5",
    secondary_color: row.branding_secondary_color || "#2F3B52",
    accent_color: row.branding_accent_color || "#10B981",
    header_font: row.branding_header_font || "Helvetica",
    body_font: row.branding_body_font || "Calibri",
    footer_text: row.branding_footer_text || "CONFIDENTIAL",
    website: row.branding_website || "",
    email: row.branding_email || "",
    phone: row.branding_phone || "",
    address: row.branding_address || "",
    disclaimer_text: row.branding_disclaimer_text || "",
  };
}

// ─── Dropbox queries ──────────────────────────────────────────────────────────

export interface DropboxAccount {
  id: string;
  access_token: string;
  refresh_token: string | null;
  account_id: string | null;
  display_name: string | null;
  email: string | null;
  watched_folder_path: string | null;
  last_polled_at: string | null;
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

  // Inbox-specific helpers
  setWatchedFolder: async (folderPath: string | null): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE dropbox_accounts SET watched_folder_path = $1, updated_at = NOW() WHERE id = 'default'",
      [folderPath]
    );
  },

  touchLastPolledAt: async (): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE dropbox_accounts SET last_polled_at = NOW(), updated_at = NOW() WHERE id = 'default'"
    );
  },
};

// ─── User queries ─────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: "user" | "admin";
  permissions: string[];
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export const ALL_PERMISSIONS = [
  "deals.create",
  "deals.delete",
  "deals.share",
  "business_plans.access",
  "contacts.access",
  "documents.upload",
  "ai.chat",
] as const;
export type Permission = typeof ALL_PERMISSIONS[number];

export const userQueries = {
  // Upsert a user from Clerk (called on every authenticated request for new users)
  upsert: async (user: { id: string; email: string; name?: string }): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO users (id, email, name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET email = $2, name = COALESCE($3, users.name), updated_at = NOW()`,
      [user.id, user.email, user.name ?? null]
    );
  },

  getById: async (id: string): Promise<UserRow | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  getByEmail: async (email: string): Promise<UserRow | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [email]);
    return res.rows[0] ?? null;
  },

  listAll: async (): Promise<UserRow[]> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM users ORDER BY created_at DESC");
    return res.rows;
  },

  setRole: async (id: string, role: "user" | "admin"): Promise<void> => {
    const pool = getPool();
    await pool.query("UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1", [id, role]);
  },

  setPermissions: async (id: string, permissions: string[]): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE users SET permissions = $2::jsonb, updated_at = NOW() WHERE id = $1",
      [id, JSON.stringify(permissions)]
    );
  },

  setDisabled: async (id: string, disabled: boolean): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `UPDATE users SET disabled_at = ${disabled ? "NOW()" : "NULL"}, updated_at = NOW() WHERE id = $1`,
      [id]
    );
  },

  search: async (query: string, excludeUserId: string): Promise<UserRow[]> => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM users
       WHERE id != $2 AND (LOWER(email) LIKE LOWER($1) OR LOWER(name) LIKE LOWER($1))
       LIMIT 10`,
      [`%${query}%`, excludeUserId]
    );
    return res.rows;
  },
};

// ─── Deal share queries ────────────────────────────────────────────────────────

export interface DealShareRow {
  id: string;
  deal_id: string;
  user_id: string;
  permission: "view" | "edit";
  shared_by: string | null;
  created_at: string;
  // Joined user fields
  user_email?: string;
  user_name?: string | null;
}

export const dealShareQueries = {
  getByDealId: async (dealId: string): Promise<DealShareRow[]> => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT ds.*, u.email AS user_email, u.name AS user_name
       FROM deal_shares ds
       JOIN users u ON ds.user_id = u.id
       WHERE ds.deal_id = $1
       ORDER BY ds.created_at ASC`,
      [dealId]
    );
    return res.rows;
  },

  create: async (share: { id: string; deal_id: string; user_id: string; permission: string; shared_by: string }): Promise<DealShareRow> => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO deal_shares (id, deal_id, user_id, permission, shared_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (deal_id, user_id) DO UPDATE SET permission = $4`,
      [share.id, share.deal_id, share.user_id, share.permission, share.shared_by]
    );
    const res = await pool.query(
      `SELECT ds.*, u.email AS user_email, u.name AS user_name
       FROM deal_shares ds JOIN users u ON ds.user_id = u.id
       WHERE ds.id = $1`,
      [share.id]
    );
    return res.rows[0];
  },

  delete: async (dealId: string, userId: string): Promise<void> => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_shares WHERE deal_id = $1 AND user_id = $2", [dealId, userId]);
  },
};

// ─── Milestone queries ────────────────────────────────────────────────────────

export const milestoneQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_milestones WHERE deal_id = $1 ORDER BY sort_order, target_date NULLS LAST, created_at",
      [dealId]
    );
    return res.rows;
  },

  create: async (milestone: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_milestones (id, deal_id, title, stage, target_date, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [
        milestone.id,
        milestone.deal_id,
        milestone.title,
        milestone.stage ?? null,
        milestone.target_date ?? null,
        milestone.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (["title", "stage", "target_date", "completed_at", "sort_order"].includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const res = await pool.query(
      `UPDATE deal_milestones SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_milestones WHERE id = $1", [id]);
  },
};

// ─── Task queries ─────────────────────────────────────────────────────────────

export const taskQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_tasks WHERE deal_id = $1 ORDER BY sort_order, created_at",
      [dealId]
    );
    return res.rows;
  },

  create: async (task: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_tasks (id, deal_id, title, description, assignee, due_date, priority, status, milestone_id, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [
        task.id,
        task.deal_id,
        task.title,
        task.description ?? null,
        task.assignee ?? null,
        task.due_date ?? null,
        task.priority ?? "medium",
        task.status ?? "todo",
        task.milestone_id ?? null,
        task.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (["title", "description", "assignee", "due_date", "priority", "status", "milestone_id", "sort_order"].includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const res = await pool.query(
      `UPDATE deal_tasks SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_tasks WHERE id = $1", [id]);
  },
};

// ─── Admin: App settings (generic key/value) ──────────────────────────────────

export const settingsQueries = {
  get: async <T = unknown>(key: string): Promise<T | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
    if (res.rows.length === 0) return null;
    return res.rows[0].value as T;
  },

  set: async (key: string, value: unknown, updatedBy: string | null): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_by = $3, updated_at = NOW()`,
      [key, JSON.stringify(value), updatedBy]
    );
  },

  getAll: async (): Promise<Array<{ key: string; value: unknown; updated_at: string; updated_by: string | null }>> => {
    const pool = getPool();
    const res = await pool.query("SELECT key, value, updated_at, updated_by FROM app_settings ORDER BY key");
    return res.rows;
  },
};

// ─── Admin: AI prompts ────────────────────────────────────────────────────────

export interface AiPromptRow {
  key: string;
  label: string;
  description: string | null;
  default_prompt: string;
  prompt: string;
  updated_by: string | null;
  updated_at: string;
}

export const aiPromptQueries = {
  listAll: async (): Promise<AiPromptRow[]> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM ai_prompts ORDER BY key");
    return res.rows;
  },

  get: async (key: string): Promise<AiPromptRow | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM ai_prompts WHERE key = $1", [key]);
    return res.rows[0] ?? null;
  },

  upsertDefault: async (row: {
    key: string;
    label: string;
    description?: string;
    default_prompt: string;
  }): Promise<void> => {
    const pool = getPool();
    // Only insert if missing; never overwrite the editable prompt
    await pool.query(
      `INSERT INTO ai_prompts (key, label, description, default_prompt, prompt, updated_at)
       VALUES ($1, $2, $3, $4, $4, NOW())
       ON CONFLICT (key) DO UPDATE SET
         label = EXCLUDED.label,
         description = EXCLUDED.description,
         default_prompt = EXCLUDED.default_prompt`,
      [row.key, row.label, row.description ?? null, row.default_prompt]
    );
  },

  setPrompt: async (key: string, prompt: string, updatedBy: string | null): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE ai_prompts SET prompt = $2, updated_by = $3, updated_at = NOW() WHERE key = $1",
      [key, prompt, updatedBy]
    );
  },

  resetToDefault: async (key: string, updatedBy: string | null): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE ai_prompts SET prompt = default_prompt, updated_by = $2, updated_at = NOW() WHERE key = $1",
      [key, updatedBy]
    );
  },
};

// ─── Admin: Pipeline stages ───────────────────────────────────────────────────

export interface PipelineStageRow {
  id: string;
  label: string;
  sort_order: number;
  color: string | null;
  is_terminal: boolean;
  created_at: string;
}

export const pipelineStageQueries = {
  listAll: async (): Promise<PipelineStageRow[]> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM pipeline_stages ORDER BY sort_order, label");
    return res.rows;
  },

  count: async (): Promise<number> => {
    const pool = getPool();
    const res = await pool.query("SELECT COUNT(*)::int AS c FROM pipeline_stages");
    return res.rows[0].c;
  },

  upsert: async (stage: PipelineStageRow): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO pipeline_stages (id, label, sort_order, color, is_terminal)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label,
         sort_order = EXCLUDED.sort_order,
         color = EXCLUDED.color,
         is_terminal = EXCLUDED.is_terminal`,
      [stage.id, stage.label, stage.sort_order, stage.color, stage.is_terminal]
    );
  },

  delete: async (id: string): Promise<void> => {
    const pool = getPool();
    await pool.query("DELETE FROM pipeline_stages WHERE id = $1", [id]);
  },
};

// ─── Admin: Checklist template ────────────────────────────────────────────────

export interface ChecklistTemplateItemRow {
  id: string;
  category: string;
  item: string;
  sort_order: number;
  created_at: string;
}

export const checklistTemplateQueries = {
  listAll: async (): Promise<ChecklistTemplateItemRow[]> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM checklist_template_items ORDER BY category, sort_order, item"
    );
    return res.rows;
  },

  count: async (): Promise<number> => {
    const pool = getPool();
    const res = await pool.query("SELECT COUNT(*)::int AS c FROM checklist_template_items");
    return res.rows[0].c;
  },

  create: async (row: Omit<ChecklistTemplateItemRow, "created_at">): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO checklist_template_items (id, category, item, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [row.id, row.category, row.item, row.sort_order]
    );
  },

  update: async (id: string, patch: { category?: string; item?: string; sort_order?: number }): Promise<void> => {
    const pool = getPool();
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.category !== undefined) { sets.push(`category = $${i++}`); vals.push(patch.category); }
    if (patch.item !== undefined) { sets.push(`item = $${i++}`); vals.push(patch.item); }
    if (patch.sort_order !== undefined) { sets.push(`sort_order = $${i++}`); vals.push(patch.sort_order); }
    if (sets.length === 0) return;
    vals.push(id);
    await pool.query(`UPDATE checklist_template_items SET ${sets.join(", ")} WHERE id = $${i}`, vals);
  },

  delete: async (id: string): Promise<void> => {
    const pool = getPool();
    await pool.query("DELETE FROM checklist_template_items WHERE id = $1", [id]);
  },
};

// ─── Admin: Audit log ─────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export const auditLogQueries = {
  record: async (entry: {
    id: string;
    user_id: string | null;
    user_email: string | null;
    action: string;
    target_type?: string | null;
    target_id?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO audit_log (id, user_id, user_email, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        entry.id,
        entry.user_id,
        entry.user_email,
        entry.action,
        entry.target_type ?? null,
        entry.target_id ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ]
    );
  },

  list: async (limit = 200): Promise<AuditLogRow[]> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return res.rows;
  },
};

// ─── Development Phase queries ────────────────────────────────────────────────

export const devPhaseQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_dev_phases WHERE deal_id = $1 ORDER BY sort_order, start_date NULLS LAST",
      [dealId]
    );
    return res.rows;
  },

  create: async (phase: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_dev_phases (id, deal_id, phase_key, label, start_date, end_date, duration_days, predecessor_id, lag_days, pct_complete, budget, status, notes, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
       RETURNING *`,
      [
        phase.id,
        phase.deal_id,
        phase.phase_key,
        phase.label,
        phase.start_date ?? null,
        phase.end_date ?? null,
        phase.duration_days ?? null,
        phase.predecessor_id ?? null,
        phase.lag_days ?? 0,
        phase.pct_complete ?? 0,
        phase.budget ?? null,
        phase.status ?? "not_started",
        phase.notes ?? null,
        phase.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (["label", "start_date", "end_date", "duration_days", "predecessor_id", "lag_days", "pct_complete", "budget", "status", "notes", "sort_order"].includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const res = await pool.query(
      `UPDATE deal_dev_phases SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  // Bulk-update computed start/end dates after a recompute pass
  bulkUpdateDates: async (updates: Array<{ id: string; start_date: string | null; end_date: string | null }>) => {
    if (updates.length === 0) return;
    const pool = getPool();
    for (const u of updates) {
      await pool.query(
        "UPDATE deal_dev_phases SET start_date = $1, end_date = $2, updated_at = NOW() WHERE id = $3",
        [u.start_date, u.end_date, u.id]
      );
    }
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_dev_phases WHERE id = $1", [id]);
  },
};

// ─── Pre-Development Cost queries ─────────────────────────────────────────────

export const preDevCostQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_predev_costs WHERE deal_id = $1 ORDER BY category, sort_order, created_at",
      [dealId]
    );
    return res.rows;
  },

  create: async (cost: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_predev_costs (id, deal_id, category, description, vendor, amount, status, incurred_date, notes, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [
        cost.id,
        cost.deal_id,
        cost.category,
        cost.description,
        cost.vendor ?? null,
        cost.amount ?? 0,
        cost.status ?? "estimated",
        cost.incurred_date ?? null,
        cost.notes ?? null,
        cost.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (["category", "description", "vendor", "amount", "status", "incurred_date", "notes", "sort_order"].includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const res = await pool.query(
      `UPDATE deal_predev_costs SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_predev_costs WHERE id = $1", [id]);
  },
};

// ─── Hard Cost Budget queries ─────────────────────────────────────────────────

export const hardCostQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_hardcost_items WHERE deal_id = $1 ORDER BY category, sort_order, created_at",
      [dealId]
    );
    return res.rows;
  },

  create: async (item: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_hardcost_items (id, deal_id, category, description, vendor, amount, status, incurred_date, notes, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [
        item.id, item.deal_id, item.category, item.description,
        item.vendor ?? null, item.amount ?? 0, item.status ?? "estimated",
        item.incurred_date ?? null, item.notes ?? null, item.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (["category", "description", "vendor", "amount", "status", "incurred_date", "notes", "sort_order"].includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;
    setClauses.push(`updated_at = NOW()`);
    values.push(id);
    const res = await pool.query(
      `UPDATE deal_hardcost_items SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_hardcost_items WHERE id = $1", [id]);
  },
};

// ─── Draw Schedule queries ────────────────────────────────────────────────────

export const drawQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_draws WHERE deal_id = $1 ORDER BY draw_number",
      [dealId]
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM deal_draws WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  create: async (draw: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_draws (id, deal_id, draw_number, title, status, submitted_date, approved_date, funded_date, amount_requested, amount_approved, retainage_held, pct_complete_claimed, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
       RETURNING *`,
      [
        draw.id, draw.deal_id, draw.draw_number, draw.title ?? "",
        draw.status ?? "draft", draw.submitted_date ?? null,
        draw.approved_date ?? null, draw.funded_date ?? null,
        draw.amount_requested ?? 0, draw.amount_approved ?? null,
        draw.retainage_held ?? 0, draw.pct_complete_claimed ?? 0,
        draw.notes ?? null,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const allowed = ["title", "status", "submitted_date", "approved_date", "funded_date", "amount_requested", "amount_approved", "retainage_held", "pct_complete_claimed", "notes"];
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;
    setClauses.push(`updated_at = NOW()`);
    values.push(id);
    const res = await pool.query(
      `UPDATE deal_draws SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_draws WHERE id = $1", [id]);
  },
};

export const drawItemQueries = {
  getByDrawId: async (drawId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_draw_items WHERE draw_id = $1 ORDER BY sort_order",
      [drawId]
    );
    return res.rows;
  },

  create: async (item: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_draw_items (id, draw_id, hardcost_item_id, description, amount_requested, amount_approved, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        item.id, item.draw_id, item.hardcost_item_id ?? null,
        item.description, item.amount_requested ?? 0,
        item.amount_approved ?? null, item.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const allowed = ["hardcost_item_id", "description", "amount_requested", "amount_approved", "sort_order"];
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;
    values.push(id);
    const res = await pool.query(
      `UPDATE deal_draw_items SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_draw_items WHERE id = $1", [id]);
  },
};

// ─── Permit queries ───────────────────────────────────────────────────────────

export const permitQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_permits WHERE deal_id = $1 ORDER BY sort_order, created_at",
      [dealId]
    );
    return res.rows;
  },

  create: async (permit: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_permits (id, deal_id, permit_type, jurisdiction, description, submitted_date, expected_date, actual_date, fee, status, notes, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [
        permit.id, permit.deal_id, permit.permit_type,
        permit.jurisdiction ?? "", permit.description ?? "",
        permit.submitted_date ?? null, permit.expected_date ?? null,
        permit.actual_date ?? null, permit.fee ?? 0,
        permit.status ?? "not_submitted", permit.notes ?? null,
        permit.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const allowed = ["permit_type", "jurisdiction", "description", "submitted_date", "expected_date", "actual_date", "fee", "status", "notes", "sort_order"];
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;
    setClauses.push(`updated_at = NOW()`);
    values.push(id);
    const res = await pool.query(
      `UPDATE deal_permits SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_permits WHERE id = $1", [id]);
  },
};

// ─── Vendor queries ───────────────────────────────────────────────────────────

export const vendorQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_vendors WHERE deal_id = $1 ORDER BY role, sort_order, created_at",
      [dealId]
    );
    return res.rows;
  },

  create: async (vendor: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_vendors (id, deal_id, name, role, company, email, phone, status, engagement_date, notes, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [
        vendor.id, vendor.deal_id, vendor.name, vendor.role ?? "Other",
        vendor.company ?? null, vendor.email ?? null, vendor.phone ?? null,
        vendor.status ?? "prospective", vendor.engagement_date ?? null,
        vendor.notes ?? null, vendor.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const allowed = ["name", "role", "company", "email", "phone", "status", "engagement_date", "notes", "sort_order"];
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;
    setClauses.push(`updated_at = NOW()`);
    values.push(id);
    const res = await pool.query(
      `UPDATE deal_vendors SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_vendors WHERE id = $1", [id]);
  },
};

// ─── Progress Report queries ──────────────────────────────────────────────────

export const progressReportQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM progress_reports WHERE deal_id = $1 ORDER BY period_end DESC, created_at DESC",
      [dealId]
    );
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM progress_reports WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  create: async (report: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO progress_reports (id, deal_id, report_type, title, period_start, period_end, status, summary, work_completed, work_planned, issues, weather_delays, pct_complete, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
       RETURNING *`,
      [
        report.id, report.deal_id, report.report_type ?? "weekly",
        report.title ?? "", report.period_start, report.period_end,
        report.status ?? "draft", report.summary ?? null,
        report.work_completed ?? null, report.work_planned ?? null,
        report.issues ?? null, report.weather_delays ?? null,
        report.pct_complete ?? null,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const allowed = [
      "title", "report_type", "period_start", "period_end", "status",
      "summary", "work_completed", "work_planned", "issues",
      "weather_delays", "pct_complete",
      "ai_executive_summary", "ai_budget_narrative", "ai_schedule_narrative", "ai_risk_narrative",
      "contractor_invite_id", "submitted_by_email", "submitted_at", "published_at",
    ];
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(updates)) {
      if (allowed.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;
    setClauses.push(`updated_at = NOW()`);
    values.push(id);
    const res = await pool.query(
      `UPDATE progress_reports SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM progress_reports WHERE id = $1", [id]);
  },
};

export const progressReportPhotoQueries = {
  getByReportId: async (reportId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM progress_report_photos WHERE report_id = $1 ORDER BY uploaded_at",
      [reportId]
    );
    return res.rows;
  },

  create: async (photo: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO progress_report_photos (id, report_id, deal_id, name, original_name, file_path, file_size, mime_type, caption, category, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       RETURNING *`,
      [
        photo.id, photo.report_id, photo.deal_id,
        photo.name, photo.original_name, photo.file_path,
        photo.file_size ?? 0, photo.mime_type ?? "image/jpeg",
        photo.caption ?? null, photo.category ?? null,
      ]
    );
    return res.rows[0];
  },

  delete: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT file_path FROM progress_report_photos WHERE id = $1", [id]);
    await pool.query("DELETE FROM progress_report_photos WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },
};

export const progressReportInviteQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT id, deal_id, email, name, revoked_at, expires_at, created_at FROM progress_report_invites WHERE deal_id = $1 ORDER BY created_at DESC",
      [dealId]
    );
    return res.rows;
  },

  create: async (invite: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO progress_report_invites (id, deal_id, email, name, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, deal_id, email, name, revoked_at, expires_at, created_at`,
      [invite.id, invite.deal_id, invite.email, invite.name ?? null, invite.token_hash, invite.expires_at ?? null]
    );
    return res.rows[0];
  },

  findByTokenHash: async (tokenHash: string) => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT i.*, d.name AS deal_name, d.address AS deal_address, d.city AS deal_city, d.state AS deal_state
       FROM progress_report_invites i
       JOIN deals d ON d.id = i.deal_id
       WHERE i.token_hash = $1 AND i.revoked_at IS NULL
         AND (i.expires_at IS NULL OR i.expires_at > NOW())`,
      [tokenHash]
    );
    return res.rows[0] ?? null;
  },

  revoke: async (id: string) => {
    const pool = getPool();
    await pool.query("UPDATE progress_report_invites SET revoked_at = NOW() WHERE id = $1", [id]);
  },
};

// ─── Communication queries ────────────────────────────────────────────────────

const COMMUNICATION_FIELDS = [
  "stakeholder_type",
  "stakeholder_name",
  "channel",
  "direction",
  "subject",
  "summary",
  "status",
  "occurred_at",
  "follow_up_at",
  "contact_id",
];

export const communicationQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_communications WHERE deal_id = $1 ORDER BY occurred_at DESC, created_at DESC",
      [dealId]
    );
    return res.rows;
  },

  create: async (comm: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_communications
        (id, deal_id, stakeholder_type, stakeholder_name, channel, direction,
         subject, summary, status, occurred_at, follow_up_at, contact_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [
        comm.id,
        comm.deal_id,
        comm.stakeholder_type ?? "broker",
        comm.stakeholder_name ?? "",
        comm.channel ?? "email",
        comm.direction ?? "outbound",
        comm.subject ?? "",
        comm.summary ?? "",
        comm.status ?? "open",
        comm.occurred_at ?? new Date().toISOString(),
        comm.follow_up_at ?? null,
        comm.contact_id ?? null,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (COMMUNICATION_FIELDS.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const res = await pool.query(
      `UPDATE deal_communications SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_communications WHERE id = $1", [id]);
  },
};

// ─── Question queries ─────────────────────────────────────────────────────────

const QUESTION_FIELDS = [
  "target_role",
  "phase",
  "question",
  "answer",
  "status",
  "source",
  "sort_order",
];

export const questionQueries = {
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM deal_questions
       WHERE deal_id = $1
       ORDER BY phase, sort_order, created_at`,
      [dealId]
    );
    return res.rows;
  },

  create: async (q: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO deal_questions
        (id, deal_id, target_role, phase, question, answer, status, source, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [
        q.id,
        q.deal_id,
        q.target_role ?? "broker",
        q.phase ?? "sourcing",
        q.question,
        q.answer ?? null,
        q.status ?? "open",
        q.source ?? "manual",
        q.sort_order ?? 0,
      ]
    );
    return res.rows[0];
  },

  createMany: async (rows: Array<Record<string, unknown>>) => {
    const created = [];
    for (const row of rows) {
      created.push(await questionQueries.create(row));
    }
    return created;
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (QUESTION_FIELDS.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const res = await pool.query(
      `UPDATE deal_questions SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_questions WHERE id = $1", [id]);
  },
};

// ─── Contact queries (CRM) ────────────────────────────────────────────────────

const CONTACT_FIELDS = [
  "name",
  "email",
  "phone",
  "role",
  "company",
  "title",
  "notes",
  "tags",
];

export const contactQueries = {
  getAll: async (opts: { q?: string; role?: string } = {}) => {
    const pool = getPool();
    const where: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (opts.q) {
      where.push(
        `(LOWER(name) LIKE $${idx} OR LOWER(COALESCE(email,'')) LIKE $${idx} OR LOWER(COALESCE(company,'')) LIKE $${idx})`
      );
      values.push(`%${opts.q.toLowerCase()}%`);
      idx++;
    }
    if (opts.role) {
      where.push(`role = $${idx}`);
      values.push(opts.role);
      idx++;
    }

    const sql = `
      SELECT * FROM contacts
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY name ASC
      LIMIT 500
    `;
    const res = await pool.query(sql, values);
    return res.rows;
  },

  getById: async (id: string) => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM contacts WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  },

  /** Get a contact along with the deals it's linked to */
  getByIdWithDeals: async (id: string) => {
    const pool = getPool();
    const contact = await contactQueries.getById(id);
    if (!contact) return null;
    const dealsRes = await pool.query(
      `SELECT dc.id AS link_id, dc.role_on_deal, dc.notes AS link_notes, dc.created_at AS linked_at,
              d.id AS deal_id, d.name AS deal_name, d.status AS deal_status, d.city, d.state
       FROM deal_contacts dc
       JOIN deals d ON d.id = dc.deal_id
       WHERE dc.contact_id = $1
       ORDER BY dc.created_at DESC`,
      [id]
    );
    return { ...contact, deals: dealsRes.rows };
  },

  create: async (c: Record<string, unknown>) => {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO contacts (id, name, email, phone, role, company, title, notes, tags, owner_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [
        c.id,
        c.name,
        c.email ?? null,
        c.phone ?? null,
        c.role ?? "broker",
        c.company ?? null,
        c.title ?? null,
        c.notes ?? null,
        JSON.stringify(c.tags ?? []),
        c.owner_id ?? null,
      ]
    );
    return res.rows[0];
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (CONTACT_FIELDS.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(key === "tags" ? JSON.stringify(value ?? []) : value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const res = await pool.query(
      `UPDATE contacts SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  delete: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM contacts WHERE id = $1", [id]);
  },
};

// ─── Deal-Contact link queries ────────────────────────────────────────────────

const DEAL_CONTACT_FIELDS = ["role_on_deal", "notes"];

export const dealContactQueries = {
  /** List contacts linked to a deal, joined with the contact rows */
  getByDealId: async (dealId: string) => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT dc.id AS link_id, dc.role_on_deal, dc.notes AS link_notes, dc.created_at AS linked_at,
              c.*
       FROM deal_contacts dc
       JOIN contacts c ON c.id = dc.contact_id
       WHERE dc.deal_id = $1
       ORDER BY dc.created_at DESC`,
      [dealId]
    );
    return res.rows;
  },

  /** Create a deal-contact link. Returns null on duplicate (unique constraint). */
  link: async (link: { id: string; deal_id: string; contact_id: string; role_on_deal?: string | null; notes?: string | null }) => {
    const pool = getPool();
    try {
      const res = await pool.query(
        `INSERT INTO deal_contacts (id, deal_id, contact_id, role_on_deal, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING *`,
        [link.id, link.deal_id, link.contact_id, link.role_on_deal ?? null, link.notes ?? null]
      );
      return res.rows[0];
    } catch (err) {
      // 23505 = unique violation
      if ((err as { code?: string }).code === "23505") return null;
      throw err;
    }
  },

  update: async (id: string, updates: Record<string, unknown>) => {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (DEAL_CONTACT_FIELDS.includes(key)) {
        setClauses.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }
    if (setClauses.length === 0) return null;
    values.push(id);

    const res = await pool.query(
      `UPDATE deal_contacts SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] ?? null;
  },

  unlink: async (id: string) => {
    const pool = getPool();
    await pool.query("DELETE FROM deal_contacts WHERE id = $1", [id]);
  },
};
