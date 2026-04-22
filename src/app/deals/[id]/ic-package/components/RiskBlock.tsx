import type { RiskFactor } from "../types";

interface Props {
  headlineHtml: string;
  subtitle: string;
  risks: RiskFactor[];
}

export default function RiskBlock({ headlineHtml, subtitle, risks }: Props) {
  return (
    <div className="ic-risk-block">
      <h3 dangerouslySetInnerHTML={{ __html: headlineHtml }} />
      <div className="ic-risk-sub">{subtitle}</div>
      <div className="ic-risk-grid">
        {risks.map((risk, i) => (
          <div key={i} className="ic-risk-item">
            <div className="ic-mark">{String(i + 1).padStart(2, "0")}</div>
            <div className="ic-body">
              <strong>{risk.name}</strong>
              <span dangerouslySetInnerHTML={{ __html: risk.descriptionHtml }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
