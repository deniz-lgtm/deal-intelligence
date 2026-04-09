// Deal Room — guest-accessible document sharing.
//
// Magic-link auth: we generate a 32-byte random token, store its SHA-256
// hash in deal_room_invites.token_hash, and hand the raw token back to the
// owner to embed in the invite email/link. On guest access we hash the URL
// token and look it up. Hashing means a DB leak doesn't expose live invite
// links.

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getPool } from "./db";

export const DEFAULT_NDA_TEXT = `Confidentiality Acknowledgment

By accessing this Deal Room you acknowledge that all materials — including
property financial statements, rent rolls, tenant information, and
underwriting — are confidential and proprietary. You agree to:

• Use the materials solely to evaluate a potential transaction involving
  the subject property.
• Not disclose, reproduce, or distribute the materials to any third party
  without written consent.
• Destroy or return all materials (and any copies/notes) upon request or
  when discussions conclude.

Your access is logged. Any misuse may result in immediate revocation and
legal action.`;

export interface DealRoom {
  id: string;
  deal_id: string;
  name: string;
  description: string | null;
  nda_required: boolean;
  nda_text: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealRoomDocument {
  id: string;
  room_id: string;
  document_id: string;
  sort_order: number;
  created_at: string;
}

export interface DealRoomInvite {
  id: string;
  room_id: string;
  email: string;
  name: string | null;
  token_hash: string;
  nda_accepted_at: string | null;
  nda_accepted_name: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface DealRoomActivity {
  id: string;
  room_id: string;
  invite_id: string | null;
  email: string | null;
  event: string;
  document_id: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

// ── Token generation + hashing ────────────────────────────────────────────

/** Generates a URL-safe random token for a magic-link invite. */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Hashes an invite token for storage and lookup. */
export function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── Room queries ──────────────────────────────────────────────────────────

export const dealRoomQueries = {
  create: async (input: {
    deal_id: string;
    name: string;
    description?: string;
    nda_required?: boolean;
    nda_text?: string;
    expires_at?: string | null;
    created_by?: string;
  }): Promise<DealRoom> => {
    const pool = getPool();
    const id = uuidv4();
    await pool.query(
      `INSERT INTO deal_rooms
         (id, deal_id, name, description, nda_required, nda_text, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.deal_id,
        input.name,
        input.description ?? null,
        input.nda_required ?? true,
        input.nda_text ?? DEFAULT_NDA_TEXT,
        input.expires_at ?? null,
        input.created_by ?? null,
      ]
    );
    const res = await pool.query("SELECT * FROM deal_rooms WHERE id = $1", [
      id,
    ]);
    return res.rows[0];
  },

  getByDealId: async (dealId: string): Promise<DealRoom[]> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_rooms WHERE deal_id = $1 ORDER BY created_at DESC",
      [dealId]
    );
    return res.rows;
  },

  getById: async (id: string): Promise<DealRoom | null> => {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM deal_rooms WHERE id = $1", [
      id,
    ]);
    return res.rows[0] ?? null;
  },

  update: async (
    id: string,
    updates: Partial<{
      name: string;
      description: string | null;
      nda_required: boolean;
      nda_text: string | null;
      expires_at: string | null;
    }>
  ): Promise<DealRoom | null> => {
    const pool = getPool();
    const keys = Object.keys(updates);
    if (keys.length === 0) return dealRoomQueries.getById(id);
    const set = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ");
    const vals = keys.map((k) => (updates as Record<string, unknown>)[k]);
    vals.push(id);
    await pool.query(
      `UPDATE deal_rooms SET ${set}, updated_at = NOW() WHERE id = $${vals.length}`,
      vals
    );
    return dealRoomQueries.getById(id);
  },

  revoke: async (id: string): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE deal_rooms SET revoked_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  },

  // Documents in a room
  listDocuments: async (roomId: string) => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT rd.*, d.name, d.original_name, d.category, d.mime_type, d.file_size
       FROM deal_room_documents rd
       JOIN documents d ON d.id = rd.document_id
       WHERE rd.room_id = $1
       ORDER BY rd.sort_order, rd.created_at`,
      [roomId]
    );
    return res.rows;
  },

  addDocuments: async (roomId: string, documentIds: string[]): Promise<void> => {
    if (documentIds.length === 0) return;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < documentIds.length; i++) {
        await client.query(
          `INSERT INTO deal_room_documents (id, room_id, document_id, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (room_id, document_id) DO NOTHING`,
          [uuidv4(), roomId, documentIds[i], i]
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

  removeDocument: async (roomId: string, documentId: string): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "DELETE FROM deal_room_documents WHERE room_id = $1 AND document_id = $2",
      [roomId, documentId]
    );
  },

  // Invites
  listInvites: async (roomId: string): Promise<DealRoomInvite[]> => {
    const pool = getPool();
    const res = await pool.query(
      "SELECT * FROM deal_room_invites WHERE room_id = $1 ORDER BY created_at DESC",
      [roomId]
    );
    return res.rows;
  },

  createInvite: async (input: {
    room_id: string;
    email: string;
    name?: string;
    expires_at?: string | null;
  }): Promise<{ invite: DealRoomInvite; token: string }> => {
    const pool = getPool();
    const token = generateInviteToken();
    const token_hash = hashInviteToken(token);
    const id = uuidv4();
    await pool.query(
      `INSERT INTO deal_room_invites
         (id, room_id, email, name, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        input.room_id,
        input.email,
        input.name ?? null,
        token_hash,
        input.expires_at ?? null,
      ]
    );
    const res = await pool.query(
      "SELECT * FROM deal_room_invites WHERE id = $1",
      [id]
    );
    return { invite: res.rows[0], token };
  },

  revokeInvite: async (inviteId: string): Promise<void> => {
    const pool = getPool();
    await pool.query(
      "UPDATE deal_room_invites SET revoked_at = NOW() WHERE id = $1",
      [inviteId]
    );
  },

  /**
   * Look up an invite by the raw token from the URL. Returns null if the
   * token doesn't match, the invite is revoked, or the expiration has
   * passed. Also returns null if the parent room is revoked/expired.
   */
  findInviteByToken: async (
    token: string
  ): Promise<{ invite: DealRoomInvite; room: DealRoom } | null> => {
    if (!token || token.length < 16) return null;
    const token_hash = hashInviteToken(token);
    const pool = getPool();
    const res = await pool.query(
      `SELECT i.*, r.id AS r_id, r.deal_id AS r_deal_id, r.name AS r_name,
              r.description AS r_description, r.nda_required AS r_nda_required,
              r.nda_text AS r_nda_text, r.expires_at AS r_expires_at,
              r.revoked_at AS r_revoked_at, r.created_at AS r_created_at,
              r.updated_at AS r_updated_at, r.created_by AS r_created_by
       FROM deal_room_invites i
       JOIN deal_rooms r ON r.id = i.room_id
       WHERE i.token_hash = $1
       LIMIT 1`,
      [token_hash]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    // Revocation / expiration checks
    const now = Date.now();
    if (row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < now) return null;
    if (row.r_revoked_at) return null;
    if (row.r_expires_at && new Date(row.r_expires_at).getTime() < now) return null;

    const invite: DealRoomInvite = {
      id: row.id,
      room_id: row.room_id,
      email: row.email,
      name: row.name,
      token_hash: row.token_hash,
      nda_accepted_at: row.nda_accepted_at,
      nda_accepted_name: row.nda_accepted_name,
      revoked_at: row.revoked_at,
      expires_at: row.expires_at,
      created_at: row.created_at,
    };
    const room: DealRoom = {
      id: row.r_id,
      deal_id: row.r_deal_id,
      name: row.r_name,
      description: row.r_description,
      nda_required: row.r_nda_required,
      nda_text: row.r_nda_text,
      expires_at: row.r_expires_at,
      revoked_at: row.r_revoked_at,
      created_by: row.r_created_by,
      created_at: row.r_created_at,
      updated_at: row.r_updated_at,
    };
    return { invite, room };
  },

  acceptNda: async (inviteId: string, name: string): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `UPDATE deal_room_invites
       SET nda_accepted_at = NOW(), nda_accepted_name = $1
       WHERE id = $2`,
      [name, inviteId]
    );
  },

  // Activity
  logActivity: async (input: {
    room_id: string;
    invite_id?: string | null;
    email?: string | null;
    event: string;
    document_id?: string | null;
    ip?: string | null;
    user_agent?: string | null;
  }): Promise<void> => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO deal_room_activity
         (id, room_id, invite_id, email, event, document_id, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        uuidv4(),
        input.room_id,
        input.invite_id ?? null,
        input.email ?? null,
        input.event,
        input.document_id ?? null,
        input.ip ?? null,
        input.user_agent ?? null,
      ]
    );
  },

  listActivity: async (roomId: string, limit = 100): Promise<DealRoomActivity[]> => {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM deal_room_activity
       WHERE room_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [roomId, limit]
    );
    return res.rows;
  },
};
