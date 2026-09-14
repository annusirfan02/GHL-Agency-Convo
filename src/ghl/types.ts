/**
 * GHL API types derived from the official documentation.
 */

export interface GhlContact {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  customFields?: Array<{ id: string; value: string | string[] }>;
  additionalEmails?: string[];
  additionalPhones?: string[];
}

export interface GhlConversation {
  id: string;
  locationId: string;
  contactId: string;
  lastMessageDate?: string;
  dateAdded?: string;
  type?: number;
  unreadCount?: number;
  starred?: boolean;
  inbox?: boolean;
}

export interface GhlMessage {
  id: string;
  conversationId: string;
  locationId?: string;
  contactId?: string;
  body?: string;
  direction: 'inbound' | 'outbound';
  // Raw messageType from API uses TYPE_ prefix format
  // e.g. "TYPE_SMS", "TYPE_EMAIL", "TYPE_FACEBOOK", etc.
  messageType: string;
  type?: number;
  contentType?: string;
  dateAdded: string;
  status?: string;
  attachments?: string[];
  source?: string;
  userId?: string;
  from?: string;
  to?: string;
  // Call-specific
  callDuration?: number;
  callStatus?: string;
  // Email-specific
  subject?: string;
  threadId?: string;
  emailMessageId?: string;
}

// Webhook event types we handle (real-time)
export type GhlWebhookEventType = 'InboundMessage' | 'OutboundMessage';

export interface GhlMessageWebhookPayload {
  type: GhlWebhookEventType;
  locationId: string;
  messageId?: string;
  contactId: string;
  conversationId: string;
  body?: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  dateAdded: string;
  attachments?: string[];
  contentType?: string;
  status?: string;
  from?: string;
  to?: string;
  userId?: string;
  callDuration?: number;
  callStatus?: string;
  subject?: string;
  threadId?: string;
  emailMessageId?: string;
  webhookId?: string;
}

// Pagination response for conversations search
export interface GhlConversationSearchResponse {
  conversations: GhlConversation[];
  total: number;
}

// Pagination response for messages
export interface GhlMessagesResponse {
  messages: {
    messages: GhlMessage[];
    nextPage: boolean;
    lastMessageId?: string;
  };
}
