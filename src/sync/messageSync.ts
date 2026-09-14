/**
 * messageSync.ts
 *
 * Syncs a single historical message from source to destination.
 * Idempotent — safe to re-run multiple times.
 */
import prisma from '../db/prisma';
import { destAddMessage } from '../ghl/destination';
import { GhlMessage } from '../ghl/types';
import { mapMessageTypeForInbound, isActivityMessage } from '../ghl/messages';

export type MessageSyncStatus = 'synced' | 'skipped' | 'failed';

export interface MessageSyncResult {
  status: MessageSyncStatus;
  destinationMessageId?: string;
  reason?: string;
}

/**
 * Sync one historical message into the destination conversation.
 *
 * What happens:
 * - Activity messages (appointment, invoice, etc.) are skipped — they cannot be replicated
 * - Messages already in message_mappings are skipped (dedup)
 * - All other messages are inserted as CRM records via POST /conversations/messages/inbound
 *   with original direction and timestamp preserved
 * - Does NOT send any real SMS/Email to the contact
 */
export async function syncMessage(
  sourceMessage: GhlMessage,
  sourceConversationId: string,
  destinationConversationId: string,
  destinationContactId: string,
  dryRun = false
): Promise<MessageSyncResult> {
  const sourceMessageId = sourceMessage.id;

  // 1. Skip activity messages — system records, cannot be replicated
  if (isActivityMessage(sourceMessage.messageType)) {
    if (!dryRun) {
      await saveMapping(sourceMessageId, null, sourceConversationId, destinationConversationId, 'skipped', 'activity message');
    }
    return { status: 'skipped', reason: `activity message (${sourceMessage.messageType})` };
  }

  // 2. Check dedup
  const existing = await prisma.messageMapping.findUnique({
    where: { sourceMessageId },
  });
  if (existing) {
    return {
      status: existing.status === 'synced' ? 'skipped' : (existing.status as MessageSyncStatus),
      destinationMessageId: existing.destinationMessageId ?? undefined,
      reason: 'already processed',
    };
  }

  // 3. Map message type
  const mappedType = mapMessageTypeForInbound(sourceMessage.messageType);
  if (!mappedType) {
    if (!dryRun) {
      await saveMapping(sourceMessageId, null, sourceConversationId, destinationConversationId, 'skipped', `unsupported type: ${sourceMessage.messageType}`);
    }
    return { status: 'skipped', reason: `unsupported type: ${sourceMessage.messageType}` };
  }

  if (dryRun) {
    return { status: 'synced', reason: 'dry run — not written' };
  }

  // 4. Build call payload if applicable
  let call: { to: string; from: string; status: string } | undefined;
  if ((sourceMessage.messageType === 'TYPE_CALL' || sourceMessage.messageType === 'TYPE_VOICEMAIL')
      && sourceMessage.from && sourceMessage.to) {
    call = {
      from: sourceMessage.from,
      to: sourceMessage.to,
      status: sourceMessage.callStatus ?? 'completed',
    };
  }

  try {
    // 5. Insert into destination CRM — does NOT send to customer
    const result = await destAddMessage({
      conversationId: destinationConversationId,
      contactId: destinationContactId,
      message: sourceMessage.body ?? '',
      type: mappedType,
      direction: sourceMessage.direction,
      date: sourceMessage.dateAdded,
      attachments: sourceMessage.attachments,
      call,
    });

    // 6. Save mapping
    await saveMapping(
      sourceMessageId,
      result.messageId,
      sourceConversationId,
      destinationConversationId,
      'synced'
    );

    return { status: 'synced', destinationMessageId: result.messageId };
  } catch (err) {
    const reason = (err as Error).message;
    console.error(`[ERROR] Failed to sync message ${sourceMessageId}: ${reason}`);

    // Save failed mapping so we know it needs retry
    await saveMapping(sourceMessageId, null, sourceConversationId, destinationConversationId, 'failed', reason);

    return { status: 'failed', reason };
  }
}

async function saveMapping(
  sourceMessageId: string,
  destinationMessageId: string | null,
  sourceConversationId: string,
  destinationConversationId: string,
  status: string,
  errorReason?: string
): Promise<void> {
  await prisma.messageMapping.upsert({
    where: { sourceMessageId },
    create: {
      sourceMessageId,
      destinationMessageId: destinationMessageId ?? undefined,
      sourceConversationId,
      destinationConversationId,
      status,
      errorReason,
    },
    update: {
      destinationMessageId: destinationMessageId ?? undefined,
      status,
      errorReason,
    },
  });
}
