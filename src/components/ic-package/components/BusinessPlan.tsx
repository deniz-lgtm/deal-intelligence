import type { BusinessPhase } from "../types";

interface Props {
  phases: BusinessPhase[];
}

export default function BusinessPlan({ phases }: Props) {
  return (
    <div className="ic-numbered-list">
      {phases.map((phase, i) => (
        <div key={i} className="ic-numbered-item">
          <div className="ic-mark">{String(i + 1).padStart(2, "0")}</div>
          <div className="ic-body">
            <strong dangerouslySetInnerHTML={{ __html: phase.headlineHtml }} />
            <span dangerouslySetInnerHTML={{ __html: phase.bodyHtml }} />
          </div>
        </div>
      ))}
    </div>
  );
}
