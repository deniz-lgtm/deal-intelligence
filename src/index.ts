import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';

import { config } from './config';
import { testConnection } from './config/database';
import { LLMService } from './services/llm';

import documentRoutes from './routes/documents';
import qaRoutes from './routes/qa';
import healthRoutes from './routes/health';
import notionRoutes from './routes/notion';

// Load environment variables
dotenv.config();

// Initialize services
LLMService.initialize();

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' }
});
app.use(limiter);

// Stricter rate limit for Q&A (costly operations)
const qaLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Q&A rate limit exceeded' }
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));

// Static files (for development)
app.use('/uploads', express.static(path.resolve(config.upload.dir)));

// Health check (no rate limit)
app.use('/api/health', healthRoutes);

// Document routes
app.use('/api/documents', documentRoutes);

// Q&A routes with stricter rate limit
app.use('/api/documents/:id/qa', qaLimiter, qaRoutes);

// Notion webhook endpoint
app.use('/api/webhooks/notion', notionRoutes);

// Error handling
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('Express error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'File too large',
        maxSize: config.upload.maxSize 
      });
    }
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ 
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
async function startServer() {
  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('❌ Failed to connect to database. Exiting...');
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║     OM/Document Intelligence System - Phase 1 MVP          ║
╠════════════════════════════════════════════════════════════╣
║  Server running on port ${config.port}                          ║
║  Environment: ${config.nodeEnv.padEnd(30)}                  ║
║  Database: Connected                                       ║
╚════════════════════════════════════════════════════════════╝

API Endpoints:
  POST /api/documents/upload    - Upload new document
  GET  /api/documents           - List documents
  GET  /api/documents/:id       - Get document details
  GET  /api/documents/:id/content - Get extracted text
  GET  /api/documents/:id/metrics - Get extracted metrics
  POST /api/documents/:id/qa    - Ask question about document
  GET  /api/documents/:id/qa/history - Get Q&A history
  GET  /api/health              - Health check
  GET  /api/stats               - System statistics
`);
  });
}

startServer().catch(console.error);

export default app;
