# GHL Conversation Sync

Private backend automation that syncs conversations from one GoHighLevel subaccount to another in real-time.

## What it does

- Receives `InboundMessage` / `OutboundMessage` webhooks from your **Source** GHL subaccount
- Finds the contact's email in the **Destination** subaccount (scoped strictly to that location)
- Creates the contact in Destination if they don't exist yet
- Finds or creates the Destination conversation
- Stores the message as a CRM record in the Destination conversation (body, direction, timestamp, channel type preserved)
- Prevents all duplicate syncs using a PostgreSQL mapping table

## What it does NOT do

- Does NOT re-deliver messages via SMS/Email (it stores them as CRM records, not live sends)
- Does NOT touch any location other than the two configured ones
- Has no UI, dashboard, or user management

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Two GHL subaccounts with **Private Integration tokens** (easiest) or OAuth tokens

## Setup

### 1. Clone and install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
SOURCE_GHL_ACCESS_TOKEN=pit_xxxx        # Private Integration Token from Agency 1 sub-account
SOURCE_GHL_LOCATION_ID=abc123           # The source sub-account location ID

DESTINATION_GHL_ACCESS_TOKEN=pit_yyyy   # Private Integration Token from Agency 2 sub-account
DESTINATION_GHL_LOCATION_ID=def456      # The destination sub-account location ID

DATABASE_URL="postgresql://user:pass@localhost:5432/ghl_sync"

PORT=3000
VERIFY_WEBHOOK_SIGNATURE=false          # Set to true in production
```

**Where to get Private Integration Tokens:**
Go to your GHL sub-account → Settings → Integrations → Private Integrations → Create new integration → copy the token.

### 3. Set up the database

```bash
npm run db:push        # Create tables (development)
# OR
npm run db:migrate     # Run migrations (production)
npm run db:generate    # Regenerate Prisma client after schema changes
```

### 4. Run

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

### 5. Configure GHL webhooks

In each GHL agency's **Marketplace** or sub-account settings, set the webhook URL to:

```
https://your-server.com/webhooks/ghl
```

Subscribe to these events on the **Source** sub-account:
- `InboundMessage`
- `OutboundMessage`

The server ignores events from any location other than `SOURCE_GHL_LOCATION_ID`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{ "status": "ok" }` |
| `POST` | `/webhooks/ghl` | GHL webhook receiver |

## Project Structure

```
src/
  config.ts                  — Environment variable loading
  server.ts                  — Express server entry point
  ghl/
    client.ts                — Axios wrapper with retry logic
    types.ts                 — GHL API type definitions
    contacts.ts              — Contact lookup/create API calls
    conversations.ts         — Conversation find/create API calls
    messages.ts              — Message add API calls
    source.ts                — Source subaccount client
    destination.ts           — Destination subaccount client
  sync/
    contactSync.ts           — Contact sync with DB caching
    conversationSync.ts      — Conversation sync with DB caching
    messageSync.ts           — Message sync with dedup
  webhooks/
    ghlWebhook.ts            — Webhook route handler
  db/
    prisma.ts                — Prisma client singleton
prisma/
  schema.prisma              — DB schema (contact/conversation/message mappings)
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `contact_mappings` | Maps source contact IDs to destination contact IDs by email |
| `conversation_mappings` | Maps source conversation IDs to destination conversation IDs |
| `message_mappings` | Tracks synced messages to prevent duplicates |

## GHL API Limitations (important)

The `POST /conversations/messages/inbound` endpoint stores messages as **CRM records** in the destination conversation. This is what a sync tool should do. What it cannot do:

- **Re-deliver via SMS/Email**: Synced messages are CRM history records, not live outbound messages to the contact's phone/inbox
- **Historical bulk import**: This tool is designed for real-time sync. For historical sync, you'd need to call the source `GET /conversations/{id}/messages` endpoint and replay each message through `syncMessage()` manually

## Rate Limits

GHL allows 100 requests per 10 seconds, 200,000 per day per app per location. The built-in retry logic handles 429s automatically.
