/**
 * GHL Contacts API wrappers.
 * Only getContact is needed for CSV export.
 */
import { AxiosInstance } from 'axios';
import { GhlContact } from './types';
import { withRetry } from './client';

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

