# Railway Deployment Guide

## Step 1 — GitHub pe Code Upload karo

```bash
git init
git add .
git commit -m "Initial commit"
```

GitHub pe naya repository banao (github.com → New Repository)
Phir:
```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

---

## Step 2 — Railway Account

1. railway.app pe jao
2. "Login with GitHub" karo
3. Free account ban jayega

---

## Step 3 — PostgreSQL Database banao

1. Railway dashboard mein: **"New Project"** click karo
2. **"Add a Service"** → **"Database"** → **"PostgreSQL"** select karo
3. Database create ho jayegi — 30 seconds

---

## Step 4 — Apna App Deploy karo

1. Same project mein: **"Add a Service"** → **"GitHub Repo"**
2. Apna repository select karo
3. Railway automatically detect karega Node.js app

---

## Step 5 — Environment Variables set karo

App service pe click karo → **"Variables"** tab → Add karo:

```
SOURCE_GHL_ACCESS_TOKEN      = your_source_token
SOURCE_GHL_LOCATION_ID       = your_source_location_id
DESTINATION_GHL_ACCESS_TOKEN = your_destination_token
DESTINATION_GHL_LOCATION_ID  = your_destination_location_id
VERIFY_WEBHOOK_SIGNATURE     = false
```

DATABASE_URL automatically set hoti hai Railway se — khud mat likhna.

---

## Step 6 — DATABASE_URL link karo

1. App service → **"Variables"** tab
2. **"Add Variable Reference"** click karo
3. PostgreSQL service ki `DATABASE_URL` select karo

---

## Step 7 — Deploy ho jayega

Railway automatically:
- `npm run build` chalayega (TypeScript compile)
- `node dist/server.js` start karega
- Database migrations run karega on startup

Logs dekho: App service → **"Logs"** tab

---

## Step 8 — Historical Sync Trigger karo

Deploy hone ke baad, Railway app ka URL milega (e.g. `https://your-app.railway.app`)

### Option A — Test karo (ek conversation):
```bash
curl -X POST https://your-app.railway.app/sync \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "YOUR_SOURCE_CONVERSATION_ID", "dryRun": true}'
```

### Option B — Dry run (kuch likhega nahi, sirf dekhega):
```bash
curl -X POST https://your-app.railway.app/sync \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

### Option C — Full historical sync:
```bash
curl -X POST https://your-app.railway.app/sync \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Option D — Date filter ke saath:
```bash
curl -X POST https://your-app.railway.app/sync \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2026-01-01", "endDate": "2026-09-14"}'
```

Sync Railway **Logs** mein chalti rahegi. Browser band kar sakte ho — Railway server pe chalta rahega.

---

## Step 9 — Real-time Webhook (optional)

Agar aage bhi new messages sync karne hain:

GHL Agency 1 → Source Subaccount → Settings → Webhooks:
```
URL: https://your-app.railway.app/webhooks/ghl
Events: InboundMessage, OutboundMessage
```

---

## Health Check

```
GET https://your-app.railway.app/health
Response: { "status": "ok", "timestamp": "..." }
```

---

## Pricing

Railway Free Tier:
- $5 credit har mahine free
- PostgreSQL + Node.js dono ke liye kaafi hai
- Historical sync ke liye toh bilkul kaafi hai
