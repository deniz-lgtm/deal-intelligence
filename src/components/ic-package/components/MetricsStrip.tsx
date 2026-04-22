import type { MetricCell } from "../types";

interface Props {
  metrics: MetricCell[];
}

export default function MetricsStrip({ metrics }: Props) {
  return (
    <div className="ic-metrics-strip">
      {metrics.map((m, i) => (
        <div
          key={i}
          className={m.variant === "stabilized" ? "ic-metric ic-stabilized" : "ic-metric"}
        >
          <div className="ic-label">{m.label}</div>
          <div className="ic-value">{m.value}</div>
          <div className="ic-note">{m.note}</div>
        </div>
      ))}
    </div>
  );
}
