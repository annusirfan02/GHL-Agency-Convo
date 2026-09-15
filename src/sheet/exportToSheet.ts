/**
 * exportToSheet.ts — CLI entry point for Google Sheet export
 *
 * Usage:
 *   npm run sheet
 *   npm run sheet -- --contact-id=ABC123
 *   npm run sheet -- --contact-id=ABC123 --dry-run
 *   npm run sheet -- --start-date=2026-01-01 --end-date=2026-09-14
 */
import 'dotenv/config';
import { runSheetExport } from './sheetExportRunner';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun:    args.includes('--dry-run'),
    contactId: args.find(a => a.startsWith('--contact-id='))?.split('=')[1],
    startDate: args.find(a => a.startsWith('--start-date='))?.split('=')[1],
    endDate:   args.find(a => a.startsWith('--end-date='))?.split('=')[1],
  };
}

async function main() {
  const opts = parseArgs();

  console.log('[INFO] GHL → Google Sheet Export');
  console.log('[INFO] ─────────────────────────────');
  if (opts.dryRun)    console.log('[INFO] DRY RUN mode');
  if (opts.contactId) console.log(`[INFO] Single contact: ${opts.contactId}`);
  if (opts.startDate) console.log(`[INFO] Start date: ${opts.startDate}`);
  if (opts.endDate)   console.log(`[INFO] End date:   ${opts.endDate}`);
  console.log('');

  await runSheetExport(opts);
}

main().catch((err: unknown) => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
