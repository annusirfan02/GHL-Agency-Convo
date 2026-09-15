/**
 * googleSheets.ts
 *
 * Google Sheets API wrapper.
 * Format: 1 message = 1 row
 */
import { google } from 'googleapis';

export const SHEET_HEADERS = [
  'Contact Name',   // A
  'Email',          // B
  'Phone',          // C
  'Date & Time',    // D
  'Channel',        // E
  'Direction',      // F
  'Message',        // G
  'Attachments',    // H
];

export interface MessageRow {
  contactName:  string;
  email:        string;
  phone:        string;
  dateTime:     string;
  channel:      string;
  direction:    string;
  message:      string;
  attachments:  string;
}

function getAuthClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(json),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

/**
 * Write headers if sheet is empty.
 */
export async function ensureHeaders(
  spreadsheetId: string,
  sheetName = 'Sheet1'
): Promise<void> {
  const auth   = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:H1`,
  });

  const existing = res.data.values;
  if (!existing || existing.length === 0 || !existing[0] || existing[0].length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADERS] },
    });
    console.log('[SHEET] Headers written');
  }
}

/**
 * Get all existing Message IDs to prevent duplicates.
 * We use Email+DateTime+Direction as a unique key stored in a hidden column,
 * or simply track by row count. Here we use email+dateTime combination.
 */
export async function getExistingRows(
  spreadsheetId: string,
  sheetName = 'Sheet1'
): Promise<Set<string>> {
  const auth   = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    // Read Email (B) + Date (D) + Direction (F) columns to build dedup key
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!B2:H`,
    });

    const values = res.data.values ?? [];
    const keys   = new Set<string>();

    for (const row of values) {
      const email     = row[0] ?? '';
      const date      = row[2] ?? '';
      const direction = row[4] ?? '';
      const message   = (row[5] ?? '').substring(0, 50);
      if (email && date) {
        keys.add(`${email}|${date}|${direction}|${message}`);
      }
    }

    console.log(`[SHEET] Found ${keys.size} existing rows`);
    return keys;
  } catch {
    return new Set<string>();
  }
}

/**
 * Append message rows in batches of 500.
 */
export async function appendRows(
  spreadsheetId: string,
  rows: MessageRow[],
  sheetName = 'Sheet1'
): Promise<number> {
  if (rows.length === 0) return 0;

  const auth   = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const values = rows.map(r => [
    r.contactName,
    r.email,
    r.phone,
    r.dateTime,
    r.channel,
    r.direction,
    r.message,
    r.attachments,
  ]);

  const BATCH = 500;
  let written = 0;

  for (let i = 0; i < values.length; i += BATCH) {
    const batch = values.slice(i, i + BATCH);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:H`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: batch },
    });
    written += batch.length;
    console.log(`[SHEET] Written ${written}/${values.length} rows`);

    if (i + BATCH < values.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return written;
}

/**
 * Format message type to readable channel name.
 */
export function formatChannel(messageType: string): string {
  const map: Record<string, string> = {
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
  return map[messageType] ?? messageType.replace('TYPE_', '').replace(/_/g, ' ');
}

/**
 * Format ISO date to readable string.
 */
export function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString('en-US', {
      year:   'numeric',
      month:  'short',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoDate;
  }
}
