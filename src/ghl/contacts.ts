/**
 * GHL Contacts API wrappers.
 */
import { AxiosInstance } from 'axios';
import { GhlContact } from './types';
import { withRetry } from './client';

/**
 * Look up a contact by exact email, scoped to a specific location.
 * Returns the first matching contact, or null.
 */
export async function lookupContactByEmail(
  client: AxiosInstance,
  locationId: string,
  email: string
): Promise<GhlContact | null> {
  const normalizedEmail = email.toLowerCase().trim();

  const response = await withRetry(() =>
    client.get<{ contacts: GhlContact[]; nextCursor?: string }>('/contacts/lookup', {
      params: { locationId, email: normalizedEmail, limit: 1 },
    })
  );

  const contacts = response.data.contacts;
  return (contacts && contacts.length > 0) ? contacts[0] ?? null : null;
}

/**
 * Get a contact by its ID.
 */
export async function getContact(
  client: AxiosInstance,
  contactId: string
): Promise<GhlContact | null> {
  try {
    const response = await withRetry(() =>
      client.get<{ contact: GhlContact }>(`/contacts/${contactId}`)
    );
    return response.data.contact ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a new contact in a location.
 * Copies all supported fields from the source contact.
 */
export async function createContact(
  client: AxiosInstance,
  locationId: string,
  data: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    customFields?: Array<{ id: string; value: string | string[] }>;
  }
): Promise<GhlContact> {
  const body: Record<string, unknown> = {
    locationId,
    email: data.email?.toLowerCase().trim(),
  };

  if (data.firstName) body.firstName = data.firstName;
  if (data.lastName)  body.lastName  = data.lastName;
  if (data.phone)     body.phone     = data.phone;

  // Copy tags if present — ignore errors from unsupported tags
  if (data.tags && data.tags.length > 0) {
    body.tags = data.tags;
  }

  // Copy custom fields if present — individual field failures are non-fatal
  if (data.customFields && data.customFields.length > 0) {
    body.customFields = data.customFields;
  }

  const response = await withRetry(() =>
    client.post<{ contact: GhlContact }>('/contacts/', body)
  );

  return response.data.contact;
}

