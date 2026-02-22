import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config';
import { jobStore } from './services/job-store';
import jobsRouter from './routes/jobs';

const app = express();
const startTime = Date.now();

// Request ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4().substring(0, 8);
  res.setHeader('X-Request-ID', requestId);
  (req as Request & { requestId: string }).requestId = requestId;
  next();
});

// CORS middleware
app.use(cors({
  origin: config.corsOrigins,
  credentials: true
}));

// JSON body parser
app.use(express.json({ limit: '50mb' }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const reqWithId = req as Request & { requestId: string };
  console.log(`[${reqWithId.requestId}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/generation/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    activeJobs: jobStore.getActiveJobCount()
  });
});

// Jobs routes
app.use('/api/generation/jobs', jobsRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist'
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const reqWithId = req as Request & { requestId: string };
  console.error(`[${reqWithId.requestId}] Unhandled error:`, err);

  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : 'An unexpected error occurred',
    requestId: reqWithId.requestId
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  jobStore.stopCleanup();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down gracefully...');
  jobStore.stopCleanup();
  process.exit(0);
});

// Start server
app.listen(config.port, () => {
  console.log(`[Server] Generation service v1.0.1 running on port ${config.port}`);
  console.log(`[Server] Environment: ${config.nodeEnv}`);
  console.log(`[Server] Gemini proxy URL: ${config.geminiProxyUrl}`);
});
