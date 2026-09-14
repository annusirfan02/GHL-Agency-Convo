/**
 * Pre-configured GHL API client and helpers for the SOURCE subaccount.
 */
import { config } from '../config';
import { createGhlClient } from './client';
import { lookupContactByEmail, getContact } from './contacts';
import { searchConversations, findAllConversationsByContact } from './conversations';
import { getAllMessages } from './messages';
import { GhlContact, GhlMessage, GhlConversation, GhlConversationSearchResponse } from './types';

const sourceClient = createGhlClient(config.source.accessToken);

export async function sourceGetContactById(contactId: string): Promise<GhlContact | null> {
  return getContact(sourceClient, contactId);
}

export async function sourceLookupContactByEmail(email: string): Promise<GhlContact | null> {
  return lookupContactByEmail(sourceClient, config.source.locationId, email);
}

export async function sourceSearchConversations(options: {
  limit?: number;
  startAfterDate?: number;
  startDate?: string;
  endDate?: string;
}): Promise<GhlConversationSearchResponse> {
  return searchConversations(sourceClient, config.source.locationId, options);
}

export async function sourceGetAllConversationsForContact(contactId: string): Promise<GhlConversation[]> {
  return findAllConversationsByContact(sourceClient, config.source.locationId, contactId);
}

export async function sourceGetAllMessages(conversationId: string): Promise<GhlMessage[]> {
  return getAllMessages(sourceClient, conversationId);
}
