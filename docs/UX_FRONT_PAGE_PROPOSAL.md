# Front Page / App Shell — Proposal

Brief exploration of what a new landing experience could look like as we add
more features to the platform (Comps & Market, AI Deal Sourcing, Underwriting
Co-Pilot, Deal Room, Document Intelligence). This is a thinking doc, not a
spec — the goal is to pick a direction.

---

## Current State

- **Root** (`src/app/page.tsx`) = Kanban pipeline board. Drag-drop deals across
  stages. Optional toggles for a small KPI bar (pipeline value, active deals,
  avg OM score) and an activity feed sidebar.
- **Top header**: logo, KPI toggle, Feed toggle, Plans, Contacts, Admin, New Deal.
- **Per-deal sidebar**: Overview, OM Analysis, Site & Zoning, Underwriting,
  **Comps & Market** (new), Documents, Photos, Checklist, Project, LOI, DD
  Abstract, Investment Package, Chat, Communication, Contacts, Deal Log.

## The Problem

Everything interesting happens **inside a deal**. A brand new user landing on
the app sees a kanban with zero context and no sense of what the product
*does*. The AI differentiation (OM extraction, red flag detection, comp
extraction, underwriting co-pilot) is completely invisible from the top level.

As we add more workspace-level features (AI OM inbox, cross-deal comps
library, deal room sharing), the per-deal sidebar can't hold them and the top
header isn't a real nav. We need:

1. **An app shell** that exposes both workspace-level and deal-level features.
2. **A front page** that's a command center, not just a list.

---

## Three Options

### A. Dashboard-first Landing

**Replace the root kanban with a dashboard.** Kanban moves to `/pipeline`.

Top-of-page: 4 "attention" cards:
- **Awaiting review** — new OMs auto-ingested, unread red flags
- **Ready to advance** — deals passing a stage gate (LOI executed, PSA signed)
- **Stale** — deals untouched 7+ days
- **Blockers** — deals with unresolved checklist issues or open broker Qs

Middle: small pipeline summary (condensed kanban row showing stage counts) +
recent activity feed.

Bottom: quick actions grid — "Ingest OM", "Add deal", "Paste comp",
"Underwriting what-if", "Generate investment package".

**Pro:** Maximum AI surface area. New users immediately see what the tool
does. Daily workflow is driven by attention items instead of "scroll kanban
until I remember what to do."

**Con:** Existing users expect the kanban on load. Requires a redirect or a
user-level preference (`home_view = "dashboard" | "pipeline"`).

---

### B. Keep Kanban, Add Real App Shell

**Don't touch the landing page.** Add a persistent left rail with the
workspace-level sections and promote the existing header to a proper nav.

Left rail:
- Home (kanban, current page)
- Inbox (new — AI Deal Sourcing)
- Comps Library (new — workspace-level comps)
- Contacts
- Business Plans
- Admin

**Pro:** Zero disruption. Every existing user's muscle memory is intact.

**Con:** Same invisibility problem for new users. The AI story still isn't
told on the front page. The kanban remains the first impression.

---

### C. Hybrid ("Today" Strip + Kanban)

**Keep the kanban as the main content but put a thin "Today" strip above it.**

Top strip (~100px tall, collapsible):
- Left: 3 small attention cards (awaiting review / ready to advance / blockers)
- Right: 1-line AI briefing — "3 new OMs ingested, 2 deals flagged for IC,
  1 market report ready to extract comps from"

Below strip: the existing kanban, unchanged.

Plus: the left-rail shell from Option B.

**Pro:** Low-disruption, high-value. Existing users get their kanban, new users
immediately see the AI-driven command center. Easy to iterate — if the strip
proves valuable, expand it toward Option A.

**Con:** Neither a full dashboard nor a clean kanban. Risks being a "bar at
the top that nobody reads" unless the attention cards are genuinely useful.

---

## Recommendation

**Start with Option C.** Rationale:

1. Ships the "AI command center" story without touching anyone's existing
   workflow.
2. Left rail solves the navigation-crowding problem as we ship more features.
3. Natural path forward: if the top strip is successful, expand to full
   Option A dashboard with a preference toggle. If not, the strip is
   collapsible and costs nothing.
4. First-time users see something that says "this tool thinks for you"
   immediately on load.

## What's Needed (If We Take Option C)

- **App shell refactor** — lift the current deal-detail layout pattern to the
  root: sticky top header + collapsible left rail + content area.
- **Attention card backend** — new API endpoint that aggregates:
  - Deals with unread AI red flags
  - Deals that crossed a stage gate but haven't been advanced
  - Deals untouched > 7 days
  - Deals with open blockers in the checklist or questions list
- **AI briefing backend** — 1-2 sentence Claude-generated summary of recent
  workspace activity, refreshed hourly. Cached at the workspace level.
- **Left-rail entries** for forthcoming features (Inbox, Comps Library) —
  can be stubbed as "Coming soon" until those features ship.

## Open Questions

1. Is the kanban drag-drop flow sacred, or would a dashboard-first landing
   be a net win for your daily workflow? (Drives Option A vs C.)
2. Do we need a workspace-level Comps Library (comps shared across deals),
   or are comps always scoped per-deal? (Drives whether Option B/C's left
   rail has a "Comps Library" entry.)
3. What's the first thing **you** want to see when you open the app every
   morning? (The answer probably picks the option for us.)
