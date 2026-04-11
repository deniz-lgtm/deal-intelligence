# Feature Roadmap & Backlog

Strategic roadmap for the Deal Intelligence platform. Tracks what's actively being built vs. deferred.

**Current focus: Pre-closing workflows.** Post-closing features (investor portal, lease admin, construction mgmt) are deferred until the pre-closing product is strongly differentiated.

---

## Shipped Recently

- **Comps & Market tab** (paste mode + extract-from-market-docs) with unified sale/rent comp store and submarket metrics. Legal posture: zero server-side scraping of broker sites, gated by `src/lib/web-allowlist.ts`.
- **App shell + Today strip** on the root landing. Collapsible left rail replaces the per-page header nav. Today strip surfaces upcoming milestones (14-day window), active deal briefs, and macro market widgets (10Y/2Y Treasury, S&P 500, 30Y mortgage) from FRED.
- **Workspace Comps Library** at `/comps-library`. `comps.deal_id` is now nullable with `source_deal_id` tracking provenance. "Snapshot a Deal" creates a sale/rent comp from a deal's underwriting + OM data. "Save to Workspace" on a per-deal comp clones it into the library with its source tagged. Cross-deal search with type / property-type / text filters.
- **Comps Library phase 3**: inline edit modal for any comp, unified workspace delete (works for orphan and attached comps), "Copy to Deal" action to clone a library comp into a target deal, state-filter dropdown.
- **Comps Library phase 4**: map view (leaflet + CartoDB dark tiles, colored markers by comp type, click-popup with headline + open-deal link), Census.gov geocoder for addresses → lat/lng (free, US-only, on the web allowlist), batch "Geocode Missing" button, Table ↔ Map view toggle, CSV export of filtered comps.
- **Comps Library phase 5**: auto-geocode new comps on create (hooked into POST /comps and POST /workspace/comps/from-deal), subject-deal geocoding via `POST /api/deals/[id]/geocode`, distance-from-subject column + "Within N miles" radius filter on per-deal Comps tab, PDF export (browser print-to-PDF with styled landscape view), marker clustering on the map via `react-leaflet-cluster`.
- **Comps Library phase 6 (polish)**: per-deal Comps tab now has a Table ↔ Map view toggle. Map view renders the subject as a distinct emerald pin, draws a dashed radius ring matching the active distance filter, and FitBounds zooms to include the full search area. `Geocode Missing` action also available from the per-deal map view. Cluster groups now show coverage polygon on hover for spatial context. The shared `CompsMapView` accepts optional `subject` + `radiusMiles` props so the same component drives both the workspace library and the per-deal view.

**Comps Library is feature-complete** for the current scope. Remaining follow-ups belong in other threads (RentCast API, global workspace sharing model) or are nice-to-have (map-to-PDF static rendering).

- **AI Deal Sourcing — Inbox (phase 1)**: new `/inbox` route + left-rail entry with pending-count badge. Polls a designated Dropbox folder, auto-creates draft deals in the `sourcing` stage with stage-1 OM extraction (property details + financial metrics). Dedupes by Dropbox path. Review/Dismiss actions. Settings panel with Dropbox connect flow (OAuth round-trip reroutes back to /inbox) and watched-folder path editor.

---

## Up Next (Open)

### RentCast (paid API) integration
~$100-300/mo, already scoped in the research spike. Adds auto-populated sale + rent comps + zip-level market stats on top of the existing paste-mode and doc-extraction paths.

### Next build-now feature
Pick the next one from: AI Deal Sourcing (folder watcher), Underwriting Co-Pilot, Deal Room, Document Intelligence Pipeline.

---

## Building Now (Pre-Closing Focus)

These extend the existing sourcing → screening → underwriting → diligence → LOI → pre-dev pipeline. All five target the same persona that already uses the platform (acquisitions/analysts at funds, syndicators, small-to-mid developers).

### A. Market Data & Comp Intelligence
**Why:** Biggest manual bottleneck in underwriting. Every deal requires pulling sale comps, lease comps, and submarket stats — today this is done in CoStar/Crexi/LoopNet tabs and pasted into the UW.

**Problem to solve first:** Cost. CoStar API is enterprise-tier ($$$); Crexi/LoopNet have limited APIs. Need to find the cheapest path to "good enough" accuracy.

**Approach candidates (cheapest → richest):**
1. **County assessor / public records scrape** — free, accurate for historical sales, slow to refresh. Good for sale comps.
2. **ATTOM Data / RealtyMole / Rentometer** — paid APIs, much cheaper than CoStar, decent coverage for multifamily & SFR.
3. **Reonomy / Placer.ai** — mid-tier pricing, commercial focus.
4. **Claude-powered web research** — Claude fetches listing pages + comp sources, extracts structured comps. Cheap per-query but accuracy depends on sources reachable.
5. **Manual-assist mode** — user pastes comp URLs → Claude extracts + scores them. Zero API cost.

**MVP scope:**
- Comp set per deal (sale comps, lease/rent comps)
- Fields: address, property type, size, sale price, $/unit, $/SF, cap rate, date, distance
- "Add comp" via URL paste → Claude extraction
- Auto-select top N by similarity (size, vintage, distance)
- Submarket summary panel on the deal underwriting page
- Export to investment package

**Open decisions:**
- Which data source to pilot first (need cost/coverage research before committing)
- Whether to cache comps at the workspace level (shared across deals) or per-deal

---

### B. AI Deal Sourcing Assistant (Folder-Watch Flavor)
**Why:** Analysts receive OMs via email from brokers all day. Currently they must download each one and manually upload to Deal Intelligence. This creates friction and some OMs never make it into the system.

**Approach:** Start with **folder-watch**, not email polling. Email parsing has authentication, permissions, and cost headaches — a watched folder is simpler and covers the core workflow (user downloads OM → system picks it up automatically).

**MVP scope:**
1. Per-user "OM Inbox" folder — Dropbox folder already supported (account table exists, no polling). Add local folder watch as fallback.
2. Scheduled job polls the folder every N minutes for new files.
3. New file → classify as OM → stage-1 extraction (address, price, units) → create draft deal in `sourcing` stage.
4. Notification: "3 new OMs auto-ingested — review and assign"
5. Review screen: user confirms/discards, assigns to pipeline, or merges with existing deal.

**Later:**
- Email forwarding (user forwards to `drop+workspace@dealintel.app` → SendGrid/Postmark inbound → ingest)
- Broker relationship scoring based on ingest volume + deal-to-close rate
- Instant AI score on ingestion (pre-screen before analyst touches it)

**Cost control:** Only run full 4-stage OM analysis on explicit user action. Auto-ingest runs stage-1 only (cheap classification + extraction).

---

### C. AI Underwriting Co-Pilot
**Why:** The underwriting page has hundreds of fields; users want Claude to challenge assumptions and run scenarios without manually editing every cell.

**Leverage existing infra:** `chatWithDealIntelligence()` in `src/lib/claude.ts` already streams RAG answers with full deal context. This feature is a specialized surface on top of it.

**MVP scope:**
1. "Co-Pilot" sidebar on the underwriting page.
2. **Challenge mode:** Claude reads current UW assumptions and asks targeted questions — "Your rent growth of 4% is above the 2.5% submarket avg. What's your basis?"
3. **What-if mode:** Natural language → apply to model. "What if rents drop 5% in year 1" → Claude returns the impact calc (calls the Proforma Engine).
4. **Benchmark mode:** Expense ratios, vacancy, OpEx per unit compared to similar deals in the workspace + market defaults.
5. Suggestions are **proposals, not automatic edits** — user approves each before it modifies the UW record.

**Open decisions:**
- Whether to call the existing Proforma Engine (Python FastAPI) for what-ifs, or do lightweight JS calcs inline
- How to surface benchmark data (need a small internal corpus first)

---

### D. Deal Room & Collaboration Hub
**Why:** Today, sharing documents with external parties (brokers, attorneys, lenders, investors) means emailing PDFs or using Intralinks/Firmex. The platform already has multi-user support + `deal_shares` table; need to add external guest access with guardrails.

**MVP scope:**
1. **Deal Room per deal** — curated subset of documents (not the whole document library) published to a room.
2. **External guest access** via magic link → view-only, optional NDA-gated (user must check "I agree" before first view).
3. **Watermarking** — PDFs shown with viewer's email overlayed on each page (server-side render, not client CSS).
4. **Activity log** — who viewed what, when, how long, downloads.
5. **Threaded Q&A** — broker/attorney posts a question against a doc → notified to deal owner → answer visible to all invited parties.
6. **Revocation** — expire links, pull documents, kill sessions.

**Leverages:**
- `DealShare` table + permission model already exists
- R2 storage with signed URLs for time-limited access
- Clerk for registered users; guest flow uses magic-link auth (no Clerk account required)

**Open decisions:**
- Guest flow: Clerk "guest" sessions vs. standalone magic-link tokens (probably the latter for UX)
- Whether watermarking is server-side PDF overlay (heavier) or iframe viewer with CSS overlay (lighter but defeatable)

---

### E. Automated Document Intelligence Pipeline
**Why:** Document upload works, but every doc is treated as a one-off. Users want smarter automation — detect changes between versions, summarize contract redlines, sync from cloud storage, auto-classify on ingest.

**MVP scope (builds on existing classification pipeline):**
1. **Document change detection** — when a new rent roll / T12 / financial is uploaded, compare to previous version. Claude diffs the extracted data and surfaces material changes ("unit 204 rent increased $150; 3 new vacancies in building B").
2. **Contract redline summaries** — LOI / PSA / loan docs uploaded in revision → Claude summarizes what changed, flags material legal terms.
3. **Cloud storage sync** — Google Drive / OneDrive / Box connectors (Dropbox already exists). Pick one folder → auto-ingest + classify.
4. **Smart grouping** — documents auto-grouped into versions ("rent roll v1, v2, v3" with timeline view).
5. **Extraction templates** — per-category extraction (rent roll → unit/rent/sqft grid; T12 → GL by month; survey → parcel/acreage/easements).

**Leverages:** `classifyDocument()`, `extractRentRollSummary()`, and the 13-category pipeline already in `src/lib/claude.ts`.

---

## Backlog (Deferred)

### Deferred — Post-Closing (Major Initiatives)

#### Investor Portal & LP Reporting
**Why deferred:** Large scope. Effectively replaces AppFolio / Juniper Square. Needs capital calls, distributions, waterfall calculations, K-1 vault, quarterly reporting, ACH integration. Build after pre-closing product is strongly differentiated and we have paying customers asking for it.

**When to revisit:** Once a fund manager customer signs on and explicitly requests it, or when pre-closing feature set is saturated.

#### Lease Administration & Tenant Management
Asset-manager daily driver. Auto-extracted lease abstracts, expiration calendars, rent roll reconciliation, renewal workflow.

#### Construction & Development Management
Subcontractor bid leveling, change order workflow, draw management (AIA G702/G703), RFI/submittal tracking, daily site log. Unlocks developer segment but is a large surface.

#### Lender & Debt Management Workflow
Track lenders, term sheet comparison, appraisal coordination, commitment letter expiry alerts, construction draw schedules.

#### Risk & Compliance Monitoring
Loan covenants, insurance expiry, property tax appeals, environmental remediation.

#### Disposition & Exit Management
Mirror of the acquisition pipeline for the sell side. Broker selection, buyer LOI tracker, closing cost estimator, realized return calc vs. underwriting.

---

### Deferred — Different Customer Segment

#### Broker-Focused Tooling
Broker pipeline, listing-centric workflows, commission tracking. **Different customer, different program** — not part of this product's scope. Revisit as a spin-off or separate SKU.

---

### Deferred — Nice to Have

#### Portfolio-Level Dashboard & Analytics
Cross-portfolio KPIs, actual NOI vs. pro forma, geographic heat map, AI portfolio commentary. Valuable once customers have 10+ deals in the system.

#### Fund & Entity Management
Fund → SPE → deal hierarchy, JV waterfall configurator, TVPI/DPI/IRR vs. vintage. Tied to the investor portal initiative.

#### Mobile Field App (PWA)
Geo-tagged site visit photos, voice-to-text notes, field checklist updates. Useful once the diligence workflow is heavily adopted.

---

## The Pitch (Reframed for Pre-Closing)

> The AI-native deal room and underwriting workspace for acquisitions teams. From OM inbox to closing — auto-ingested deals, AI co-pilot underwriting, market comps, and a secure deal room replace Dealpath + Argus + Intralinks.

Post-closing (AppFolio / Juniper Square / Yardi replacement) comes next — once the acquisitions product is the clear leader.
