/**
 * ghlWebhook.ts
 *
 * Express route handler for real-time GHL webhook events.
 * Handles InboundMessage and OutboundMessage from the source location only.
 *
 * This is the real-time complement to the historical sync CLI.
 * Both use the same contactSync / conversationSync / messageSync logic.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { GhlMessageWebhookPayload } from '../ghl/types';
import { syncContact } from '../sync/contactSync';
import { syncConversation } from '../sync/conversationSync';
import { syncMessage } from '../sync/messageSync';
import { GhlMessage } from '../ghl/types';

const router = Router();

// ── GHL public keys for webhook signature verification ───────────────────────
// Source: https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide
const GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const GHL_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

function verifyGhlSignature(rawBody: string, headers: Request['headers']): boolean {
  const ghlSig    = headers['x-ghl-signature'] as string | undefined;
  const legacySig = headers['x-wh-signature']  as string | undefined;

  if (ghlSig) {
    try {
      return crypto.verify(
        null,
        Buffer.from(rawBody, 'utf8'),
        GHL_ED25519_PUBLIC_KEY,
        Buffer.from(ghlSig, 'base64')
      );
    } catch { return false; }
  }

  if (legacySig) {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(rawBody);
      return verifier.verify(GHL_RSA_PUBLIC_KEY, legacySig, 'base64');
    } catch { return false; }
  }

  return false;
}

/**
 * POST /webhooks/ghl
 *
 * Responds 200 immediately, then processes asynchronously.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  // Always acknowledge immediately to prevent GHL retries
  res.status(200).json({ success: true });

  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
  const payload = req.body as GhlMessageWebhookPayload;

  // Verify signature if enabled
  if (config.verifyWebhookSignature) {
    if (!verifyGhlSignature(rawBody, req.headers)) {
      console.warn('[WEBHOOK] Invalid signature — ignoring');
      return;
    }
  }

  // Only handle message events
  if (payload.type !== 'InboundMessage' && payload.type !== 'OutboundMessage') {
    return;
  }

  // Location guard — only process source location events
  if (payload.locationId !== config.source.locationId) {
    console.log(`[WEBHOOK] Ignoring event from location ${payload.locationId}`);
    return;
  }

  const sourceMessageId = payload.messageId;
  if (!sourceMessageId) {
    console.warn('[WEBHOOK] No messageId in payload — skipping');
    return;
  }

  console.log(`[SYNC] New message received — type: ${payload.messageType}, id: ${sourceMessageId}`);

  // Process async (response already sent)
  processAsync(payload, sourceMessageId).catch((err: unknown) => {
    console.error('[ERROR] Unhandled webhook sync error:', (err as Error).message);
  });
});

async function processAsync(
  payload: GhlMessageWebhookPayload,
  sourceMessageId: string
): Promise<void> {
  try {
    // Step 1: Contact
    const { sourceContact, destinationContact } = await syncContact(payload.contactId);

    // Step 2: Conversation
    const { destinationConversation } = await syncConversation(
      payload.conversationId,
      sourceContact.id,
      destinationContact.id
    );

    // Step 3: Message — build a GhlMessage from the webhook payload
    const messageRecord: GhlMessage = {
      id:              sourceMessageId,
      conversationId:  payload.conversationId,
      contactId:       payload.contactId,
      body:            payload.body,
      direction:       payload.direction,
      messageType:     payload.messageType,
      dateAdded:       payload.dateAdded,
      attachments:     payload.attachments,
      callStatus:      payload.callStatus,
      from:            payload.from,
      to:              payload.to,
    };

    const result = await syncMessage(
      messageRecord,
      payload.conversationId,
      destinationConversation.id,
      destinationContact.id,
      false // not a dry run
    );

    if (result.status === 'synced') {
      console.log(`[SYNC] Completed for message ${sourceMessageId}`);
    } else {
      console.log(`[SYNC] Message ${sourceMessageId} — ${result.status}: ${result.reason}`);
    }
  } catch (err: unknown) {
    console.error('[ERROR] Message synchronization failed:', (err as Error).message);
  }
}

export default router;
