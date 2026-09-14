/**
 * cli.ts — Historical sync entry point
 *
 * Usage:
 *   npm run sync
 *   npm run sync -- --dry-run
 *   npm run sync -- --contact-id=abc123
 *   npm run sync -- --contact-id=abc123 --dry-run
 *   npm run sync -- --conversation-id=abc123
 *   npm run sync -- --start-date=2026-01-01 --end-date=2026-09-14
 */
import 'dotenv/config';
import prisma from './db/prisma';
import { runHistoricalSync } from './sync/historicalSync';

function parseArgs(): {
  dryRun: boolean;
  contactId?: string;
  conversationId?: string;
  startDate?: string;
  endDate?: string;
} {
  const args = process.argv.slice(2);

  const dryRun         = args.includes('--dry-run');
  const contactId      = args.find(a => a.startsWith('--contact-id='))?.split('=')[1];
  const conversationId = args.find(a => a.startsWith('--conversation-id='))?.split('=')[1];
  const startDate      = args.find(a => a.startsWith('--start-date='))?.split('=')[1];
  const endDate        = args.find(a => a.startsWith('--end-date='))?.split('=')[1];

  return { dryRun, contactId, conversationId, startDate, endDate };
}

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log('[INFO] GHL Historical Conversation Sync');
  console.log('[INFO] ─────────────────────────────────');

  if (opts.dryRun)         console.log('[INFO] Mode: DRY RUN (no changes will be written)');
  if (opts.contactId)      console.log(`[INFO] Mode: Single contact — ${opts.contactId}`);
  if (opts.conversationId) console.log(`[INFO] Mode: Single conversation — ${opts.conversationId}`);
  if (opts.startDate)      console.log(`[INFO] Start date: ${opts.startDate}`);
  if (opts.endDate)        console.log(`[INFO] End date:   ${opts.endDate}`);

  await prisma.$connect();
  console.log('[INFO] Database connected\n');

  try {
    await runHistoricalSync({
      dryRun:         opts.dryRun,
      contactId:      opts.contactId,
      conversationId: opts.conversationId,
      startDate:      opts.startDate,
      endDate:        opts.endDate,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
