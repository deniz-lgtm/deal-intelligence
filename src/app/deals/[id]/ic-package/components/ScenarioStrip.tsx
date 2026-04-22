import type { Scenario } from "../types";

interface Props {
  scenarios: Scenario[];
}

export default function ScenarioStrip({ scenarios }: Props) {
  return (
    <div className="ic-scenario-strip">
      {scenarios.map((s, i) => (
        <div key={i} className={`ic-scenario ic-${s.variant}`}>
          <div className="ic-label">{s.label}</div>
          <h4 dangerouslySetInnerHTML={{ __html: s.headlineHtml }} />
          <p
            className="ic-scenario-narrative"
            dangerouslySetInnerHTML={{ __html: s.narrativeHtml }}
          />
          <div className="ic-stat-row">
            {s.stats.map((stat, j) => (
              <div key={j} className="ic-stat">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
