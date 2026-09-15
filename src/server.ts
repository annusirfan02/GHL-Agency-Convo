/**
 * server.ts
 *
 * GET  /health        — health check
 * GET  /export        — download CSV (all contacts)
 * GET  /export?contactId=xxx  — single contact CSV
 * GET  /export?dryRun=true    — preview (returns row count only)
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { generateCsv } from './csv/csvExporter';

const app = express();
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── CSV Export ────────────────────────────────────────────────────────────────
// GET /export
// Query params (all optional):
//   contactId=xxx        → single contact
//   startDate=2026-01-01 → date filter
//   endDate=2026-09-14   → date filter
//   dryRun=true          → returns count only, no download
//
// POST /export
// Body (all optional):
//   { "contactId": "xxx", "dryRun": true }
async function handleExport(req: Request, res: Response): Promise<void> {
  const query = { ...req.query, ...req.body } as {
    contactId?: string;
    startDate?: string;
    endDate?: string;
    dryRun?: string | boolean;
  };

  const dryRun = query.dryRun === true || query.dryRun === 'true';

  console.log('[EXPORT] CSV export triggered');
  if (query.contactId) console.log(`[EXPORT] Contact: ${query.contactId}`);
  if (dryRun)          console.log('[EXPORT] DRY RUN');

  try {
    const csv = await generateCsv({
      contactId: query.contactId,
      startDate: query.startDate,
      endDate:   query.endDate,
      dryRun,
    });

    if (dryRun) {
      // Just return stats
      const lines = csv.split('\n').length - 1; // minus header
      res.json({ status: 'ok', contacts: lines, message: 'Dry run complete — no file generated' });
      return;
    }

    // Stream CSV as downloadable file
    const filename = `ghl-conversations-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err: unknown) {
    console.error('[EXPORT] Error:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
}

app.get('/export',  handleExport);
app.post('/export', handleExport);

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
  console.log(`[CONFIG] Source: ${config.source.locationId}`);
  console.log('[SERVER] GET  /health');
  console.log('[SERVER] GET  /export          → download all contacts CSV');
  console.log('[SERVER] GET  /export?contactId=xxx → single contact CSV');
  console.log('[SERVER] GET  /export?dryRun=true   → preview only');
});
