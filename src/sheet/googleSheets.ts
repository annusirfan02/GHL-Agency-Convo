/**
 * googleSheets.ts
 *
 * Google Sheets API wrapper.
 * Format: 1 contact = 1 row
 *         All messages in one cell (column D)
 */
import { google } from 'googleapis';

// Column headers
export const SHEET_HEADERS = [
  'Contact Name',     // A
  'Email',            // B
  'Phone',            // C
  'Conversation',     // D — all messages in one cell
  'Channels Used',    // E
  'Total Messages',   // F
  'First Message',    // G
  'Last Message',     // H
];

export interface ContactSheetRow {
  contactName:    string;
  email:          string;
  phone:          string;
  conversation:   string;  // all messages combined in one cell
  channelsUsed:   string;  // e.g. "SMS, Email, WhatsApp"
  totalMessages:  number;
  firstMessage:   string;  // date of first message
  lastMessage:    string;  // date of last message
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
 * Write headers if sheet is empty.
 */
export async function ensureHeaders(
  spreadsheetId: string,
  sheetName = 'Sheet1'
): Promise<void> {
  const auth   = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:H1`,
  });

  const existing = response.data.values;
  if (!existing || existing.length === 0 || !existing[0] || existing[0].length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADERS] },
    });

    // Bold the header row
    const sheetId = await getSheetId(spreadsheetId, sheetName);
    if (sheetId !== null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 },
                  },
                },
                fields: 'userEnteredFormat(textFormat,backgroundColor)',
              },
            },
          ],
        },
      });
    }

    console.log('[SHEET] Headers written');
  }
}

/**
 * Get existing emails from column B to prevent duplicate contacts.
 */
export async function getExistingEmails(
  spreadsheetId: string,
  sheetName = 'Sheet1'
): Promise<Set<string>> {
  const auth   = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!B2:B`,
    });

    const values = response.data.values ?? [];
    const emails = new Set<string>();
    for (const row of values) {
      if (row[0]) emails.add(row[0].toLowerCase().trim());
    }

    console.log(`[SHEET] Found ${emails.size} existing contacts`);
    return emails;
  } catch {
    return new Set<string>();
  }
}

/**
 * Append contact rows to the sheet.
 * Each contact = 1 row, conversation in one cell with line breaks.
 */
export async function appendContactRows(
  spreadsheetId: string,
  rows: ContactSheetRow[],
  sheetName = 'Sheet1'
): Promise<number> {
  if (rows.length === 0) return 0;

  const auth   = getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth });

  const values = rows.map(row => [
    row.contactName,
    row.email,
    row.phone,
    row.conversation,     // multi-line cell
    row.channelsUsed,
    row.totalMessages,
    row.firstMessage,
    row.lastMessage,
  ]);

  // Use USER_ENTERED so newlines (\n) render as line breaks in cells
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:H`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  // Set row height and wrap text for the conversation column
  const sheetId = await getSheetId(spreadsheetId, sheetName);
  if (sheetId !== null) {
    // Get current last row number to apply formatting
    const currentData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:A`,
    });
    const lastRow = (currentData.data.values?.length ?? 1);
    const startRow = lastRow - rows.length;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Wrap text in conversation column (D = index 3)
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: startRow,
                endRowIndex: lastRow,
                startColumnIndex: 3,
                endColumnIndex: 4,
              },
              cell: {
                userEnteredFormat: {
                  wrapStrategy: 'WRAP',
                  verticalAlignment: 'TOP',
                },
              },
              fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)',
            },
          },
        ],
      },
    });
  }

  console.log(`[SHEET] Written ${rows.length} contact row(s)`);
  return rows.length;
}

async function getSheetId(
  spreadsheetId: string,
  sheetName: string
): Promise<number | null> {
  try {
    const auth   = getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = response.data.sheets?.find(
      s => s.properties?.title === sheetName
    );
    return sheet?.properties?.sheetId ?? null;
  } catch {
    return null;
  }
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
