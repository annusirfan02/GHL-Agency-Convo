/**
 * server.ts
 *
 * Simple HTTP server:
 *   GET  /health  — health check
 *   POST /export  — trigger GHL → Google Sheet export
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';

const app = express();
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Google Sheet Export ───────────────────────────────────────────────────────
// POST /export
// Body (all optional):
//   { "contactId": "xxx" }        → single contact
//   { "dryRun": true }            → preview only
//   { "startDate": "2026-01-01" } → date filter
//   {}                            → all contacts
app.post('/export', async (req: Request, res: Response): Promise<void> => {
  res.json({
    status: 'started',
    message: 'Export started. Check Railway logs for progress.',
  });

  const { contactId, startDate, endDate, dryRun } = req.body as {
    contactId?: string;
    startDate?: string;
    endDate?: string;
    dryRun?: boolean;
  };

  console.log('[EXPORT] Google Sheet export triggered');
  if (contactId) console.log(`[EXPORT] Contact ID: ${contactId}`);
  if (dryRun)    console.log('[EXPORT] DRY RUN mode');

  import('./sheet/sheetExportRunner')
    .then(m =>
      m.runSheetExport({ contactId, startDate, endDate, dryRun: dryRun ?? false })
        .then(() => console.log('[EXPORT] Finished ✅'))
        .catch((err: unknown) => console.error('[EXPORT] Error:', (err as Error).message))
    )
    .catch((err: unknown) =>
      console.error('[EXPORT] Import error:', (err as Error).message)
    );
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[SERVER] Running on port ${config.port}`);
  console.log(`[CONFIG] Source location: ${config.source.locationId}`);
  console.log('[SERVER] POST /export');
  console.log('[SERVER] GET  /health');
});
