# Notion Integration for OM Intelligence

This integration enables Notion as a deal intake system for OM Intelligence. When files are uploaded to Notion's "Deal Intake" database, they are automatically processed and analyzed.

## Features

- **Deal Intake Database**: Structured Notion database for property deals
- **Automatic Processing**: File uploads trigger immediate analysis
- **Write-Back Automation**: Analysis results are written back to Notion
- **Deal Scoring**: Automated 1-10 deal scoring with red flag detection
- **Analysis Links**: Direct links to detailed reports in the OM Intelligence app

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Required variables:
```env
NOTION_API_KEY=secret_xxxxx
NOTION_DATABASE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NOTION_WEBHOOK_SECRET=your-random-secret
API_BASE_URL=https://your-app.com
```

### 3. Create Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Click "New integration"
3. Name it "OM Intelligence"
4. Copy the "Internal Integration Token"
5. Add it to your `.env` file as `NOTION_API_KEY`

### 4. Create Deal Intake Database

1. In Notion, create a new database called "Deal Intake"
2. Add these properties:
   - **Property Address** (Title)
   - **Deal Type** (Select: Acquisition, Disposition, Refinance)
   - **Upload OM** (Files & media)
   - **Status** (Select: Pending, Processing, Analyzed, Reviewed)
   - **Extracted Metrics** (Text)
   - **Deal Score** (Number)
   - **Red Flags** (Text)
   - **Analysis Link** (URL)

3. Click "..." → "Add connections" → Select "OM Intelligence"
4. Copy the database ID from the URL and add to `.env`

### 5. Test the Connection

```bash
npm run notion:test
```

### 6. Set Up Webhook (via n8n or Make.com)

Since Notion doesn't natively support webhooks, use n8n or Make.com:

**Using n8n:**
1. Import the workflow from `workflows/n8n-notion-webhook.json`
2. Configure your Notion credentials
3. Set environment variables in n8n:
   - `NOTION_DATABASE_ID`
   - `OM_INTELLIGENCE_WEBHOOK_URL` (your API endpoint)
   - `NOTION_WEBHOOK_SECRET`
4. Activate the workflow

**Using Make.com:**
1. Create a new scenario
2. Add "Notion - Watch Database Items" module
3. Filter for "Upload OM" changes
4. Add HTTP module to POST to your webhook URL
5. Add headers: `X-Webhook-Secret: your-secret`

## API Endpoints

### POST /api/notion/webhook

Receive webhook notifications from Notion when files are uploaded.

**Headers:**
```
Content-Type: application/json
X-Webhook-Secret: your-secret
```

**Body:**
```json
{
  "pageId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "databaseId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "fileUrl": "https://s3.us-west-2.amazonaws.com/..."
}
```

### POST /api/documents/upload

Upload documents directly (supports multipart/form-data).

**Form Data:**
- `file` - The document file (PDF, etc.)
- `source` - `api`, `notion`, or `email`
- `sourceId` - Optional ID for tracking (e.g., Notion page ID)
- `metadata` - Optional JSON metadata

### GET /api/notion/write-back/:pageId

Get the current status of a Notion page.

### POST /api/notion/write-back/:pageId

Manually trigger write-back of analysis results.

**Body:**
```json
{
  "documentId": "doc-uuid"
}
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ User uploads file to Notion "Upload OM" field                    │
└──────────────────────────────────────────────────┬──────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ n8n/Make.com detects change and calls webhook                    │
│ POST /api/notion/webhook                                         │
└──────────────────────────────────────────────────┬──────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ API downloads file and creates document record                   │
│ Status in Notion → "Processing"                                  │
└──────────────────────────────────────────────────┬──────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Document Pipeline runs:                                          │
│ 1. Text extraction (OCR if needed)                               │
│ 2. Content chunking                                              │
│ 3. Metric extraction with LLM                                    │
│ 4. Analysis generation                                           │
└──────────────────────────────────────────────────┬──────────────┘
                                                   │
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Results written back to Notion:                                  │
│ - Status → "Analyzed"                                            │
│ - Extracted Metrics (formatted)                                  │
│ - Deal Score (1-10)                                              │
│ - Red Flags (bullet list)                                        │
│ - Analysis Link (to full report)                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

### Deal Intake Properties

| Property | Type | Description |
|----------|------|-------------|
| Property Address | Title | Property address or deal name |
| Deal Type | Select | Acquisition / Disposition / Refinance |
| Upload OM | Files | OM PDF or other documents |
| Status | Select | Pending → Processing → Analyzed → Reviewed |
| Extracted Metrics | Text | Key financial metrics (NOI, Cap Rate, etc.) |
| Deal Score | Number | 1-10 automated scoring |
| Red Flags | Text | Identified issues and concerns |
| Analysis Link | URL | Link to full analysis in app |

## Development

### Testing the Webhook Locally

Use ngrok to expose your local server:

```bash
ngrok http 3000
```

Then configure n8n/Make.com to use the ngrok URL as the webhook endpoint.

### Running the Setup Script

```bash
npm run notion:setup
```

This verifies your environment configuration and provides setup instructions.

## Troubleshooting

### "Database not found" error
- Make sure the database is shared with your integration
- In Notion: "..." → "Add connections" → "OM Intelligence"

### Webhook not triggering
- Verify n8n/Make.com is running and the workflow is active
- Check that the database ID in n8n matches your `.env` file
- Test the webhook manually with curl

### Files not processing
- Check the API logs for errors
- Verify the file URL is accessible (not behind auth)
- Ensure the file type is in the allowed list

## Security

- Store `NOTION_API_KEY` securely (never commit to git)
- Use a strong random `NOTION_WEBHOOK_SECRET`
- All webhook requests are validated against the secret
- HTTPS is required for all webhook communications

## License

Private - DJA CO
