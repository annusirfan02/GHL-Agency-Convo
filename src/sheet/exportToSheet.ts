/**
 * exportToSheet.ts
 *
 * Main export script:
 * GHL Agency 1 → All contacts → All conversations → All messages → Google Sheet
 *
 * Usage:
 *   npm run sheet
 *   npm run sheet -- --contact-id=ABC123
 *   npm run sheet -- --dry-run
 */
import 'dotenv/config';
import { config } from '../config';
import { createGhlClient } from '../ghl/client';
import { getContact } from '../ghl/contacts';
import { searchConversations, findAllConversationsByContact } from '../ghl/conversations';
import { getAllMessages } from '../ghl/messages';
import { isActivityMessage } from '../ghl/messages';
import {
  ensureHeaders,
  getExistingMessageIds,
  appendRows,
  formatChannel,
  formatDate,
  SheetRow,
} from './googleSheets';

// Delay between API calls (ms)
const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

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

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID environment variable is not set');
  }

  const sheetName = process.env.GOOGLE_SHEET_NAME ?? 'Sheet1';

  console.log('[INFO] GHL → Google Sheet Export');
  console.log('[INFO] ─────────────────────────────────');
  console.log(`[INFO] Source location: ${config.source.locationId}`);
  console.log(`[INFO] Sheet ID: ${spreadsheetId}`);
  console.log(`[INFO] Sheet tab: ${sheetName}`);
  if (opts.dryRun)    console.log('[INFO] Mode: DRY RUN — nothing will be written');
  if (opts.contactId) console.log(`[INFO] Single contact: ${opts.contactId}`);
  console.log('');

  const sourceClient = createGhlClient(config.source.accessToken);

  // Setup sheet headers
  if (!opts.dryRun) {
    await ensureHeaders(spreadsheetId, sheetName);
  }

  // Get existing message IDs to prevent duplicates
  const existingIds = opts.dryRun
    ? new Set<string>()
    : await getExistingMessageIds(spreadsheetId, sheetName);

  let totalContacts = 0;
  let totalConversations = 0;
  let totalMessages = 0;
  let writtenMessages = 0;
  let skippedMessages = 0;

  // ── Single Contact Mode ─────────────────────────────────────────────────
  if (opts.contactId) {
    await processContact(opts.contactId);
  } else {
    // ── Bulk Mode — all contacts via conversations ──────────────────────
    console.log('[INFO] Fetching all conversations from source...');

    let startAfterDate: number | undefined;
    let pageNumber = 0;
    const processedContacts = new Set<string>();

    while (true) {
      pageNumber++;
      console.log(`\n[INFO] Page ${pageNumber}...`);

      const result = await searchConversations(sourceClient, config.source.locationId, {
        limit: 20,
        startAfterDate,
        startDate: opts.startDate,
        endDate: opts.endDate,
      });

      const conversations = result.conversations ?? [];
      if (conversations.length === 0) {
        console.log('[INFO] No more conversations.');
        break;
      }

      console.log(`[INFO] ${conversations.length} conversations found`);

      for (const conv of conversations) {
        if (!conv.contactId) continue;
        if (processedContacts.has(conv.contactId)) continue;

        processedContacts.add(conv.contactId);
        await processContact(conv.contactId);
        await sleep(DELAY_MS);
      }

      const last = conversations[conversations.length - 1];
      if (!last) break;
      const lastDate = last.lastMessageDate ?? last.dateAdded;
      if (!lastDate) break;
      const lastMs = new Date(lastDate).getTime();
      if (lastMs === startAfterDate) break;
      startAfterDate = lastMs;
      if (conversations.length < 20) break;
    }
  }

  // ── Final Summary ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  console.log(' EXPORT COMPLETE');
  console.log('═'.repeat(55));
  console.log(`  Contacts      : ${totalContacts}`);
  console.log(`  Conversations : ${totalConversations}`);
  console.log(`  Messages      : ${totalMessages}`);
  console.log(`  Written       : ${writtenMessages}`);
  console.log(`  Skipped       : ${skippedMessages} (duplicates/activity)`);
  console.log('═'.repeat(55));

  if (!opts.dryRun) {
    console.log(`\n✅ Open your sheet:`);
    console.log(`   https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  }

  // ── Process one contact ──────────────────────────────────────────────────
  async function processContact(contactId: string) {
    // Fetch contact details
    const contact = await getContact(sourceClient, contactId);
    const contactName = contact
      ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unknown'
      : 'Unknown';
    const email   = contact?.email   ?? '';
    const phone   = contact?.phone   ?? '';

    console.log(`\n[CONTACT] ${contactName} | ${email}`);
    totalContacts++;

    // Fetch all conversations for this contact
    const conversations = await findAllConversationsByContact(
      sourceClient,
      config.source.locationId,
      contactId
    );

    console.log(`[CONTACT] ${conversations.length} conversation(s)`);

    for (const conv of conversations) {
      totalConversations++;
      console.log(`[CONV] ${conv.id}`);

      // Fetch all messages
      const messages = await getAllMessages(sourceClient, conv.id);
      console.log(`[CONV] ${messages.length} messages`);
      totalMessages += messages.length;

      const rows: SheetRow[] = [];

      for (const msg of messages) {
        // Skip activity messages
        if (isActivityMessage(msg.messageType)) {
          skippedMessages++;
          continue;
        }

        // Skip already in sheet
        if (existingIds.has(msg.id)) {
          skippedMessages++;
          continue;
        }

        rows.push({
          contactName,
          email,
          phone,
          dateTime:       formatDate(msg.dateAdded),
          channel:        formatChannel(msg.messageType),
          direction:      msg.direction === 'inbound' ? 'Inbound' : 'Outbound',
          message:        msg.body ?? '',
          attachments:    (msg.attachments ?? []).join(', '),
          conversationId: conv.id,
          messageId:      msg.id,
        });

        existingIds.add(msg.id);
      }

      if (opts.dryRun) {
        console.log(`[DRY RUN] Would write ${rows.length} rows for this conversation`);
        writtenMessages += rows.length;
      } else if (rows.length > 0) {
        const written = await appendRows(spreadsheetId!, rows, sheetName);
        writtenMessages += written;
      }

      await sleep(DELAY_MS);
    }
  }
}

main().catch((err: unknown) => {
  console.error('[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
