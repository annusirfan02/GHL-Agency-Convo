import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optionalEnv(key: string): string {
  return process.env[key] ?? '';
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),

  source: {
    accessToken: requireEnv('SOURCE_GHL_ACCESS_TOKEN'),
    locationId:  requireEnv('SOURCE_GHL_LOCATION_ID'),
  },

  // Destination is optional — only needed for GHL→GHL sync
  destination: {
    accessToken: optionalEnv('DESTINATION_GHL_ACCESS_TOKEN'),
    locationId:  optionalEnv('DESTINATION_GHL_LOCATION_ID'),
  },

  verifyWebhookSignature: process.env.VERIFY_WEBHOOK_SIGNATURE === 'true',

  googleSheet: {
    spreadsheetId: optionalEnv('GOOGLE_SHEET_ID'),
    sheetName:     process.env.GOOGLE_SHEET_NAME ?? 'Sheet1',
  },
};
