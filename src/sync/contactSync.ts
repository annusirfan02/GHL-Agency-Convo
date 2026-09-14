/**
 * contactSync.ts
 *
 * Finds or creates a destination contact for a given source contact.
 * Uses a local DB mapping cache to avoid redundant API calls.
 */
import prisma from '../db/prisma';
import { config } from '../config';
import { sourceGetContactById } from '../ghl/source';
import { destLookupContactByEmail, destCreateContact } from '../ghl/destination';
import { GhlContact } from '../ghl/types';

export interface ContactSyncResult {
  sourceContact: GhlContact;
  destinationContact: GhlContact;
  wasCreated: boolean;
}

/**
 * Sync a contact from source to destination.
 *
 * Flow:
 * 1. Check DB cache (source_contact_id → dest_contact_id)
 * 2. Fetch source contact to get email
 * 3. Search destination by email (scoped to destination location only)
 * 4. Use existing contact or create new one
 * 5. Save mapping
 */
export async function syncContact(sourceContactId: string): Promise<ContactSyncResult> {
  // 1. Check DB cache
  const cached = await prisma.contactMapping.findFirst({
    where: { sourceContactId },
  });

  if (cached) {
    console.log(`[CONTACT] Cache hit: ${sourceContactId} → ${cached.destinationContactId}`);
    const sourceContact = await sourceGetContactById(sourceContactId);
    if (!sourceContact) {
      throw new Error(`Source contact ${sourceContactId} not found in GHL`);
    }
    return {
      sourceContact,
      destinationContact: { id: cached.destinationContactId, locationId: config.destination.locationId },
      wasCreated: false,
    };
  }

  // 2. Fetch full source contact
  const sourceContact = await sourceGetContactById(sourceContactId);
  if (!sourceContact) {
    throw new Error(`Source contact ${sourceContactId} not found in source subaccount`);
  }

  const email = sourceContact.email?.toLowerCase().trim();
  if (!email) {
    throw new Error(`Source contact ${sourceContactId} has no email — cannot sync without email`);
  }

  console.log(`[CONTACT] Searching email: ${email}`);

  // 3. Search destination by email (destination location only)
  const existing = await destLookupContactByEmail(email);

  let destinationContact: GhlContact;
  let wasCreated = false;

  if (existing) {
    console.log(`[CONTACT] Existing destination contact found: ${existing.id}`);
    destinationContact = existing;
  } else {
    // 4. Create in destination — copy all supported fields
    console.log(`[CONTACT] Not found — creating in destination`);
    destinationContact = await destCreateContact({
      firstName:    sourceContact.firstName,
      lastName:     sourceContact.lastName,
      email,
      phone:        sourceContact.phone,
      tags:         sourceContact.tags,
      customFields: sourceContact.customFields,
    });
    console.log(`[CONTACT] Created destination contact: ${destinationContact.id}`);
    wasCreated = true;
  }

  // 5. Save mapping
  await prisma.contactMapping.upsert({
    where: { email },
    create: {
      email,
      sourceContactId:       sourceContact.id,
      destinationContactId:  destinationContact.id,
      sourceLocationId:      config.source.locationId,
      destinationLocationId: config.destination.locationId,
    },
    update: {
      destinationContactId: destinationContact.id,
      sourceContactId:      sourceContact.id,
    },
  });

  return { sourceContact, destinationContact, wasCreated };
}
