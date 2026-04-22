/**
 * Server-side HTML composer for the IC Package.
 *
 * Mirrors the structure + class names of the React components in
 * `./components/*.tsx` so it shares the same `ic-tokens.css`. Kept as a
 * plain string builder so it can run in Next.js server contexts that
 * block react-dom/server imports (e.g. artifact generators under
 * src/lib/).
 *
 * Any change to the JSX renderer should be mirrored here and vice versa.
 */

import type {
  IcPackage,
  MetricCell,
  ThesisCard,
  Scenario,
  CapitalSource,
  BusinessPhase,
  RiskFactor,
  CalloutProps,
} from "./types";

function escText(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function masthead(m: IcPackage["masthead"]): string {
  const headline =
    m.italicWord && m.dealName.includes(m.italicWord)
      ? m.dealName.replace(m.italicWord, `<em>${escText(m.italicWord)}</em>`)
      : escText(m.dealName);
  return `
    <header class="ic-masthead">
      <div>
        <div class="ic-kicker">${escText(m.kicker)}</div>
        <h1>${headline}</h1>
      </div>
      <div class="ic-meta">
        DEAL CODE · ${escText(m.dealCode)}<br/>
        ${escText(m.dealSubtitle)}<br/>
        <strong>PREPARED ${escText(m.preparedDate)}</strong>
      </div>
    </header>
  `;
}

function execBox(e: IcPackage["exec"]): string {
  return `
    <div class="ic-exec-box">
      <div class="ic-label">${escText(e.label)}</div>
      <h3>${e.headlineHtml}</h3>
      <p>${e.bodyHtml}</p>
    </div>
  `;
}

function metricsStrip(metrics: MetricCell[]): string {
  const cells = metrics
    .map(
      (m) => `
      <div class="ic-metric${m.variant === "stabilized" ? " ic-stabilized" : ""}">
        <div class="ic-label">${escText(m.label)}</div>
        <div class="ic-value">${escText(m.value)}</div>
        <div class="ic-note">${escText(m.note)}</div>
      </div>
    `
    )
    .join("");
  return `<div class="ic-metrics-strip">${cells}</div>`;
}

function sectionHead(h: { number: string; headlineHtml: string; tag: string }): string {
  return `
    <div class="ic-section-head">
      <div class="ic-section-num">${escText(h.number)}</div>
      <h2>${h.headlineHtml}</h2>
      <div class="ic-section-tag">${escText(h.tag)}</div>
    </div>
  `;
}

function thesisGrid(cards: ThesisCard[]): string {
  const inner = cards
    .map(
      (c) => `
      <div class="ic-thesis-card">
        <div class="ic-pill">${escText(c.pill)}</div>
        <h4>${c.headlineHtml}</h4>
        <p>${c.bodyHtml}</p>
      </div>
    `
    )
    .join("");
  return `<div class="ic-thesis-grid">${inner}</div>`;
}

function scenarioStrip(scenarios: Scenario[]): string {
  const inner = scenarios
    .map(
      (s) => `
      <div class="ic-scenario ic-${s.variant}">
        <div class="ic-label">${escText(s.label)}</div>
        <h4>${s.headlineHtml}</h4>
        <p class="ic-scenario-narrative">${s.narrativeHtml}</p>
        <div class="ic-stat-row">
          ${s.stats
            .map(
              (stat) => `
            <div class="ic-stat"><span>${escText(stat.label)}</span><strong>${escText(stat.value)}</strong></div>
          `
            )
            .join("")}
        </div>
      </div>
    `
    )
    .join("");
  return `<div class="ic-scenario-strip">${inner}</div>`;
}

function capitalStackTable(sources: CapitalSource[]): string {
  const total = sources.reduce((s, x) => s + x.amount, 0);
  const rows = sources
    .map(
      (s) => `
      <tr>
        <td>${escText(s.name)}</td>
        <td>${escText(s.type)}</td>
        <td>${escText(s.terms)}</td>
        <td class="ic-num">${escText(fmtUSD(s.amount))}</td>
        <td class="ic-num">${escText(fmtPct(s.percentage))}</td>
      </tr>
    `
    )
    .join("");
  return `
    <table class="ic-stack-table">
      <thead>
        <tr>
          <th>Source</th><th>Type</th><th>Terms</th>
          <th class="ic-num">Amount</th><th class="ic-num">% of Cap</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td><strong>Total Capitalization</strong></td><td></td><td></td>
          <td class="ic-num"><strong>${escText(fmtUSD(total))}</strong></td>
          <td class="ic-num"><strong>100%</strong></td>
        </tr>
      </tbody>
    </table>
  `;
}

function businessPlan(phases: BusinessPhase[]): string {
  const rows = phases
    .map(
      (p, i) => `
      <div class="ic-numbered-item">
        <div class="ic-mark">${String(i + 1).padStart(2, "0")}</div>
        <div class="ic-body"><strong>${p.headlineHtml}</strong><span>${p.bodyHtml}</span></div>
      </div>
    `
    )
    .join("");
  return `<div class="ic-numbered-list">${rows}</div>`;
}

function riskBlock(b: IcPackage["sections"]["risks"]): string {
  const items = b.risks
    .map(
      (r: RiskFactor, i: number) => `
      <div class="ic-risk-item">
        <div class="ic-mark">${String(i + 1).padStart(2, "0")}</div>
        <div class="ic-body"><strong>${escText(r.name)}</strong><span>${r.descriptionHtml}</span></div>
      </div>
    `
    )
    .join("");
  return `
    <div class="ic-risk-block">
      <h3>${b.blockHeadlineHtml}</h3>
      <div class="ic-risk-sub">${escText(b.blockSubtitle)}</div>
      <div class="ic-risk-grid">${items}</div>
    </div>
  `;
}

function callout(c: CalloutProps): string {
  return `
    <div class="ic-callout">
      <div class="ic-callout-label">${escText(c.label)}</div>
      <div>${c.bodyHtml}</div>
    </div>
  `;
}

function punchBox(paras: string[]): string {
  const inner = paras.map((p) => `<p>${p}</p>`).join("");
  return `<div class="ic-punch">${inner}</div>`;
}

function footer(f: IcPackage["footer"]): string {
  return `
    <footer class="ic-footer">
      <div>END · ${escText(f.dealCode)} · IC PACKAGE</div>
      <div class="ic-footer-right">${escText(f.brandLeft)}<br/>${escText(f.brandRight)}</div>
    </footer>
  `;
}

/** Full `<div class="ic-package">…</div>` body string. */
export function renderIcPackageBody(pkg: IcPackage): string {
  const { masthead: mH, exec, metrics, sections, footer: ft } = pkg;
  return `
    <div class="ic-package">
      <div class="ic-page">
        ${masthead(mH)}
        ${execBox(exec)}
        ${metricsStrip(metrics)}

        <section>
          ${sectionHead(sections.marketThesis.head)}
          ${sections.marketThesis.proseHtml}
          ${thesisGrid(sections.marketThesis.thesisCards)}
          ${sections.marketThesis.callouts.map(callout).join("")}
        </section>

        <section>
          ${sectionHead(sections.capitalStack.head)}
          ${capitalStackTable(sections.capitalStack.sources)}
          ${sections.capitalStack.proseHtml}
        </section>

        <section>
          ${sectionHead(sections.scenarios.head)}
          ${sections.scenarios.introHtml}
          ${scenarioStrip(sections.scenarios.scenarios)}
          ${sections.scenarios.callouts.map(callout).join("")}
        </section>

        <section>
          ${sectionHead(sections.businessPlan.head)}
          ${businessPlan(sections.businessPlan.phases)}
        </section>

        <section>
          ${sectionHead(sections.risks.head)}
          ${riskBlock(sections.risks)}
        </section>

        <section>
          ${sectionHead(sections.ask.head)}
          ${punchBox(sections.ask.paragraphsHtml)}
        </section>

        ${footer(ft)}
      </div>
    </div>
  `;
}
