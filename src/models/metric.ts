import { pool } from '../config/database';

export interface Metric {
  id: string;
  document_id: string;
  metric_type: 'property' | 'financial' | 'market' | 'assumptions' | 'red_flags';
  metric_name: string;
  metric_value?: string;
  numeric_value?: number;
  confidence?: number;
  extraction_method: 'regex' | 'llm' | 'ocr' | 'manual';
  source_text?: string;
  page_number?: number;
  created_at: Date;
}

export class MetricModel {
  static async create(metric: Partial<Metric>): Promise<Metric> {
    const query = `
      INSERT INTO metrics (
        id, document_id, metric_type, metric_name, metric_value,
        numeric_value, confidence, extraction_method, source_text, page_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const id = crypto.randomUUID();
    const values = [
      id,
      metric.document_id,
      metric.metric_type,
      metric.metric_name,
      metric.metric_value,
      metric.numeric_value,
      metric.confidence,
      metric.extraction_method || 'llm',
      metric.source_text,
      metric.page_number,
    ];

    const result = await pool.query(query, values);
    return this.mapRow(result.rows[0]);
  }

  static async findByDocumentId(documentId: string): Promise<Metric[]> {
    const query = 'SELECT * FROM metrics WHERE document_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [documentId]);
    return result.rows.map(this.mapRow);
  }

  static async findByType(documentId: string, metricType: Metric['metric_type']): Promise<Metric[]> {
    const query = 'SELECT * FROM metrics WHERE document_id = $1 AND metric_type = $2';
    const result = await pool.query(query, [documentId, metricType]);
    return result.rows.map(this.mapRow);
  }

  static async deleteByDocumentId(documentId: string): Promise<boolean> {
    const query = 'DELETE FROM metrics WHERE document_id = $1';
    const result = await pool.query(query, [documentId]);
    return result.rowCount > 0;
  }

  private static mapRow(row: any): Metric {
    return {
      id: row.id,
      document_id: row.document_id,
      metric_type: row.metric_type,
      metric_name: row.metric_name,
      metric_value: row.metric_value,
      numeric_value: row.numeric_value ? parseFloat(row.numeric_value) : undefined,
      confidence: row.confidence ? parseFloat(row.confidence) : undefined,
      extraction_method: row.extraction_method,
      source_text: row.source_text,
      page_number: row.page_number,
      created_at: new Date(row.created_at),
    };
  }
}

export default MetricModel;
