/**
 * GHL Messages API wrappers.
 * Used for reading messages from Agency 1 → exporting to Google Sheet.
 */
import { AxiosInstance } from 'axios';
import { GhlMessage, GhlMessagesResponse } from './types';
import { withRetry } from './client';

// Activity messages are system-generated — skip them in export
const ACTIVITY_MESSAGE_TYPES = new Set([
  'TYPE_ACTIVITY_APPOINTMENT',
  'TYPE_ACTIVITY_CONTACT',
  'TYPE_ACTIVITY_INVOICE',
  'TYPE_ACTIVITY_PAYMENT',
  'TYPE_ACTIVITY_OPPORTUNITY',
  'TYPE_ACTIVITY_CONTACT_MERGED',
]);

export function isActivityMessage(messageType: string): boolean {
  return ACTIVITY_MESSAGE_TYPES.has(messageType);
}

/**
 * Fetch one page of messages for a conversation.
 */
export async function getMessagePage(
  client: AxiosInstance,
  conversationId: string,
  options: { lastMessageId?: string; limit?: number } = {}
): Promise<{ messages: GhlMessage[]; hasMore: boolean; lastMessageId?: string }> {
  const params: Record<string, unknown> = {
    limit: options.limit ?? 100,
  };
  if (options.lastMessageId) {
    params.lastMessageId = options.lastMessageId;
  }

  const response = await withRetry(() =>
    client.get<GhlMessagesResponse>(
      `/conversations/${conversationId}/messages`,
      { params }
    )
  );

  const data     = response.data.messages;
  const messages = data?.messages ?? [];
  const hasMore  = data?.nextPage ?? false;
  const lastId   = messages.length > 0 ? messages[messages.length - 1]?.id : undefined;

  return { messages, hasMore, lastMessageId: lastId };
}

/**
 * Fetch ALL messages for a conversation (auto-paginated).
 * Returns sorted oldest → newest.
 */
export async function getAllMessages(
  client: AxiosInstance,
  conversationId: string
): Promise<GhlMessage[]> {
  const allMessages: GhlMessage[] = [];
  let lastMessageId: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await getMessagePage(client, conversationId, { lastMessageId, limit: 100 });
    allMessages.push(...page.messages);
    hasMore        = page.hasMore;
    lastMessageId  = page.lastMessageId;
    if (page.messages.length === 0) break;
  }

  // Sort oldest first
  allMessages.sort(
    (a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime()
  );

  return allMessages;
}
