/**
 * server.ts — Real-time webhook server entry point.
 *
 * Run with: npm run dev  (development)
 *           npm start    (production, after npm run build)
 *
 * For historical migration, use: npm run sync
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import ghlWebhookRouter from './webhooks/ghlWebhook';
import prisma from './db/prisma';
import { runHistoricalSync } from './sync/historicalSync';

const app = express();

app.use(
  express.json({
    verify: (req: Request & { rawBody?: string }, _res: Response, buf: Buffer) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Trigger historical GHL→GHL sync (kept for backward compat)
app.post('/sync', async (req: Request, res: Response): Promise<void> => {
  res.json({ status: 'started', message: 'Sync started. Check Railway logs.' });

  const { startDate, endDate, conversationId, contactId, dryRun } = req.body as {
    startDate?: string;
    endDate?: string;
    conversationId?: string;
    contactId?: string;
    dryRun?: boolean;
  };

  console.log('[SYNC] Historical sync triggered via HTTP');

  runHistoricalSync({ startDate, endDate, conversationId, contactId, dryRun: dryRun ?? false })
    .then(() => console.log('[SYNC] Historical sync finished'))
    .catch((err: unknown) => console.error('[SYNC] Error:', (err as Error).message));
});

// Trigger Google Sheet export via HTTP
// POST /export
// Body: { "contactId": "xxx", "dryRun": true }
app.post('/export', async (req: Request, res: Response): Promise<void> => {
  res.json({ status: 'started', message: 'Sheet export started. Check Railway logs.' });

  const { contactId, startDate, endDate, dryRun } = req.body as {
    contactId?: string;
    startDate?: string;
    endDate?: string;
    dryRun?: boolean;
  };

  console.log('[EXPORT] Google Sheet export triggered via HTTP');

  // Dynamically import to avoid loading googleapis unless needed
  import('./sheet/sheetExportRunner').then(m =>
    m.runSheetExport({ contactId, startDate, endDate, dryRun: dryRun ?? false })
      .then(() => console.log('[EXPORT] Sheet export finished'))
      .catch((err: unknown) => console.error('[EXPORT] Error:', (err as Error).message))
  ).catch((err: unknown) => console.error('[EXPORT] Import error:', (err as Error).message));
});

app.use('/webhooks/ghl', ghlWebhookRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  // Run migrations automatically on startup (safe in production)
  console.log('[DB] Running migrations...');
  const { execSync } = await import('child_process');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('[DB] Migrations complete');
  } catch (err) {
    console.error('[DB] Migration failed:', err);
    process.exit(1);
  }

  await prisma.$connect();
  console.log('[DB] Connected');

  app.listen(config.port, () => {
    console.log(`[SERVER] Running on port ${config.port}`);
    console.log(`[CONFIG] Source location:      ${config.source.locationId}`);
    console.log(`[CONFIG] Destination location: ${config.destination.locationId}`);
    console.log(`[CONFIG] Signature verify:     ${config.verifyWebhookSignature ? 'ON' : 'OFF'}`);
    console.log('[SERVER] POST /webhooks/ghl');
    console.log('[SERVER] GET  /health');
  });
}

start().catch((err: unknown) => {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
});
