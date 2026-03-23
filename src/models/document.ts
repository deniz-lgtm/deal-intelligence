import { pool } from '../config/database';

export interface Document {
  id: string;
  filename: string;
  original_filename: string;
  filetype: string;
  file_size: number;
  file_path: string;
  upload_date: Date;
  processed_date?: Date;
  status: 'uploaded' | 'processing' | 'extracted' | 'analyzed' | 'error';
  source: 'api' | 'notion' | 'email';
  source_id?: string;
  extracted_text?: string;
  page_count?: number;
  is_scanned: boolean;
  error_message?: string;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export class DocumentModel {
  static async create(doc: Partial<Document>): Promise<Document> {
    const id = crypto.randomUUID();
    const query = `
      INSERT INTO documents (
        id, filename, original_filename, filetype, file_size, 
        file_path, source, source_id, metadata, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    
    const values = [
      id,
      doc.filename,
      doc.original_filename,
      doc.filetype,
      doc.file_size,
      doc.file_path,
      doc.source || 'api',
      doc.source_id,
      JSON.stringify(doc.metadata || {}),
      'uploaded'
    ];
    
    const result = await pool.query(query, values);
    return this.mapRow(result.rows[0]);
  }

  static async findById(id: string): Promise<Document | null> {
    const query = 'SELECT * FROM documents WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows.length ? this.mapRow(result.rows[0]) : null;
  }

  static async findAll(limit: number = 100, offset: number = 0): Promise<Document[]> {
    const query = 'SELECT * FROM documents ORDER BY upload_date DESC LIMIT $1 OFFSET $2';
    const result = await pool.query(query, [limit, offset]);
    return result.rows.map(this.mapRow);
  }

  static async updateStatus(
    id: string, 
    status: Document['status'], 
    updates?: Partial<Document>
  ): Promise<Document | null> {
    const allowedUpdates = ['extracted_text', 'page_count', 'is_scanned', 'error_message', 'processed_date', 'metadata'];
    const setClauses: string[] = ['status = $1', 'updated_at = NOW()'];
    const values: any[] = [status];
    let paramIndex = 2;

    if (updates) {
      for (const [key, value] of Object.entries(updates)) {
        if (allowedUpdates.includes(key) && value !== undefined) {
          setClauses.push(`${key} = $${paramIndex}`);
          values.push(key === 'metadata' ? JSON.stringify(value) : value);
          paramIndex++;
        }
      }
    }

    values.push(id);
    const query = `UPDATE documents SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    
    const result = await pool.query(query, values);
    return result.rows.length ? this.mapRow(result.rows[0]) : null;
  }

  static async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM documents WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rowCount > 0;
  }

  private static mapRow(row: any): Document {
    return {
      id: row.id,
      filename: row.filename,
      original_filename: row.original_filename,
      filetype: row.filetype,
      file_size: parseInt(row.file_size),
      file_path: row.file_path,
      upload_date: new Date(row.upload_date),
      processed_date: row.processed_date ? new Date(row.processed_date) : undefined,
      status: row.status,
      source: row.source,
      source_id: row.source_id,
      extracted_text: row.extracted_text,
      page_count: row.page_count,
      is_scanned: row.is_scanned || false,
      error_message: row.error_message,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}

export default DocumentModel;
