/**
 * historicalSync.ts
 *
 * Core engine for historical conversation migration.
 * Supports: contactId, conversationId, bulk, date filters, dry-run.
 */
import prisma from '../db/prisma';
import { config } from '../config';
import { sourceSearchConversations, sourceGetAllMessages } from '../ghl/source';
import { createGhlClient } from '../ghl/client';
import { findConversationByContact } from '../ghl/conversations';
import { GhlConversation } from '../ghl/types';
import { syncContact } from './contactSync';
import { syncConversation } from './conversationSync';
import { syncMessage } from './messageSync';

const CONVERSATION_DELAY_MS = 300;
const MESSAGE_DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface SyncOptions {
  startDate?: string;
  endDate?: string;
  contactId?: string;
  conversationId?: string;
  dryRun?: boolean;
  limit?: number;
}

export interface SyncSummary {
  totalConversations: number;
  processedConversations: number;
  skippedConversations: number;
  failedConversations: number;
  totalMessages: number;
  syncedMessages: number;
  skippedMessages: number;
  failedMessages: number;
}

export async function runHistoricalSync(options: SyncOptions = {}): Promise<SyncSummary> {
  const summary: SyncSummary = {
    totalConversations: 0,
    processedConversations: 0,
    skippedConversations: 0,
    failedConversations: 0,
    totalMessages: 0,
    syncedMessages: 0,
    skippedMessages: 0,
    failedMessages: 0,
  };

  const dryRun = options.dryRun ?? false;
  if (dryRun) console.log('[DRY RUN] No changes will be written.');

  // ── Mode 1: Contact ID ────────────────────────────────────────────────────
  if (options.contactId) {
    console.log(`[INFO] Contact ID mode: ${options.contactId}`);

    const sourceClient = createGhlClient(config.source.accessToken);
    const conversation = await findConversationByContact(
      sourceClient,
      config.source.locationId,
      options.contactId
    );

    if (!conversation) {
      console.log(`[INFO] No conversation found for contact ${options.contactId}`);
      printSummary(summary);
      return summary;
    }

    console.log(`[INFO] Found conversation: ${conversation.id}`);
    summary.totalConversations++;
    await processSingleConversation(conversation.id, summary, dryRun, conversation);
    printSummary(summary);
    return summary;
  }

  // ── Mode 2: Single Conversation ID ───────────────────────────────────────
  if (options.conversationId) {
    console.log(`[INFO] Single conversation mode: ${options.conversationId}`);
    summary.totalConversations++;
    await processSingleConversation(options.conversationId, summary, dryRun);
    printSummary(summary);
    return summary;
  }

  // ── Mode 3: Bulk ──────────────────────────────────────────────────────────
  console.log(`[INFO] Bulk sync — source: ${config.source.locationId}`);
  console.log(`[INFO] Destination: ${config.destination.locationId}`);
  if (options.startDate) console.log(`[INFO] Start date: ${options.startDate}`);
  if (options.endDate)   console.log(`[INFO] End date:   ${options.endDate}`);

  let startAfterDate: number | undefined;
  let pageNumber = 0;
  const pageSize = options.limit ?? 20;

  while (true) {
    pageNumber++;
    console.log(`\n[INFO] Fetching page ${pageNumber}...`);

    const result = await sourceSearchConversations({
      limit: pageSize,
      startAfterDate,
      startDate: options.startDate,
      endDate: options.endDate,
    });

    const conversations = result.conversations ?? [];
    if (conversations.length === 0) {
      console.log('[INFO] No more conversations. Done.');
      break;
    }

    console.log(`[INFO] Page ${pageNumber}: ${conversations.length} conversations (total: ${result.total})`);

    for (const conversation of conversations) {
      summary.totalConversations++;
      await processSingleConversation(conversation.id, summary, dryRun, conversation);
      await sleep(CONVERSATION_DELAY_MS);
    }

    const last = conversations[conversations.length - 1];
    if (!last) break;

    const lastDate = last.lastMessageDate ?? last.dateAdded;
    if (!lastDate) break;

    const lastMs = new Date(lastDate).getTime();
    if (lastMs === startAfterDate) break;
    startAfterDate = lastMs;

    if (conversations.length < pageSize) break;
  }

  printSummary(summary);
  return summary;
}

async function processSingleConversation(
  sourceConversationId: string,
  summary: SyncSummary,
  dryRun: boolean,
  conversationHint?: GhlConversation
): Promise<void> {
  console.log(`\n[INFO] Source conversation: ${sourceConversationId}`);

  // Skip already completed
  const progress = await prisma.syncProgress.findUnique({
    where: { sourceConversationId },
  });

  if (progress?.status === 'completed') {
    console.log(`[INFO] Already completed — skipping`);
    summary.skippedConversations++;
    return;
  }

  if (!dryRun) {
    await prisma.syncProgress.upsert({
      where: { sourceConversationId },
      create: {
        sourceConversationId,
        sourceContactId: conversationHint?.contactId ?? '',
        status: 'in_progress',
        startedAt: new Date(),
      },
      update: { status: 'in_progress', startedAt: new Date() },
    });
  }

  try {
    const contactId = conversationHint?.contactId;
    if (!contactId) throw new Error('Conversation has no contactId');

    // Step 1: Contact
    const { sourceContact, destinationContact } = await syncContact(contactId);
    console.log(`[INFO] Contact email: ${sourceContact.email}`);
    console.log(`[INFO] Destination contact: ${destinationContact.id}`);

    // Step 2: Conversation
    const { destinationConversation } = await syncConversation(
      sourceConversationId,
      sourceContact.id,
      destinationContact.id
    );
    console.log(`[INFO] Destination conversation: ${destinationConversation.id}`);

    // Step 3: Messages
    console.log(`[INFO] Fetching historical messages...`);
    const messages = await sourceGetAllMessages(sourceConversationId);
    console.log(`[INFO] Historical messages found: ${messages.length}`);

    summary.totalMessages += messages.length;

    let syncedCount = 0, skippedCount = 0, failedCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;

      const result = await syncMessage(
        msg,
        sourceConversationId,
        destinationConversation.id,
        destinationContact.id,
        dryRun
      );

      if (result.status === 'synced') {
        syncedCount++;
        summary.syncedMessages++;
        console.log(dryRun
          ? `[DRY RUN] Message ${i + 1}/${messages.length} — would sync (${msg.messageType})`
          : `[SYNC] Message ${i + 1}/${messages.length} — synced`
        );
      } else if (result.status === 'skipped') {
        skippedCount++;
        summary.skippedMessages++;
        console.log(`[SYNC] Message ${i + 1}/${messages.length} — skipped: ${result.reason}`);
      } else {
        failedCount++;
        summary.failedMessages++;
        console.error(`[ERROR] Message ${i + 1}/${messages.length} — failed: ${result.reason}`);
      }

      if (!dryRun) await sleep(MESSAGE_DELAY_MS);
    }

    console.log(`[INFO] Done. Synced: ${syncedCount} | Skipped: ${skippedCount} | Failed: ${failedCount}`);

    if (!dryRun) {
      await prisma.syncProgress.update({
        where: { sourceConversationId },
        data: {
          status: failedCount > 0 ? 'failed' : 'completed',
          totalMessages: messages.length,
          syncedMessages: syncedCount,
          skippedMessages: skippedCount,
          failedMessages: failedCount,
          completedAt: new Date(),
        },
      });
    }

    summary.processedConversations++;

  } catch (err) {
    const reason = (err as Error).message;
    console.error(`[ERROR] Conversation ${sourceConversationId} failed: ${reason}`);

    if (!dryRun) {
      await prisma.syncProgress.update({
        where: { sourceConversationId },
        data: { status: 'failed', errorReason: reason },
      }).catch(() => {});
    }

    summary.failedConversations++;
  }
}

function printSummary(summary: SyncSummary): void {
  console.log('\n' + '═'.repeat(55));
  console.log(' SYNC COMPLETE');
  console.log('═'.repeat(55));
  console.log(`  Conversations — Processed: ${summary.processedConversations} | Skipped: ${summary.skippedConversations} | Failed: ${summary.failedConversations}`);
  console.log(`  Messages      — Synced: ${summary.syncedMessages} | Skipped: ${summary.skippedMessages} | Failed: ${summary.failedMessages}`);
  console.log('═'.repeat(55));
}
