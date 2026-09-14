/**
 * Pre-configured GHL API client and helpers for the DESTINATION subaccount.
 */
import { config } from '../config';
import { createGhlClient } from './client';
import { lookupContactByEmail, createContact } from './contacts';
import { findConversationByContact, createConversation } from './conversations';
import { addMessageToConversation, InboundMessagePayload } from './messages';
import { GhlContact, GhlConversation } from './types';

const destClient = createGhlClient(config.destination.accessToken);

export async function destLookupContactByEmail(email: string): Promise<GhlContact | null> {
  return lookupContactByEmail(destClient, config.destination.locationId, email);
}

export async function destCreateContact(data: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  customFields?: Array<{ id: string; value: string | string[] }>;
}): Promise<GhlContact> {
  return createContact(destClient, config.destination.locationId, data);
}

export async function destFindConversation(contactId: string): Promise<GhlConversation | null> {
  return findConversationByContact(destClient, config.destination.locationId, contactId);
}

export async function destCreateConversation(contactId: string): Promise<GhlConversation> {
  return createConversation(destClient, config.destination.locationId, contactId);
}

export async function destAddMessage(
  payload: InboundMessagePayload
): Promise<{ messageId: string; conversationId: string }> {
  return addMessageToConversation(destClient, payload);
}
