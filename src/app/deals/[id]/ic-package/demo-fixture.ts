/**
 * Reference demo fixture — the Crestmont Acquisition.
 *
 * Exactly mirrors the HTML reference template so the IC Package route can
 * be previewed without a fully-populated deal. Swap in live mapper output
 * once the deal has underwriting + prose attached.
 */

import type { DealContext, ProseSections } from "./types";

export const DEMO_DEAL_CONTEXT: DealContext = {
  dealName: "The Crestmont Acquisition",
  propertyType: "multifamily",
  location: "Oakland, CA",
  purchasePrice: 27_500_000,
  goingInCap: 5.4,
  stabilizedYOC: 6.8,
  leveredIRR: 17.4,
  equityMultiple: 2.1,
  holdPeriod: 5,
  pricePerUnit: 187_000,
  unitCount: 147,
  squareFootage: null,
  yearBuilt: 1984,
  investmentStrategy: "value_add",
  capitalStack: [
    {
      name: "Senior Bridge",
      type: "Floating-rate · Bridge",
      terms: "SOFR + 350 · 3yr · 65% LTC",
      amount: 21_450_000,
      percentage: 65,
    },
    {
      name: "LP Equity",
      type: "Common · Pari Passu",
      terms: "8% pref · 70/30 over 12% IRR",
      amount: 10_395_000,
      percentage: 31.5,
    },
    {
      name: "GP Co-Invest",
      type: "Common · Promote",
      terms: "10% co-invest · 30% promote",
      amount: 1_155_000,
      percentage: 3.5,
    },
  ],
  marketContext:
    "Oakland multifamily down 18–24% from peak; cap rates stabilizing in 5.25–5.75% range for B-class product.",
  sellerContext:
    "Generational owner, age 78, facing maturing CMBS loan in Q4 2026, no appetite to recapitalize.",
  businessPlanSummary:
    "Interior renovation of 60% of units at $14K/door, common area refresh, operational repositioning, refi into agency at stabilization.",
};

export const DEMO_PROSE: ProseSections = {
  execHeadlineHtml:
    "A <em>basis play</em> on a 1980s vintage asset in a market that's done correcting.",
  execBodyHtml:
    "<p>The Crestmont is a 147-unit garden-style apartment community in West Oakland, available off-market at $187K/door — roughly 38% below replacement cost and 22% below 2021 trades for comparable product. The seller is a generational owner facing a maturing CMBS loan and no appetite to recapitalize. A disciplined value-add execution — interior renovations on 60% of units, common area refresh, and operational repositioning — should drive a 240bps NOI margin improvement and support a refinance into agency debt at stabilization, returning roughly 35% of equity by Year 3 and producing a <em>17.4% levered IRR</em> over a 5-year hold.</p>",
  marketThesisHtml:
    "<p>Oakland multifamily has spent the last 24 months absorbing a painful correction — values down 18–24% from peak, debt service coverage stress on 2021-vintage acquisitions, and a meaningful pullback from merchant builders. <em>That correction is largely complete.</em> Cap rates have stabilized in the 5.25–5.75% range for stabilized B-class product, lender appetite is returning at modest LTVs, and rents have held flat for three consecutive quarters after the 2024 reset.</p><p>What makes Crestmont compelling specifically is the combination of three structural factors: a motivated seller without optionality, a basis well below replacement cost, and an operational story that doesn't require heroic rent growth assumptions to underwrite. The deal works on flat market rents — any rent recovery is upside, not requirement.</p>",
  thesisCards: [
    {
      pill: "Basis",
      headlineHtml: "38% below <em>replacement</em>",
      bodyHtml:
        "<p>Current replacement cost in Oakland runs $300K+/door inclusive of land. At $187K/door we're acquiring at a basis that no new construction can compete with for the next decade, structurally protecting downside.</p>",
    },
    {
      pill: "Seller",
      headlineHtml: "Forced <em>liquidity</em>",
      bodyHtml:
        "<p>CMBS loan matures Q4 2026. Seller is 78, doesn't want to recapitalize, no internal succession. We're the second buyer they've offered to off-market — the first walked on financing during the rate spike. We have the reps to close.</p>",
    },
    {
      pill: "Operations",
      headlineHtml: "Real <em>NOI lift</em>",
      bodyHtml:
        "<p>In-place rents are $340/mo below market for renovated comps. A $14K/door interior renovation budget should command $280–320 premiums at lease turn, with a 5-year stabilization runway given current 28% annual turnover.</p>",
    },
  ],
  businessPlan: [
    {
      headlineHtml: "Months 0–6 · Take Possession and Stabilize Operations",
      bodyHtml:
        "Onboard property to our management platform. Implement RUBS billing, parking program, and bulk internet. Audit prior management fees and recover overcharges. Begin tenant communication on planned improvements. Expected NOI lift from operational changes alone: <em>$185K annualized.</em>",
    },
    {
      headlineHtml: "Months 6–24 · Renovation Program Execution",
      bodyHtml:
        "Renovate 88 of 147 units (60%) at lease turn at $14K/door budget. Common area refresh including lobby, fitness room, and outdoor amenity. New signage and rebranding. Leasing program targeting renovated unit premium of $280–320/mo.",
    },
    {
      headlineHtml: "Months 24–36 · Stabilization and Refinance",
      bodyHtml:
        "Property reaches stabilized 92%+ occupancy with renovated rent roll. Refinance bridge into Freddie Mac SBL or Fannie Mae DUS at 60% LTV. Expected refi proceeds <em>return ~35% of equity to investors.</em> Surplus distributable cash flow begins.",
    },
    {
      headlineHtml: "Months 36–60 · Operate and Exit",
      bodyHtml:
        "Run stabilized property generating 8.5% cash-on-cash on remaining equity. Monitor exit market conditions. Target Year 5 disposition at 5.75% cap on trailing NOI, with flexibility to extend if market conditions warrant.",
    },
  ],
  risks: [
    {
      name: "Oakland Market Recovery Delays",
      descriptionHtml:
        "If rents stay flat beyond Year 3, refinance proceeds compress and our return-of-capital event slips. Mitigated by basis below replacement and bridge extension option.",
    },
    {
      name: "Construction Cost Overruns",
      descriptionHtml:
        "$14K/door budget is informed by recent comparable projects but could be exposed to material cost shocks. Mitigated by GMP contracts on first 30 units and 8% contingency.",
    },
    {
      name: "Renovation Premium Underperformance",
      descriptionHtml:
        "We're underwriting $280–320 rent premiums for renovated units. If actual premiums come in at $200, returns drop materially. Mitigated by renovating only at natural turn.",
    },
    {
      name: "Bridge Refinance Timing",
      descriptionHtml:
        "Bridge matures in Year 3. If agency markets are dislocated at refi, we may need a higher-cost bridge extension. One-year extension option provides cushion.",
    },
    {
      name: "Local Regulatory Risk",
      descriptionHtml:
        "Oakland has active rent control and tenant protection ordinances. Renovation premiums must comply with allowable pass-through limits. Counsel has reviewed and confirmed our underwriting.",
    },
    {
      name: "Property Tax Reassessment",
      descriptionHtml:
        "Acquisition triggers Prop 13 reassessment to purchase price. We've underwritten new assessed value at full purchase price; any successful appeal is upside.",
    },
  ],
  callouts: [
    {
      label: "The Underwriting Discipline",
      bodyHtml:
        "<p>We've underwritten this deal on flat in-place rents through Year 2 and 2.5% growth thereafter — well below SubMarketWatch consensus. Exit cap is 25bps wider than going-in. If Oakland recovers more aggressively than we project, returns improve materially. If it stays flat, we still hit a 14% IRR.</p>",
    },
    {
      label: "The Asymmetry",
      bodyHtml:
        "<p>The downside scenario still produces an 11% IRR over 7 years — an outcome most investors would underwrite as base case in this market. The basis protection is what makes this asymmetry possible. We're not betting on the market; we're betting on our ability to operate a well-located asset acquired below replacement cost.</p>",
    },
  ],
  askParagraphsHtml: [
    "<p>We are seeking <em>$10.4M of LP equity commitments</em> to close the acquisition of The Crestmont alongside <strong>$1.2M of GP co-invest</strong> and a <strong>$21.5M senior bridge facility</strong>.</p>",
    "<p>Closing target is <em>15 June 2026</em>, with PSA execution required no later than 1 May. Investor signature documents will be circulated within 48 hours of IC approval.</p>",
  ],
  scenarios: [
    {
      variant: "upside",
      label: "Scenario · Upside",
      headlineHtml: "Recovery <em>accelerates</em>",
      narrativeHtml:
        "<p>Oakland rents recover to 4% growth from 2027. Exit cap compresses 50bps. Refi proceeds higher. Distributions accelerate.</p>",
      stats: [
        { label: "Levered IRR", value: "22.8%" },
        { label: "Equity Multiple", value: "2.6x" },
        { label: "Hold", value: "4 years" },
      ],
    },
    {
      variant: "base",
      label: "Scenario · Base",
      headlineHtml: "Disciplined <em>execution</em>",
      narrativeHtml:
        "<p>Flat rents Year 1–2, 2.5% thereafter. Reno program executes on budget. Exit at 5.75% cap on stabilized NOI in Year 5.</p>",
      stats: [
        { label: "Levered IRR", value: "17.4%" },
        { label: "Equity Multiple", value: "2.1x" },
        { label: "Hold", value: "5 years" },
      ],
    },
    {
      variant: "downside",
      label: "Scenario · Downside",
      headlineHtml: "Soft market <em>persists</em>",
      narrativeHtml:
        "<p>Rents flat full hold. Reno premiums compressed to $200/door. Exit cap 6.25%. Hold extended to capture eventual recovery.</p>",
      stats: [
        { label: "Levered IRR", value: "11.2%" },
        { label: "Equity Multiple", value: "1.7x" },
        { label: "Hold", value: "7 years" },
      ],
    },
  ],
};
