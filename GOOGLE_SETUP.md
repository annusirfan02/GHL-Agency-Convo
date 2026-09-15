# Google Sheets Setup Guide

## Step 1 — Google Cloud Project banao

1. console.cloud.google.com pe jao
2. Login karo (Google account se)
3. Upar "Select a project" → "New Project"
4. Name: `ghl-sheet-export`
5. "Create" click karo

---

## Step 2 — Google Sheets API enable karo

1. Left menu → "APIs & Services" → "Library"
2. Search: `Google Sheets API`
3. Click karo → "Enable" click karo

---

## Step 3 — Service Account banao

1. Left menu → "APIs & Services" → "Credentials"
2. "+ Create Credentials" → "Service Account"
3. Name: `ghl-exporter`
4. "Create and Continue" → "Done"
5. Service account pe click karo (list mein)
6. "Keys" tab → "Add Key" → "Create New Key"
7. "JSON" select karo → "Create"
8. JSON file download ho jayegi — SAVE KARO

---

## Step 4 — Sheet ke saath share karo

1. Downloaded JSON file kholo
2. `client_email` field copy karo — kuch aisa:
   `ghl-exporter@ghl-sheet-export.iam.gserviceaccount.com`
3. Apni Google Sheet kholo
4. "Share" button click karo
5. Woh email paste karo
6. Permission: "Editor"
7. "Send" click karo

---

## Step 5 — Sheet ID nikalo

Sheet URL se:
```
https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
                                       ─────────────
                                       Yeh copy karo
```

---

## Step 6 — Railway Variables set karo

### GOOGLE_SHEET_ID
```
Value: tumhara sheet ID (Step 5 se)
```

### GOOGLE_SHEET_NAME
```
Value: Sheet1  (ya jo bhi tab ka naam hai)
```

### GOOGLE_SERVICE_ACCOUNT_JSON
```
JSON file ka poora content paste karo — ek line mein

Example:
{"type":"service_account","project_id":"ghl-sheet-export","private_key_id":"abc","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"ghl-exporter@...","client_id":"...","auth_uri":"...","token_uri":"..."}
```

---

## Step 7 — Export trigger karo

Railway deploy ke baad:

### Single contact test:
```json
POST /export
{
  "contactId": "WQ8VBX4NkDBuTmAyquFC",
  "dryRun": true
}
```

### Real export:
```json
POST /export
{
  "contactId": "WQ8VBX4NkDBuTmAyquFC"
}
```

### Sab contacts:
```json
POST /export
{}
```

---

## Sheet Format

| Contact Name | Email | Phone | Date & Time | Channel | Direction | Message | Attachments | Conversation ID | Message ID |
|---|---|---|---|---|---|---|---|---|---|
| John Smith | john@test.com | +1555 | Jan 10, 2026 10:00 AM | SMS | Inbound | Hi | | conv_123 | msg_456 |
| John Smith | john@test.com | +1555 | Jan 10, 2026 10:05 AM | SMS | Outbound | Hello! | | conv_123 | msg_457 |
