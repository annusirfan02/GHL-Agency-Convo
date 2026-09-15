/**
 * sheetExportRunner.ts
 *
 * Called by server.ts /export endpoint.
 * Runs the same logic as exportToSheet.ts but as a function (not a CLI script).
 */
import { config } from '../config';
import { createGhlClient } from '../ghl/client';
import { getContact } from '../ghl/contacts';
import { searchConversations, findAllConversationsByContact } from '../ghl/conversations';
import { getAllMessages, isActivityMessage } from '../ghl/messages';
import {
  ensureHeaders,
  getExistingMessageIds,
  appendRows,
  formatChannel,
  formatDate,
  SheetRow,
} from './googleSheets';

const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export interface ExportOptions {
  contactId?: string;
  startDate?: string;
  endDate?: string;
  dryRun?: boolean;
}

export async function runSheetExport(options: ExportOptions = {}): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID is not set');

  const sheetName = process.env.GOOGLE_SHEET_NAME ?? 'Sheet1';
  const dryRun    = options.dryRun ?? false;

  console.log('[EXPORT] Starting GHL → Google Sheet export');
  console.log(`[EXPORT] Source location: ${config.source.locationId}`);
  console.log(`[EXPORT] Sheet: ${spreadsheetId} / ${sheetName}`);
  if (dryRun) console.log('[EXPORT] DRY RUN — nothing will be written');

  const sourceClient = createGhlClient(config.source.accessToken);

  if (!dryRun) await ensureHeaders(spreadsheetId, sheetName);

  const existingIds = dryRun
    ? new Set<string>()
    : await getExistingMessageIds(spreadsheetId, sheetName);

  let totalContacts = 0, totalConversations = 0;
  let totalMessages = 0, writtenMessages = 0, skippedMessages = 0;

  async function processContact(contactId: string) {
    const contact     = await getContact(sourceClient, contactId);
    const contactName = contact
      ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unknown'
      : 'Unknown';
    const email = contact?.email ?? '';
    const phone = contact?.phone ?? '';

    console.log(`\n[CONTACT] ${contactName} | ${email}`);
    totalContacts++;

    const conversations = await findAllConversationsByContact(
      sourceClient,
      config.source.locationId,
      contactId
    );

    console.log(`[CONTACT] ${conversations.length} conversation(s)`);

    for (const conv of conversations) {
      totalConversations++;
      const messages = await getAllMessages(sourceClient, conv.id);
      console.log(`[CONV] ${conv.id} — ${messages.length} messages`);
      totalMessages += messages.length;

      const rows: SheetRow[] = [];

      for (const msg of messages) {
        if (isActivityMessage(msg.messageType)) { skippedMessages++; continue; }
        if (existingIds.has(msg.id))            { skippedMessages++; continue; }

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

      if (dryRun) {
        console.log(`[DRY RUN] Would write ${rows.length} rows`);
        writtenMessages += rows.length;
      } else if (rows.length > 0) {
        const written = await appendRows(spreadsheetId!, rows, sheetName);
        writtenMessages += written;
      }

      await sleep(DELAY_MS);
    }
  }

  if (options.contactId) {
    await processContact(options.contactId);
  } else {
    const processedContacts = new Set<string>();
    let startAfterDate: number | undefined;
    let pageNumber = 0;

    while (true) {
      pageNumber++;
      const result = await searchConversations(sourceClient, config.source.locationId, {
        limit: 20,
        startAfterDate,
        startDate: options.startDate,
        endDate: options.endDate,
      });

      const conversations = result.conversations ?? [];
      if (conversations.length === 0) break;

      console.log(`\n[EXPORT] Page ${pageNumber}: ${conversations.length} conversations`);

      for (const conv of conversations) {
        if (!conv.contactId || processedContacts.has(conv.contactId)) continue;
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

  console.log('\n' + '═'.repeat(55));
  console.log(' EXPORT COMPLETE');
  console.log('═'.repeat(55));
  console.log(`  Contacts      : ${totalContacts}`);
  console.log(`  Conversations : ${totalConversations}`);
  console.log(`  Messages      : ${totalMessages}`);
  console.log(`  Written       : ${writtenMessages}`);
  console.log(`  Skipped       : ${skippedMessages}`);
  console.log('═'.repeat(55));
}
