# Notion Integration Setup

## Overview
This integration allows Notion to serve as a deal intake system for OM Intelligence. When files are uploaded to Notion's "Deal Intake" database, they trigger automatic analysis through the OM Intelligence API.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          NOTION                                  │
│  ┌──────────────┐  Upload OM  ┌──────────────┐                 │
│  │ Deal Intake  │ ──────────▶ │   Webhook    │ ──┐              │
│  │  Database    │             │   (n8n/      │   │              │
│  └──────────────┘             │   make.com)  │   │              │
│                               └──────────────┘   │              │
└──────────────────────────────────────────────────┼──────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OM INTELLIGENCE API                            │
│  ┌──────────────┐        POST /api/documents/upload             │
│  │   Upload     │ ◀───────────────────────────────────────────  │
│  │   Handler    │                                              │
│  └──────┬───────┘                                              │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐  Process  ┌──────────────┐                   │
│  │  Document    │ ────────▶ │   Analysis   │                   │
│  │  Pipeline    │           │   Engine     │                   │
│  └──────┬───────┘           └──────┬───────┘                   │
│         │                          │                            │
│         │  Write Back              │                            │
│         │  Results                 │                            │
│         ▼                          ▼                            │
│  ┌──────────────┐              ┌──────────────┐                 │
│  │    Notion    │              │   Database   │                 │
│  │  Write-Back  │─────────────▶│   Storage    │                 │
│  │   Service    │              │              │                 │
│  └──────────────┘              └──────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

### Deal Intake Database

```json
{
  "title": "Deal Intake",
  "properties": {
    "Property Address": { "type": "title" },
    "Deal Type": { 
      "type": "select",
      "options": ["Acquisition", "Disposition", "Refinance"]
    },
    "Upload OM": { "type": "files" },
    "Status": {
      "type": "select",
      "options": ["Pending", "Processing", "Analyzed", "Reviewed"]
    },
    "Extracted Metrics": { "type": "rich_text" },
    "Deal Score": { "type": "number" },
    "Red Flags": { "type": "rich_text" },
    "Analysis Link": { "type": "url" }
  }
}
```

## Setup Instructions

### 1. Create Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Click "New integration"
3. Name: "OM Intelligence"
4. Select associated workspace
5. Copy the "Internal Integration Token"
6. Add to `.env` file:
   ```
   NOTION_API_KEY=secret_xxxxx
   NOTION_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

### 2. Create Deal Intake Database

Run the setup script:
```bash
npm run notion:setup
```

Or manually:
1. Create a new database in Notion named "Deal Intake"
2. Add the properties listed in the schema above
3. Share the database with your integration (click "..." → "Add connections" → "OM Intelligence")
4. Copy the database ID from the URL

### 3. Webhook Configuration

Since Notion doesn't natively support webhooks on file uploads, use n8n or Make.com:

**n8n Workflow:**
1. Trigger: Notion - Database Item Updated
2. Filter: Only when "Upload OM" changes
3. HTTP Request: POST to `https://your-api.com/api/notion/webhook`

**Payload:**
```json
{
  "pageId": "{{ $json.id }}",
  "databaseId": "{{ $json.parent.database_id }}",
  "properties": {{ JSON.stringify($json.properties) }}
}
```

### 4. Environment Variables

```env
# Notion
NOTION_API_KEY=secret_xxxxx
NOTION_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Webhook
NOTION_WEBHOOK_SECRET=your-webhook-secret
NOTION_WEBHOOK_URL=https://your-api.com/api/notion/webhook

# API Base URL (for write-back links)
API_BASE_URL=https://your-frontend.com
```

## API Endpoints

### POST /api/notion/webhook
Receive Notion file upload notifications and trigger processing.

### POST /api/documents/upload
Upload and process documents (used by Notion webhook).

### POST /api/notion/write-back/:pageId
Update Notion page with analysis results.

## Write-Back Format

When analysis completes, the Notion page is updated with:

**Extracted Metrics (rich_text):**
```
NOI: $450,000
Cap Rate: 5.25%
Purchase Price: $8,500,000
Units: 120
Year Built: 1995
```

**Red Flags (rich_text):**
```
• High vacancy rate (12%) vs market (6%)
• Deferred maintenance flagged in inspection
• Below-market rents ($150/unit avg)
```

**Status:** → "Analyzed"

**Analysis Link:** → `https://your-app.com/analysis/{documentId}`

## Security

- All webhook requests validated with secret
- Notion API token stored securely (never in client code)
- Rate limiting on webhook endpoint
- HTTPS required for all communications

## Testing

```bash
# Test Notion connection
npm run notion:test

# Test webhook endpoint
curl -X POST http://localhost:3000/api/notion/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret" \
  -d '{"pageId": "test-page-id", "fileUrl": "https://example.com/test.pdf"}'
```
