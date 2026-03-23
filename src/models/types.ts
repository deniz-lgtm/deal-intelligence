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

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  embedding?: number[];
  token_count?: number;
  created_at: Date;
}

export interface ExtractedMetric {
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

export interface QAEntry {
  id: string;
  document_id: string;
  question: string;
  answer: string;
  model_used: string;
  tokens_used?: number;
  cost_estimate?: number;
  source_chunks?: string[];
  created_at: Date;
}

export interface ProcessingJob {
  id: string;
  document_id: string;
  job_type: 'extraction' | 'ocr' | 'analysis' | 'chunking' | 'embedding';
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: number;
  started_at?: Date;
  completed_at?: Date;
  error_message?: string;
  attempts: number;
  max_attempts: number;
  result?: Record<string, any>;
  created_at: Date;
}

export interface DocumentUploadRequest {
  file: File;
  source?: 'api' | 'notion' | 'email';
  sourceId?: string;
  metadata?: Record<string, any>;
}

export interface DocumentUploadResponse {
  id: string;
  filename: string;
  status: string;
  uploadDate: Date;
  message: string;
}

export interface QAResponse {
  question: string;
  answer: string;
  confidence: number;
  sources: {
    chunkIndex: number;
    content: string;
    similarity: number;
  }[];
  modelUsed: string;
  costEstimate?: number;
}
