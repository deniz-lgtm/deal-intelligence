# Diligence — Property Due Diligence Platform

AI-powered property acquisition and development due diligence system. Part of the FlexBay OS suite, designed to be **property-agnostic** and eventually a standalone commercial product.

## What It Does

1. **Deal Dashboard** — Track all deals/properties with status, starring, and search/filter
2. **Document Upload & AI Filing** — Drag-and-drop upload; Claude auto-classifies each document into 13 categories (Title, Environmental, Financial, etc.) and generates a summary
3. **AI Diligence Chat** — Ask any question about the deal; Claude answers using your uploaded documents with streaming responses
4. **Diligence Checklist** — 65+ item checklist across 10 categories; AI auto-fill analyzes all documents and marks items complete/pending/issue

## Stack

- **Next.js 14** + TypeScript
- **SQLite** (better-sqlite3) — zero-config local database
- **Claude claude-sonnet-4-6** — document classification, chat, checklist auto-fill
- **Tailwind CSS** + shadcn/ui components
- **react-dropzone** — drag-and-drop uploads
- **pdf-parse** — PDF text extraction

## Quick Start

```bash
cd diligence
npm install
cp .env.example .env.local
# Add your ANTHROPIC_API_KEY to .env.local
npm run dev
# Open http://localhost:3004
```

## Features

### Document Categories (AI auto-classified)
- 🏛️ Title & Ownership
- 🌿 Environmental (Phase I/II ESA)
- 📋 Zoning & Entitlements
- 💰 Financial (rent rolls, P&L, tax)
- 📐 Surveys & Engineering
- ⚖️ Legal (contracts, easements, CC&Rs)
- ⚡ Utilities
- 🔍 Inspections (PCR, roof, HVAC)
- 📊 Market (comps, appraisals)
- 🛡️ Insurance
- 📝 Leases (estoppels, SNDAs)
- 🔑 Permits & CO
- 📁 Other

### Diligence Checklist Categories
- Title & Ownership (7 items)
- Environmental (7 items)
- Zoning & Entitlements (7 items)
- Financial (9 items)
- Leases (9 items)
- Physical Inspections (9 items)
- Legal & Contracts (7 items)
- Utilities & Infrastructure (7 items)
- Permits & Compliance (6 items)
- Market & Valuation (6 items)
- Insurance (5 items)

## Roadmap

- [ ] Google Drive integration (upload from Drive, sync folders)
- [ ] Multi-user / team access
- [ ] Notion sync (push deal status to Notion)
- [ ] Email integration (auto-ingest diligence docs from email)
- [ ] Report generation (PDF diligence summary)
- [ ] Deal pipeline / Kanban view
- [ ] Underwriting calculator integration
- [ ] PostgreSQL + pgvector for large document sets
- [ ] Mission Control dashboard integration

## Environment Variables

```env
ANTHROPIC_API_KEY=your_key_here
DATABASE_PATH=./data/diligence.db   # optional, defaults to ./data/diligence.db
UPLOAD_DIR=./uploads                 # optional, defaults to ./uploads
```

## Project Structure

```
diligence/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Dashboard
│   │   ├── deals/
│   │   │   ├── new/page.tsx            # Create deal
│   │   │   └── [id]/
│   │   │       ├── layout.tsx          # Deal nav layout
│   │   │       ├── page.tsx            # Deal overview
│   │   │       ├── documents/page.tsx  # Document manager
│   │   │       ├── checklist/page.tsx  # Diligence checklist
│   │   │       └── chat/page.tsx       # AI chat
│   │   └── api/
│   │       ├── deals/                  # CRUD for deals
│   │       ├── documents/              # Upload & manage docs
│   │       ├── chat/                   # Streaming AI chat
│   │       └── checklist/             # Checklist + autofill
│   ├── components/
│   │   ├── DealCard.tsx
│   │   ├── DocumentUpload.tsx
│   │   ├── ChatInterface.tsx
│   │   └── DiligenceChecklist.tsx
│   └── lib/
│       ├── types.ts                    # All TypeScript types + checklist template
│       ├── db.ts                       # SQLite queries
│       ├── claude.ts                   # AI: classify, chat, autofill
│       └── utils.ts
```
