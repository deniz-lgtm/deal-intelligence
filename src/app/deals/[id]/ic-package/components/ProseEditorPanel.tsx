"use client";

import { useState } from "react";
import type { ProseSections } from "../types";

type SectionKey =
  | "exec"
  | "marketThesis"
  | "thesisCards"
  | "businessPlan"
  | "risks"
  | "callouts"
  | "ask"
  | "scenarios";

interface Props {
  prose: ProseSections;
  onChange: (next: ProseSections) => void;
  onRegenerate: (section: SectionKey) => Promise<void>;
  regeneratingSection: SectionKey | null;
}

/**
 * Structured editor for the prose that drives the IC package preview.
 * Each section is directly editable as raw HTML fragments (matching the
 * renderer's input shape) with a dedicated "Regen" button that calls
 * Claude to redraft just that section. Keeps the contract simple:
 * whatever you type here is exactly what the renderer displays.
 */
export default function ProseEditorPanel({
  prose,
  onChange,
  onRegenerate,
  regeneratingSection,
}: Props) {
  return (
    <div className="ic-editor-panel">
      <EditorSection
        label="Executive Thesis"
        hint="One-sentence headline + 3–5 sentence body. Use <em>…</em> to italicize and <strong>…</strong> for bold. Wrap body paragraphs in <p>."
        regenKey="exec"
        regeneratingSection={regeneratingSection}
        onRegenerate={onRegenerate}
      >
        <LabeledField label="Headline">
          <HtmlField
            value={prose.execHeadlineHtml}
            onChange={(v) => onChange({ ...prose, execHeadlineHtml: v })}
            rows={2}
          />
        </LabeledField>
        <LabeledField label="Body">
          <HtmlField
            value={prose.execBodyHtml}
            onChange={(v) => onChange({ ...prose, execBodyHtml: v })}
            rows={5}
          />
        </LabeledField>
      </EditorSection>

      <EditorSection
        label="Market Thesis"
        hint="2–3 paragraphs wrapped in <p>…</p>. Reference specific market data."
        regenKey="marketThesis"
        regeneratingSection={regeneratingSection}
        onRegenerate={onRegenerate}
      >
        <HtmlField
          value={prose.marketThesisHtml}
          onChange={(v) => onChange({ ...prose, marketThesisHtml: v })}
          rows={8}
        />
      </EditorSection>

      <EditorSection
        label="Thesis Cards"
        hint="Exactly 3 cards: pill, headline with one <em>word</em>, body paragraph."
        regenKey="thesisCards"
        regeneratingSection={regeneratingSection}
        onRegenerate={onRegenerate}
      >
        {prose.thesisCards.map((card, i) => (
          <div key={i} className="ic-editor-sub">
            <div className="ic-editor-sub-label">Card {i + 1}</div>
            <LabeledField label="Pill">
              <input
                className="ic-editor-input"
                value={card.pill}
                onChange={(e) => {
                  const next = [...prose.thesisCards];
                  next[i] = { ...card, pill: e.target.value };
                  onChange({ ...prose, thesisCards: next });
                }}
              />
            </LabeledField>
            <LabeledField label="Headline">
              <HtmlField
                value={card.headlineHtml}
                rows={2}
                onChange={(v) => {
                  const next = [...prose.thesisCards];
                  next[i] = { ...card, headlineHtml: v };
                  onChange({ ...prose, thesisCards: next });
                }}
              />
            </LabeledField>
            <LabeledField label="Body">
              <HtmlField
                value={card.bodyHtml}
                rows={4}
                onChange={(v) => {
                  const next = [...prose.thesisCards];
                  next[i] = { ...card, bodyHtml: v };
                  onChange({ ...prose, thesisCards: next });
                }}
              />
            </LabeledField>
          </div>
        ))}
      </EditorSection>

      <EditorSection
        label="Business Plan"
        hint="4 phases. Headline gets rendered bold; body flows inline."
        regenKey="businessPlan"
        regeneratingSection={regeneratingSection}
        onRegenerate={onRegenerate}
      >
        {prose.businessPlan.map((phase, i) => (
          <div key={i} className="ic-editor-sub">
            <div className="ic-editor-sub-label">Phase {i + 1}</div>
            <LabeledField label="Headline">
              <HtmlField
                value={phase.headlineHtml}
                rows={2}
                onChange={(v) => {
                  const next = [...prose.businessPlan];
                  next[i] = { ...phase, headlineHtml: v };
                  onChange({ ...prose, businessPlan: next });
                }}
              />
            </LabeledField>
            <LabeledField label="Body">
              <HtmlField
                value={phase.bodyHtml}
                rows={4}
                onChange={(v) => {
                  const next = [...prose.businessPlan];
                  next[i] = { ...phase, bodyHtml: v };
                  onChange({ ...prose, businessPlan: next });
                }}
              />
            </LabeledField>
          </div>
        ))}
      </EditorSection>

      <EditorSection
        label="Risks"
        hint="6 risks. Each with a short name and a 1–2 sentence risk + mitigation."
        regenKey="risks"
        regeneratingSection={regeneratingSection}
        onRegenerate={onRegenerate}
      >
        {prose.risks.map((risk, i) => (
          <div key={i} className="ic-editor-sub">
            <div className="ic-editor-sub-label">Risk {i + 1}</div>
            <LabeledField label="Name">
              <input
                className="ic-editor-input"
                value={risk.name}
                onChange={(e) => {
                  const next = [...prose.risks];
                  next[i] = { ...risk, name: e.target.value };
                  onChange({ ...prose, risks: next });
                }}
              />
            </LabeledField>
            <LabeledField label="Description + mitigation">
              <HtmlField
                value={risk.descriptionHtml}
                rows={3}
                onChange={(v) => {
                  const next = [...prose.risks];
                  next[i] = { ...risk, descriptionHtml: v };
                  onChange({ ...prose, risks: next });
                }}
              />
            </LabeledField>
          </div>
        ))}
      </EditorSection>

      <EditorSection
        label="Callouts"
        hint="2 key insights. First renders after market thesis, second after scenarios."
        regenKey="callouts"
        regeneratingSection={regeneratingSection}
        onRegenerate={onRegenerate}
      >
        {prose.callouts.map((callout, i) => (
          <div key={i} className="ic-editor-sub">
            <div className="ic-editor-sub-label">Callout {i + 1}</div>
            <LabeledField label="Label">
              <input
                className="ic-editor-input"
                value={callout.label}
                onChange={(e) => {
                  const next = [...prose.callouts];
                  next[i] = { ...callout, label: e.target.value };
                  onChange({ ...prose, callouts: next });
                }}
              />
            </LabeledField>
            <LabeledField label="Body">
              <HtmlField
                value={callout.bodyHtml}
                rows={4}
                onChange={(v) => {
                  const next = [...prose.callouts];
                  next[i] = { ...callout, bodyHtml: v };
                  onChange({ ...prose, callouts: next });
                }}
              />
            </LabeledField>
          </div>
        ))}
      </EditorSection>

      <EditorSection
        label="Scenarios"
        hint="Upside, Base, Downside. Each has a headline, one-paragraph narrative, and 3 stats."
        regenKey="scenarios"
        regeneratingSection={regeneratingSection}
        onRegenerate={onRegenerate}
      >
        {prose.scenarios.map((sc, i) => (
          <div key={i} className="ic-editor-sub">
            <div className="ic-editor-sub-label">Scenario · {sc.variant}</div>
            <LabeledField label="Headline">
              <HtmlField
                value={sc.headlineHtml}
                rows={2}
                onChange={(v) => {
                  const next = [...prose.scenarios];
                  next[i] = { ...sc, headlineHtml: v };
                  onChange({ ...prose, scenarios: next });
                }}
              />
            </LabeledField>
            <LabeledField label="Narrative">
              <HtmlField
                value={sc.narrativeHtml}
                rows={3}
                onChange={(v) => {
                  const next = [...prose.scenarios];
                  next[i] = { ...sc, narrativeHtml: v };
                  onChange({ ...prose, scenarios: next });
                }}
              />
            </LabeledField>
            {sc.stats.map((stat, j) => (
              <div key={j} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input
                  className="ic-editor-input"
                  value={stat.label}
                  onChange={(e) => {
                    const nextScen = [...prose.scenarios];
                    const nextStats = [...sc.stats];
                    nextStats[j] = { ...stat, label: e.target.value };
                    nextScen[i] = { ...sc, stats: nextStats };
                    onChange({ ...prose, scenarios: nextScen });
                  }}
                />
                <input
                  className="ic-editor-input"
                  value={stat.value}
                  onChange={(e) => {
                    const nextScen = [...prose.scenarios];
                    const nextStats = [...sc.stats];
                    nextStats[j] = { ...stat, value: e.target.value };
                    nextScen[i] = { ...sc, stats: nextStats };
                    onChange({ ...prose, scenarios: nextScen });
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </EditorSection>

      <EditorSection
        label="The Ask"
        hint="2 short paragraphs wrapped in <p>. Use <em> on dollar amounts and deadlines."
        regenKey="ask"
        regeneratingSection={regeneratingSection}
        onRegenerate={onRegenerate}
      >
        {prose.askParagraphsHtml.map((p, i) => (
          <LabeledField key={i} label={`Paragraph ${i + 1}`}>
            <HtmlField
              value={p}
              rows={3}
              onChange={(v) => {
                const next = [...prose.askParagraphsHtml];
                next[i] = v;
                onChange({ ...prose, askParagraphsHtml: next });
              }}
            />
          </LabeledField>
        ))}
      </EditorSection>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function EditorSection({
  label,
  hint,
  regenKey,
  regeneratingSection,
  onRegenerate,
  children,
}: {
  label: string;
  hint: string;
  regenKey: SectionKey;
  regeneratingSection: SectionKey | null;
  onRegenerate: (section: SectionKey) => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const regenerating = regeneratingSection === regenKey;

  return (
    <div className="ic-editor-section">
      <div className="ic-editor-section-head">
        <button
          className="ic-editor-toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span>{open ? "▾" : "▸"}</span>
          {label}
        </button>
        <button
          className="ic-editor-regen"
          disabled={regenerating}
          onClick={() => onRegenerate(regenKey)}
          title="Redraft this section with Claude"
        >
          {regenerating ? "Regenerating…" : "Regen"}
        </button>
      </div>
      {open && (
        <>
          <div className="ic-editor-hint">{hint}</div>
          <div className="ic-editor-body">{children}</div>
        </>
      )}
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ic-editor-field">
      <div className="ic-editor-field-label">{label}</div>
      {children}
    </div>
  );
}

function HtmlField({
  value,
  onChange,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      className="ic-editor-textarea"
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck
    />
  );
}
