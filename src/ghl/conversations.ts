/**
 * GHL Conversations API wrappers.
 * Only search and findAll are needed for CSV export.
 */
import { AxiosInstance } from 'axios';
import { GhlConversation, GhlConversationSearchResponse } from './types';
import { withRetry } from './client';

/**
 * Search/paginate conversations in a location.
 */
export async function searchConversations(
  client: AxiosInstance,
  locationId: string,
  options: {
    limit?: number;
    startAfterDate?: number;
    startDate?: string;
    endDate?: string;
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
 * One contact can have multiple conversations (SMS, Email, WhatsApp, FB, etc.)
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

