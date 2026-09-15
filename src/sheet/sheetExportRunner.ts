/**
 * sheetExportRunner.ts
 *
 * GHL Agency 1 → Google Sheet
 *
 * Format: 1 contact = 1 row
 * Column D = all messages in one cell, line by line:
 *   [Jan 10, 10:00 AM] Inbound SMS: Hi
 *   [Jan 10, 10:05 AM] Outbound SMS: Hello
 */
import { config } from '../config';
import { createGhlClient } from '../ghl/client';
import { getContact } from '../ghl/contacts';
import { searchConversations, findAllConversationsByContact } from '../ghl/conversations';
import { getAllMessages, isActivityMessage } from '../ghl/messages';
import {
  ensureHeaders,
  getExistingEmails,
  appendContactRows,
  formatChannel,
  formatDate,
  ContactSheetRow,
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

  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID is not set');

  const sheetName = process.env.GOOGLE_SHEET_NAME ?? 'Sheet1';
  const dryRun    = options.dryRun ?? false;

  console.log('[EXPORT] GHL → Google Sheet Export');
  console.log(`[EXPORT] Source location: ${config.source.locationId}`);
  console.log(`[EXPORT] Sheet: ${spreadsheetId} / tab: ${sheetName}`);
  if (dryRun) console.log('[EXPORT] DRY RUN — nothing will be written');
  console.log('');

  const sourceClient = createGhlClient(config.source.accessToken);

  // Write headers if sheet is empty
  if (!dryRun) {
    await ensureHeaders(spreadsheetId, sheetName);
  }

  // Get already-exported emails to avoid duplicates
  const existingEmails = dryRun
    ? new Set<string>()
    : await getExistingEmails(spreadsheetId, sheetName);

  let totalContacts      = 0;
  let totalConversations = 0;
  let totalMessages      = 0;
  let writtenContacts    = 0;
  let skippedContacts    = 0;

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

    // Skip if already in sheet
    if (email && existingEmails.has(email)) {
      console.log(`[CONTACT] Already exported — skipping`);
      skippedContacts++;
      return;
    }

    // Get all conversations for this contact
    const conversations = await findAllConversationsByContact(
      sourceClient,
      config.source.locationId,
      contactId
    );

    console.log(`[CONTACT] ${conversations.length} conversation(s)`);
    totalConversations += conversations.length;

    // Collect all messages across all conversations
    const allMessageLines: string[] = [];
    const channelSet = new Set<string>();
    let firstDate = '';
    let lastDate  = '';

    for (const conv of conversations) {
      const messages = await getAllMessages(sourceClient, conv.id);
      console.log(`[CONV] ${conv.id} — ${messages.length} messages`);
      totalMessages += messages.length;

      for (const msg of messages) {
        if (isActivityMessage(msg.messageType)) continue;

        const channel        = formatChannel(msg.messageType);
        const date           = formatDate(msg.dateAdded);
        const direction      = msg.direction === 'inbound' ? 'Inbound' : 'Outbound';
        const body           = (msg.body ?? '').replace(/\n/g, ' ').trim();
        const hasAttachment  = (msg.attachments ?? []).length > 0;

        let line = `[${date}] ${direction} ${channel}: ${body}`;
        if (hasAttachment) line += ' 📎';

        allMessageLines.push(line);
        channelSet.add(channel);

        if (!firstDate) firstDate = date;
        lastDate = date;
      }

      await sleep(DELAY_MS);
    }

    if (allMessageLines.length === 0) {
      console.log(`[CONTACT] No messages — skipping`);
      skippedContacts++;
      return;
    }

    // Build row — truncate conversation if too long (Google Sheets limit: 50000 chars)
    const fullConversation = allMessageLines.join('\n');
    const MAX_CHARS = 49000;
    const conversation = fullConversation.length > MAX_CHARS
      ? fullConversation.substring(0, MAX_CHARS) + '\n... [truncated — too many messages]'
      : fullConversation;

    const row: ContactSheetRow = {
      contactName,
      email,
      phone,
      conversation,
      channelsUsed:  Array.from(channelSet).join(', '),
      totalMessages: allMessageLines.length,
      firstMessage:  firstDate,
      lastMessage:   lastDate,
    };

    if (dryRun) {
      console.log(`[DRY RUN] Would write 1 row for ${contactName}`);
      console.log(`[DRY RUN] Messages: ${allMessageLines.length} | Channels: ${row.channelsUsed}`);
      allMessageLines.slice(0, 3).forEach(l => console.log(`          ${l}`));
      if (allMessageLines.length > 3) {
        console.log(`          ... and ${allMessageLines.length - 3} more`);
      }
      writtenContacts++;
    } else {
      await appendContactRows(spreadsheetId!, [row], sheetName);
      if (email) existingEmails.add(email);
      writtenContacts++;
      console.log(`[CONTACT] Written to sheet ✅`);
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

      console.log(`[EXPORT] ${conversations.length} conversations`);

      for (const conv of conversations) {
        if (!conv.contactId) continue;
        if (processedContacts.has(conv.contactId)) continue;
        processedContacts.add(conv.contactId);
        await processContact(conv.contactId);
        await sleep(DELAY_MS);
      }

      const last     = conversations[conversations.length - 1];
      if (!last) break;
      const lastDate = last.lastMessageDate ?? last.dateAdded;
      if (!lastDate) break;
      const lastMs   = new Date(lastDate).getTime();
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
  console.log(`  Written       : ${writtenContacts}`);
  console.log(`  Skipped       : ${skippedContacts}`);
  console.log(`  Conversations : ${totalConversations}`);
  console.log(`  Messages      : ${totalMessages}`);
  console.log('═'.repeat(55));

  if (!dryRun && writtenContacts > 0) {
    console.log(`\n✅ https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  }
}
