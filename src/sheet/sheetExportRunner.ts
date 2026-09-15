/**
 * sheetExportRunner.ts
 *
 * GHL Agency 1 → Google Sheet
 *
 * Format: 1 message = 1 row
 *
 * A            B              C      D                   E        F          G               H
 * Contact Name Email          Phone  Date & Time         Channel  Direction  Message         Attachments
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────
 * John Smith   john@test.com  +1555  Jan 10, 10:00 AM    SMS      Inbound    Hi
 * John Smith   john@test.com  +1555  Jan 10, 10:05 AM    SMS      Outbound   Hello!
 * John Smith   john@test.com  +1555  Jan 11, 09:00 AM    Email    Inbound    I need pricing
 */
import { config } from '../config';
import { createGhlClient } from '../ghl/client';
import { getContact } from '../ghl/contacts';
import { searchConversations, findAllConversationsByContact } from '../ghl/conversations';
import { getAllMessages, isActivityMessage } from '../ghl/messages';
import {
  ensureHeaders,
  getExistingRows,
  appendRows,
  formatChannel,
  formatDate,
  MessageRow,
} from './googleSheets';

const DELAY_MS = 300;

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
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
    ?? '1IjlAgHCIj0Iw4HjwT_pRTkmnO8SX9q2QdKlPAoGTII0';

  const sheetName = process.env.GOOGLE_SHEET_NAME ?? 'Sheet1';
  const dryRun    = options.dryRun ?? false;

  console.log('[EXPORT] GHL → Google Sheet Export');
  console.log(`[EXPORT] Source: ${config.source.locationId}`);
  console.log(`[EXPORT] Sheet: ${spreadsheetId} / ${sheetName}`);
  if (dryRun) console.log('[EXPORT] DRY RUN — nothing will be written');
  console.log('');

  const sourceClient = createGhlClient(config.source.accessToken);

  // Write headers if empty
  if (!dryRun) {
    await ensureHeaders(spreadsheetId, sheetName);
  }

  // Get existing rows to prevent duplicates
  const existingKeys = dryRun
    ? new Set<string>()
    : await getExistingRows(spreadsheetId, sheetName);

  let totalContacts      = 0;
  let totalConversations = 0;
  let totalMessages      = 0;
  let writtenRows        = 0;
  let skippedRows        = 0;

  // ── Process one contact ──────────────────────────────────────────────────
  async function processContact(contactId: string): Promise<void> {
    const contact     = await getContact(sourceClient, contactId);
    const contactName = contact
      ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unknown'
      : 'Unknown';
    const email = contact?.email?.toLowerCase().trim() ?? '';
    const phone = contact?.phone ?? '';

    console.log(`\n[CONTACT] ${contactName} | ${email}`);
    totalContacts++;

    // Get all conversations
    const conversations = await findAllConversationsByContact(
      sourceClient,
      config.source.locationId,
      contactId
    );

    console.log(`[CONTACT] ${conversations.length} conversation(s)`);
    totalConversations += conversations.length;

    const rows: MessageRow[] = [];

    for (const conv of conversations) {
      const messages = await getAllMessages(sourceClient, conv.id);
      console.log(`[CONV] ${conv.id} — ${messages.length} messages`);
      totalMessages += messages.length;

      for (const msg of messages) {
        // Skip activity messages
        if (isActivityMessage(msg.messageType)) {
          skippedRows++;
          continue;
        }

        const channel    = formatChannel(msg.messageType);
        const dateTime   = formatDate(msg.dateAdded);
        const direction  = msg.direction === 'inbound' ? 'Inbound' : 'Outbound';
        const message    = (msg.body ?? '').trim();
        const attachments = (msg.attachments ?? []).join(', ');

        // Dedup key
        const key = `${email}|${dateTime}|${direction}|${message.substring(0, 50)}`;
        if (existingKeys.has(key)) {
          skippedRows++;
          continue;
        }

        rows.push({
          contactName,
          email,
          phone,
          dateTime,
          channel,
          direction,
          message,
          attachments,
        });

        existingKeys.add(key);
      }

      await sleep(DELAY_MS);
    }

    if (dryRun) {
      console.log(`[DRY RUN] Would write ${rows.length} rows for ${contactName}`);
      if (rows.length > 0) {
        rows.slice(0, 3).forEach(r =>
          console.log(`          [${r.dateTime}] ${r.direction} ${r.channel}: ${r.message.substring(0, 60)}`)
        );
        if (rows.length > 3) console.log(`          ... and ${rows.length - 3} more`);
      }
      writtenRows += rows.length;
    } else if (rows.length > 0) {
      const written = await appendRows(spreadsheetId!, rows, sheetName);
      writtenRows += written;
      console.log(`[CONTACT] Written ${written} rows to sheet ✅`);
    }
  }

  // ── Single contact mode ──────────────────────────────────────────────────
  if (options.contactId) {
    await processContact(options.contactId);
  } else {
    // ── Bulk mode ────────────────────────────────────────────────────────
    console.log('[EXPORT] Fetching all conversations...');
    const processedContacts = new Set<string>();
    let startAfterDate: number | undefined;
    let pageNumber = 0;

    while (true) {
      pageNumber++;
      console.log(`\n[EXPORT] Page ${pageNumber}...`);

      const result = await searchConversations(sourceClient, config.source.locationId, {
        limit: 20,
        startAfterDate,
        startDate: options.startDate,
        endDate:   options.endDate,
      });

      const conversations = result.conversations ?? [];
      if (conversations.length === 0) {
        console.log('[EXPORT] No more conversations.');
        break;
      }

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

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  console.log(' EXPORT COMPLETE');
  console.log('═'.repeat(55));
  console.log(`  Contacts      : ${totalContacts}`);
  console.log(`  Conversations : ${totalConversations}`);
  console.log(`  Messages      : ${totalMessages}`);
  console.log(`  Written rows  : ${writtenRows}`);
  console.log(`  Skipped       : ${skippedRows}`);
  console.log('═'.repeat(55));

  if (!dryRun && writtenRows > 0) {
    console.log(`\n✅ https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  }
}
