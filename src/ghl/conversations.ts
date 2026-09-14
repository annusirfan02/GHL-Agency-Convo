/**
 * GHL Conversations API wrappers.
 */
import { AxiosInstance } from 'axios';
import { GhlConversation, GhlConversationSearchResponse } from './types';
import { withRetry } from './client';

/**
 * Search/paginate conversations in a location.
 * Uses startAfterDate for cursor-based pagination over large result sets.
 */
export async function searchConversations(
  client: AxiosInstance,
  locationId: string,
  options: {
    limit?: number;
    startAfterDate?: number;  // epoch ms — last document's sort value
    startDate?: string;       // ISO date filter
    endDate?: string;         // ISO date filter
  } = {}
): Promise<GhlConversationSearchResponse> {
  const params: Record<string, unknown> = {
    locationId,
    limit: options.limit ?? 20,
    sortBy: 'last_message_date',
    sort: 'asc',
    status: 'all',
  };

  if (options.startAfterDate) {
    params.startAfterDate = options.startAfterDate;
  }

  const response = await withRetry(() =>
    client.get<GhlConversationSearchResponse>('/conversations/search', { params })
  );

  return response.data;
}

/**
 * Find ALL conversations for a contact in a specific location.
 * A contact can have multiple conversations (SMS, Email, WhatsApp, FB, etc.)
 */
export async function findAllConversationsByContact(
  client: AxiosInstance,
  locationId: string,
  contactId: string
): Promise<GhlConversation[]> {
  const response = await withRetry(() =>
    client.get<GhlConversationSearchResponse>('/conversations/search', {
      params: {
        locationId,
        contactId,
        limit: 20,
        sortBy: 'last_message_date',
        sort: 'asc',
        status: 'all',
      },
    })
  );

  return response.data.conversations ?? [];
}

/**
 * Find the most recent conversation for a contact in a specific location.
 */
export async function findConversationByContact(
  client: AxiosInstance,
  locationId: string,
  contactId: string
): Promise<GhlConversation | null> {
  const conversations = await findAllConversationsByContact(client, locationId, contactId);
  return conversations.length > 0 ? conversations[0] ?? null : null;
}

/**
 * Create a new conversation for a contact in a location.
 */
export async function createConversation(
  client: AxiosInstance,
  locationId: string,
  contactId: string
): Promise<GhlConversation> {
  const response = await withRetry(() =>
    client.post<{ success: boolean; conversation: GhlConversation }>('/conversations/', {
      locationId,
      contactId,
    })
  );

  return response.data.conversation;
}

