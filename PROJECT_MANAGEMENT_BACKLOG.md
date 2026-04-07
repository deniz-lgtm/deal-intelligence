# Project Management — Feature Backlog

Tracking ideas for future development project management features. Items are grouped by priority.

---

## Strongly Recommended (Next Up)

These are high-ROI extensions of the patterns already built in the Project tab. Each follows the same DB + API + component pattern as the existing Pre-Dev Budget Tracker, so they should be relatively quick to add.

### 1. Hard Cost Budget Tracker
Same pattern as the Pre-Dev Budget Tracker but for construction costs.
- **Categories**: Sitework, Foundation, Structure, Envelope, MEP, Interior Finishes, FF&E, Sitework, Landscaping
- **Key feature**: Contingency drawdown tracking — show how much of the contingency line has been used, with warnings as it depletes
- **Why**: Construction is the biggest single line item in any development. Real-time visibility into commitments vs budget vs paid is critical.

### 2. Draw Schedule
Track lender draw requests against the budget.
- Each draw line item references a budget line and has: requisition #, submitted date, approved date, amount requested, amount approved, % complete claimed
- Running total of draws taken vs budget remaining
- **Why**: Required for any deal with construction financing.

### 3. Critical Path Indicator
- Flag tasks/phases that are blocking subsequent ones
- Visual highlight of the critical path on the Gantt timeline
- Surface slippage on critical-path items prominently
- **Why**: A task that slips on the critical path slips the whole project.

### 4. Vendor / Contractor Directory
Central list of all parties working on a deal.
- Fields: name, role (GC, architect, engineer, lender, broker, attorney, etc.), contact info, status (engaged / under contract / active / inactive), engagement date
- Link vendors to associated cost line items
- **Why**: Single source of truth for "who's doing what" — saves digging through emails.

### 5. Permit & Approval Tracker
Itemized permits with submission/approval lifecycle.
- Fields: permit type, jurisdiction, submission date, expected approval date, actual approval date, fee, status
- Calendar view showing pending approvals
- **Why**: Permits drive the schedule. Missing one delays everything.

---

## Nice to Have (Future)

### 6. Risk Register
- Risks with probability × impact, mitigation strategy, owner, status
- Auto-pull risks from OM red flags
- Export to investment package risk section

### 7. Decision Log
- Record of major project decisions: date, decider, rationale, alternatives considered
- Useful for IC reviews and post-mortems
- "Why did we choose this GC?" "Why did we add the rooftop deck?"

### 8. Schedule Variance Reports
- Original baseline dates vs current dates per phase
- Surface delays in days/weeks per phase
- Trend chart showing schedule slippage over time

### 9. Lease-Up Tracker
For the lease-up phase specifically:
- Leads → Tours → Applications → Signed Leases funnel
- Target absorption schedule vs actuals
- Per-unit lease status

### 10. Loan Maturity / Covenant Calendar
- Loan maturity dates
- DSCR / debt yield covenants
- Reporting deadlines (lender-required quarterly/monthly reports)
- Reminder alerts as covenants approach

---

## AI-Powered Upgrades

### 11. AI Pre-Dev Cost Estimator
Given property type, market, and size, suggest typical pre-dev cost ranges per category. Helps users size up budgets accurately. Could pull from a corpus of comparable deals.

### 12. AI Schedule Suggester
Feed Claude the property type, units, and complexity → it proposes phase durations based on typical CRE comparables.

### 13. Approval Memo Generator
When you cross an approval threshold, auto-generate a memo summarizing:
- What's been spent and on what
- What's remaining in budget
- What the next phase requires
- Risk callouts
- Ready to send to IC / Director / VP

---

## Notes
- Items 1, 2, 5 share the same "line item with status workflow + grouped by category" pattern as the existing Pre-Dev Budget Tracker. Building one means the next two are mostly copy-paste.
- Items 6, 7, 8 are all simple "list of records with metadata" features — straightforward to add.
- Items 11–13 require Claude API integration, which is already wired up in `src/lib/claude.ts`.
