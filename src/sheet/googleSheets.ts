/**
 * googleSheets.ts
 * 
 * Google Sheets API wrapper.
 * Uses Service Account authentication — no OAuth browser flow needed.
 */
import { google, sheets_v4 } from 'googleapis';

// Column headers for the sheet
export const SHEET_HEADERS = [
  'Contact Name',
  'Email',
  'Phone',
  'Date & Time',
  'Channel',
  'Direction',
  'Message',
  'Attachments',
  'Conversation ID',
  'Message ID',
];

export interface SheetRow {
  contactName: string;
  email: string;
  phone: string;
  dateTime: string;
  channel: string;
  direction: string;
  message: string;
  attachments: string;
  conversationId: string;
  messageId: string;
}

function getAuthClient() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set');
  }

  const credentials = JSON.parse(credentialsJson);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * Get or create the header row in the sheet.
 * If sheet is empty, writes headers first.
 */
export async function ensureHeaders(spreadsheetId: string, sheetName = 'Sheet1'): Promise<void> {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const range = `${sheetName}!A1:J1`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const existingValues = response.data.values;

  // Only write headers if first row is empty
  if (!existingValues || existingValues.length === 0 || !existingValues[0] || existingValues[0].length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [SHEET_HEADERS],
      },
    });
    console.log('[SHEET] Headers written');
  }
}

/**
 * Get all existing Message IDs from the sheet to prevent duplicates.
 */
export async function getExistingMessageIds(
  spreadsheetId: string,
  sheetName = 'Sheet1'
): Promise<Set<string>> {
  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    // Column J = Message ID (index 9)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!J2:J`,
    });

    const values = response.data.values ?? [];
    const ids = new Set<string>();

    for (const row of values) {
      if (row[0]) ids.add(row[0]);
    }

    console.log(`[SHEET] Found ${ids.size} existing message IDs`);
    return ids;
  } catch {
    return new Set<string>();
  }
}

/**
 * Append rows to the sheet in batches.
 * Batch size = 500 rows at a time to stay within API limits.
 */
export async function appendRows(
  spreadsheetId: string,
  rows: SheetRow[],
  sheetName = 'Sheet1'
): Promise<number> {
  if (rows.length === 0) return 0;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const values = rows.map(row => [
    row.contactName,
    row.email,
    row.phone,
    row.dateTime,
    row.channel,
    row.direction,
    row.message,
    row.attachments,
    row.conversationId,
    row.messageId,
  ]);

  // Batch into groups of 500
  const BATCH_SIZE = 500;
  let totalWritten = 0;

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:J`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: batch },
    });

    totalWritten += batch.length;
    console.log(`[SHEET] Written ${totalWritten}/${values.length} rows`);

    // Small delay between batches
    if (i + BATCH_SIZE < values.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return totalWritten;
}

/**
 * Format a raw message type string into a readable channel name.
 */
export function formatChannel(messageType: string): string {
  const map: Record<string, string> = {
    TYPE_SMS:             'SMS',
    TYPE_EMAIL:           'Email',
    TYPE_WHATSAPP:        'WhatsApp',
    TYPE_FACEBOOK:        'Facebook',
    TYPE_INSTAGRAM:       'Instagram',
    TYPE_GMB:             'Google My Business',
    TYPE_CALL:            'Call',
    TYPE_VOICEMAIL:       'Voicemail',
    TYPE_WEBCHAT:         'Web Chat',
    TYPE_LIVE_CHAT:       'Live Chat',
    TYPE_CAMPAIGN_SMS:    'Campaign SMS',
    TYPE_CAMPAIGN_EMAIL:  'Campaign Email',
    TYPE_CAMPAIGN_CALL:   'Campaign Call',
  };
  return map[messageType] ?? messageType.replace('TYPE_', '').replace(/_/g, ' ');
}

/**
 * Format ISO date string to readable format.
 */
export function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoDate;
  }
}
