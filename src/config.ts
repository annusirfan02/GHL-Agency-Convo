import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),

  source: {
    accessToken: requireEnv('SOURCE_GHL_ACCESS_TOKEN'),
    locationId:  requireEnv('SOURCE_GHL_LOCATION_ID'),
  },

  destination: {
    accessToken: requireEnv('DESTINATION_GHL_ACCESS_TOKEN'),
    locationId:  requireEnv('DESTINATION_GHL_LOCATION_ID'),
  },

  verifyWebhookSignature: process.env.VERIFY_WEBHOOK_SIGNATURE === 'true',
};
