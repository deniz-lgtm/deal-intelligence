# FlexBay OS — Integration Notes

## What This Is

A unified CRE deal management platform combining three tools:
- **FlexBay OS** — deal pipeline + diligence checklist tracker
- **OM Intelligence** — PDF/DOCX offering memorandum parser (ported as TypeScript library)
- **Proforma Engine** — Python FastAPI service that mirrors the v7 Excel financial model

Live at: `https://flexbay-os-production.up.railway.app`

---

## Architecture

```
Railway Project
├── flexbay-os (Next.js 14, App Router)
│   ├── Postgres database (shared)
│   └── calls proforma-engine via HTTP
└── feisty-flow (Python FastAPI)
    └── proforma-engine service
```

### Key design decisions
- OM extraction logic lives **inside** the Next.js app (`src/lib/om-extraction.ts`) — no separate service needed
- Single Postgres database for everything (migrated from SQLite)
- Proforma engine is a separate Railway service because it needs numpy-financial (Python)

---

## Environment Variables

### flexbay-os service
| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (set via Railway Postgres addon) |
| `ANTHROPIC_API_KEY` | Anthropic API key for OM extraction + chat |
| `PROFORMA_ENGINE_URL` | URL of the feisty-flow proforma service |

### feisty-flow (proforma-engine) service
No environment variables required — stateless HTTP service.

---

## Database Schema

All tables in Postgres, initialized automatically on startup via `initSchema()`.

### deals
Core deal record. Key columns added during integration:
- `om_score INTEGER` — OM quality score (0–10)
- `om_extracted JSONB` — raw extracted metrics from OM PDF
- `proforma_outputs JSONB` — results from proforma engine run
- `bedrooms INTEGER`
- `loi_executed BOOLEAN`
- `psa_executed BOOLEAN`

### documents
File metadata. `file_path` points to Railway ephemeral storage (consider R2/S3 for persistence).

### photos
Property photos. Same storage caveat as documents.

### underwriting
JSONB blob per deal for underwriting model data.

### loi
Letter of Intent data per deal.

### checklist_items
Diligence checklist. Auto-populated by proforma engine for:
- `Basis Risk` — when YoC < 6%
- `Capital Structure Risk` — when refi proceeds < $0
- `Debt Coverage Risk` — when DSCR < 1.25

### chat_messages
Per-deal AI chat history.

---

## API Endpoints

### Deals
| Method | Path | Description |
|---|---|---|
| GET | `/api/deals` | List all deals |
| POST | `/api/deals` | Create deal |
| GET | `/api/deals/:id` | Get deal |
| PUT | `/api/deals/:id` | Update deal |
| DELETE | `/api/deals/:id` | Delete deal |
| POST | `/api/deals/:id/om-upload` | Upload OM PDF → extract metrics |
| POST | `/api/deals/:id/om-score` | Write pre-extracted OM payload |
| POST | `/api/deals/:id/proforma` | Store proforma outputs + auto-flag checklist |
| POST | `/api/deals/:id/autofill` | Claude autofill deal fields from documents |
| POST | `/api/deals/:id/dd-abstract` | Generate DD abstract from documents |

### Documents
| Method | Path | Description |
|---|---|---|
| POST | `/api/documents/upload` | Upload document |
| GET | `/api/documents/:id` | Get document metadata |
| DELETE | `/api/documents/:id` | Delete document |
| GET | `/api/documents/:id/view` | Serve document file inline |

### Other
| Method | Path | Description |
|---|---|---|
| GET/PUT | `/api/loi` | LOI data (query param: `deal_id`) |
| GET/PUT | `/api/underwriting` | Underwriting data (query param: `deal_id`) |
| GET | `/api/photos/:id` | Serve photo |
| PATCH | `/api/photos/:id` | Update photo caption |
| DELETE | `/api/photos/:id` | Delete photo |
| GET/POST | `/api/checklist` | Checklist items |
| GET/POST | `/api/chat` | Deal chat messages |
| GET | `/api/health` | Postgres health check |

### Proforma Engine (feisty-flow service)
| Method | Path | Description |
|---|---|---|
| POST | `/api/proforma/run` | Run proforma model |
| GET | `/health` | Health check |

---

## Proforma Engine Inputs/Outputs

### Inputs (`POST /api/proforma/run`)
```json
{
  "purchase_price": 5000000,
  "sf": 10000,
  "rent_per_sf": 24.0,
  "vacancy": 0.05,
  "mgmt_pct": 0.04,
  "insurance": 15000,
  "taxes": 40000,
  "repairs": 10000,
  "utilities": 5000,
  "ltc": 0.65,
  "interest_rate": 0.065,
  "amort_years": 30,
  "refi_ltv": 0.70,
  "refi_rate": 0.06,
  "refi_year": 3,
  "exit_cap": 0.055,
  "hold_years": 5,
  "reno_budget": 200000
}
```

### Outputs
```json
{
  "levered_irr": 0.142,
  "unlevered_irr": 0.089,
  "equity_multiple": 1.87,
  "yoc": 0.068,
  "dscr_stabilized": 1.56,
  "noi_stabilized": 180000,
  "refi_proceeds": 320000,
  "max_pp_at_6pct": 5200000,
  "max_pp_at_6_5pct": 4800000,
  "max_pp_at_7pct": 4400000,
  "max_pp_at_7_5pct": 4100000,
  "gross_sale_price": 7200000,
  "net_sale_price": 6900000,
  "annual_cash_flows": [...]
}
```

---

## OM Extraction

Extracts these fields from a PDF/DOCX offering memo:
- `asking_price`, `sf`, `units`, `year_built`
- `noi`, `cap_rate`, `rent_per_sf`, `occupancy`
- `hold_period`, `address`

Uses regex first, falls back to Claude Haiku for missing fields.

Red flags detected: environmental issues, litigation, rent control, flood zone, deferred maintenance, hazmat, high vacancy.

OM Score (0–10): starts at 10, deducts for missing fields and each red flag found.

---

## Branch & Deployment

- All integration work is on branch: `claude/property-diligence-system-7r9Zc`
- Both Railway services point to this branch
- To deploy updates: push to this branch → Railway auto-deploys

---

## Known Limitations

1. **File storage is ephemeral** — uploaded documents/photos are stored on Railway's local disk, which resets on redeploy. For production, migrate to Cloudflare R2 or AWS S3.
2. **Proforma model is annual** — the v7 Excel uses a monthly rent roll; the engine uses a simplified annual model. NOI variance is ~1.5%, acceptable for an API.
3. **OM extraction address parsing** — regex-based, may miss non-standard address formats. Claude Haiku fallback catches most cases.
