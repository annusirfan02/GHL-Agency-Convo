/**
 * GHL API types — read-only export to CSV.
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
}

export interface GhlConversation {
  id: string;
  locationId: string;
  contactId: string;
  lastMessageDate?: string;
  dateAdded?: string;
}

export interface GhlMessage {
  id: string;
  conversationId: string;
  body?: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  dateAdded: string;
  attachments?: string[];
  from?: string;
  to?: string;
  callStatus?: string;
}

export interface GhlConversationSearchResponse {
  conversations: GhlConversation[];
  total: number;
}

export interface GhlMessagesResponse {
  messages: {
    messages: GhlMessage[];
    nextPage: boolean;
    lastMessageId?: string;
  };
}
