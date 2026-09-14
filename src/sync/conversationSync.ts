/**
 * conversationSync.ts
 *
 * Finds or creates a destination conversation for a given destination contact.
 */
import prisma from '../db/prisma';
import { config } from '../config';
import { destFindConversation, destCreateConversation } from '../ghl/destination';
import { GhlConversation } from '../ghl/types';

export interface ConversationSyncResult {
  destinationConversation: GhlConversation;
  wasCreated: boolean;
}

/**
 * Sync a conversation mapping from source to destination.
 *
 * Flow:
 * 1. Check DB cache
 * 2. Search destination for existing conversation by contactId
 * 3. Create if not found
 * 4. Save mapping
 */
export async function syncConversation(
  sourceConversationId: string,
  sourceContactId: string,
  destinationContactId: string
): Promise<ConversationSyncResult> {
  // 1. Check DB cache
  const cached = await prisma.conversationMapping.findUnique({
    where: { sourceConversationId },
  });

  if (cached) {
    console.log(
      `[CONVERSATION] Cache hit: ${sourceConversationId} → ${cached.destinationConversationId}`
    );
    return {
      destinationConversation: {
        id: cached.destinationConversationId,
        locationId: config.destination.locationId,
        contactId: destinationContactId,
      },
      wasCreated: false,
    };
  }

  // 2. Search destination for existing conversation
  console.log(`[CONVERSATION] Searching destination for contact ${destinationContactId}`);
  const existing = await destFindConversation(destinationContactId);

  let destinationConversation: GhlConversation;
  let wasCreated = false;

  if (existing) {
    console.log(`[CONVERSATION] Destination conversation found: ${existing.id}`);
    destinationConversation = existing;
  } else {
    console.log(`[CONVERSATION] Not found — creating destination conversation`);
    destinationConversation = await destCreateConversation(destinationContactId);
    console.log(`[CONVERSATION] Created: ${destinationConversation.id}`);
    wasCreated = true;
  }

  // 3. Save mapping
  await prisma.conversationMapping.create({
    data: {
      sourceConversationId,
      destinationConversationId: destinationConversation.id,
      sourceContactId,
      destinationContactId,
    },
  });

  return { destinationConversation, wasCreated };
}
