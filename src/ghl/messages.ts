/**
 * GHL Messages API wrappers.
 */
import { AxiosInstance } from 'axios';
import { GhlMessage, GhlMessagesResponse } from './types';
import { withRetry } from './client';

// Message types that are system-generated activity records.
// These cannot be replicated via the inbound message API.
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
 * Fetch a page of messages for a conversation.
 * Uses cursor-based pagination via lastMessageId.
 *
 * Returns { messages, hasMore, lastMessageId }
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

  const data = response.data.messages;
  const messages = data?.messages ?? [];
  const hasMore = data?.nextPage ?? false;
  const lastId = messages.length > 0 ? messages[messages.length - 1]?.id : undefined;

  return { messages, hasMore, lastMessageId: lastId };
}

/**
 * Fetch ALL messages for a conversation, paginating automatically.
 * Sorted oldest → newest (as returned by the API).
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
    hasMore = page.hasMore;
    lastMessageId = page.lastMessageId;

    if (page.messages.length === 0) break; // safety guard
  }

  // Sort oldest first so we replay in chronological order
  allMessages.sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

  return allMessages;
}

/**
 * Map a source messageType (TYPE_SMS, TYPE_EMAIL, etc.) to the type string
 * accepted by POST /conversations/messages/inbound.
 *
 * Supported inbound API types: SMS, Email, WhatsApp, GMB, IG, FB, Custom, WebChat, Live_Chat, Call
 *
 * Returns null for activity messages that cannot be replicated.
 */
export function mapMessageTypeForInbound(messageType: string): string | null {
  if (isActivityMessage(messageType)) return null;

  const mapping: Record<string, string> = {
    TYPE_SMS:            'SMS',
    TYPE_EMAIL:          'Email',
    TYPE_WHATSAPP:       'WhatsApp',
    TYPE_GMB:            'GMB',
    TYPE_INSTAGRAM:      'IG',
    TYPE_FACEBOOK:       'FB',
    TYPE_WEBCHAT:        'WebChat',
    TYPE_LIVE_CHAT:      'Live_Chat',
    TYPE_CALL:           'Call',
    TYPE_VOICEMAIL:      'Call',
    TYPE_SMS_REVIEW_REQUEST:  'SMS',
    TYPE_CAMPAIGN_SMS:        'SMS',
    TYPE_CAMPAIGN_EMAIL:      'Email',
    TYPE_CAMPAIGN_CALL:       'Call',
    TYPE_CAMPAIGN_VOICEMAIL:  'Call',
    TYPE_CAMPAIGN_FACEBOOK:   'FB',
  };

  return mapping[messageType] ?? 'Custom';
}

export interface InboundMessagePayload {
  conversationId: string;
  contactId: string;
  message: string;
  type: string;
  direction: 'inbound' | 'outbound';
  date: string;
  attachments?: string[];
  call?: { to: string; from: string; status: string };
}

/**
 * Insert a historical message into a destination conversation as a CRM record.
 *
 * IMPORTANT: This does NOT send the message to the contact via SMS/Email.
 * It only stores it as a CRM history record. Original direction and timestamp
 * are preserved.
 */
export async function addMessageToConversation(
  client: AxiosInstance,
  payload: InboundMessagePayload
): Promise<{ messageId: string; conversationId: string }> {
  const body: Record<string, unknown> = {
    type: payload.type,
    conversationId: payload.conversationId,
    contactId: payload.contactId,
    message: payload.message ?? '',
    direction: payload.direction,
    date: payload.date,
    conversationProviderId: '',
  };

  if (payload.attachments && payload.attachments.length > 0) {
    body.attachments = payload.attachments;
  }

  if (payload.call) {
    body.call = payload.call;
  }

  const response = await withRetry(() =>
    client.post<{
      success: boolean;
      conversationId: string;
      messageId: string;
      contactId: string;
      dateAdded: string;
    }>('/conversations/messages/inbound', body)
  );

  return {
    messageId: response.data.messageId,
    conversationId: response.data.conversationId,
  };
}

