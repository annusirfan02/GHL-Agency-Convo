/**
 * csvExporter.ts
 *
 * GHL Agency 1 → CSV download
 *
 * Format: 1 contact = 1 row
 * Conversation = all messages in one cell, separated by " | "
 *
 * Columns:
 * Contact Name, Email, Phone, Channels, Total Messages,
 * First Message, Last Message, Conversation
 */
import { config } from '../config';
import { createGhlClient } from '../ghl/client';
import { getContact } from '../ghl/contacts';
import { searchConversations, findAllConversationsByContact } from '../ghl/conversations';
import { getAllMessages, isActivityMessage } from '../ghl/messages';

const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export interface ContactRow {
  contactName:   string;
  email:         string;
  phone:         string;
  channels:      string;
  totalMessages: number;
  firstMessage:  string;
  lastMessage:   string;
  conversation:  string;
}

const CHANNEL_MAP: Record<string, string> = {
  TYPE_SMS:            'SMS',
  TYPE_EMAIL:          'Email',
  TYPE_WHATSAPP:       'WhatsApp',
  TYPE_FACEBOOK:       'Facebook',
  TYPE_INSTAGRAM:      'Instagram',
  TYPE_GMB:            'Google My Business',
  TYPE_CALL:           'Call',
  TYPE_VOICEMAIL:      'Voicemail',
  TYPE_WEBCHAT:        'Web Chat',
  TYPE_LIVE_CHAT:      'Live Chat',
  TYPE_CAMPAIGN_SMS:   'Campaign SMS',
  TYPE_CAMPAIGN_EMAIL: 'Campaign Email',
  TYPE_CAMPAIGN_CALL:  'Campaign Call',
};

function formatChannel(t: string): string {
  return CHANNEL_MAP[t] ?? t.replace('TYPE_', '').replace(/_/g, ' ');
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

/**
 * Escape a CSV field:
 * - Wrap in quotes if contains comma, quote, or newline
 * - Double any internal quotes
 */
function csvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('|')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface ExportOptions {
  contactId?: string;
  startDate?: string;
  endDate?: string;
  dryRun?: boolean;
}

/**
 * Main export function.
 * Returns CSV string — caller streams it as a download.
 */
export async function generateCsv(options: ExportOptions = {}): Promise<string> {
  const dryRun = options.dryRun ?? false;
  const sourceClient = createGhlClient(config.source.accessToken);

  console.log('[CSV] Starting GHL → CSV export');
  console.log(`[CSV] Source: ${config.source.locationId}`);
  if (options.contactId) console.log(`[CSV] Single contact: ${options.contactId}`);
  if (dryRun) console.log('[CSV] DRY RUN mode');

  const rows: ContactRow[] = [];

  // ── Process one contact ──────────────────────────────────────────────────
  async function processContact(contactId: string): Promise<void> {
    const contact     = await getContact(sourceClient, contactId);
    const contactName = contact
      ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unknown'
      : 'Unknown';
    const email = contact?.email?.toLowerCase().trim() ?? '';
    const phone = contact?.phone ?? '';

    console.log(`[CSV] Contact: ${contactName} | ${email}`);

    const conversations = await findAllConversationsByContact(
      sourceClient,
      config.source.locationId,
      contactId
    );

    const messageParts: string[] = [];
    const channelSet = new Set<string>();
    let firstDate = '';
    let lastDate  = '';

    for (const conv of conversations) {
      const messages = await getAllMessages(sourceClient, conv.id);

      for (const msg of messages) {
        if (isActivityMessage(msg.messageType)) continue;

        const channel   = formatChannel(msg.messageType);
        const date      = formatDate(msg.dateAdded);
        const direction = msg.direction === 'inbound' ? 'Inbound' : 'Outbound';
        const body      = (msg.body ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '/').trim();

        messageParts.push(`[${date}] ${direction} ${channel}: ${body}`);
        channelSet.add(channel);

        if (!firstDate) firstDate = date;
        lastDate = date;
      }

      await sleep(DELAY_MS);
    }

    if (messageParts.length === 0) {
      console.log(`[CSV] No messages — skipping`);
      return;
    }

    rows.push({
      contactName,
      email,
      phone,
      channels:      Array.from(channelSet).join(', '),
      totalMessages: messageParts.length,
      firstMessage:  firstDate,
      lastMessage:   lastDate,
      conversation:  messageParts.join(' | '),
    });

    console.log(`[CSV] Added ${messageParts.length} messages for ${contactName}`);
  }

  // ── Single contact ───────────────────────────────────────────────────────
  if (options.contactId) {
    await processContact(options.contactId);
  } else {
    // ── Bulk ────────────────────────────────────────────────────────────
    const processed = new Set<string>();
    let startAfterDate: number | undefined;
    let page = 0;

    while (true) {
      page++;
      const result = await searchConversations(sourceClient, config.source.locationId, {
        limit: 20,
        startAfterDate,
        startDate: options.startDate,
        endDate:   options.endDate,
      });

      const convs = result.conversations ?? [];
      if (convs.length === 0) break;

      console.log(`[CSV] Page ${page}: ${convs.length} conversations`);

      for (const conv of convs) {
        if (!conv.contactId || processed.has(conv.contactId)) continue;
        processed.add(conv.contactId);
        await processContact(conv.contactId);
        await sleep(DELAY_MS);
      }

      const last = convs[convs.length - 1];
      if (!last) break;
      const lastDate = last.lastMessageDate ?? last.dateAdded;
      if (!lastDate) break;
      const lastMs = new Date(lastDate).getTime();
      if (lastMs === startAfterDate) break;
      startAfterDate = lastMs;
      if (convs.length < 20) break;
    }
  }

  // ── Build CSV string ─────────────────────────────────────────────────────
  const headers = [
    'Contact Name', 'Email', 'Phone', 'Channels',
    'Total Messages', 'First Message', 'Last Message', 'Conversation',
  ];

  const lines: string[] = [
    headers.map(csvField).join(','),
    ...rows.map(r => [
      csvField(r.contactName),
      csvField(r.email),
      csvField(r.phone),
      csvField(r.channels),
      csvField(r.totalMessages),
      csvField(r.firstMessage),
      csvField(r.lastMessage),
      csvField(r.conversation),
    ].join(',')),
  ];

  console.log(`\n[CSV] Done — ${rows.length} contacts, ${rows.reduce((s, r) => s + r.totalMessages, 0)} messages`);

  return lines.join('\n');
}
