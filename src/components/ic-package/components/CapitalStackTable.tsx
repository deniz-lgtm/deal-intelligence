import type { CapitalSource } from "../types";

interface Props {
  sources: CapitalSource[];
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

export default function CapitalStackTable({ sources }: Props) {
  const total = sources.reduce((sum, s) => sum + s.amount, 0);

  return (
    <table className="ic-stack-table">
      <thead>
        <tr>
          <th>Source</th>
          <th>Type</th>
          <th>Terms</th>
          <th className="ic-num">Amount</th>
          <th className="ic-num">% of Cap</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((s, i) => (
          <tr key={i}>
            <td>{s.name}</td>
            <td>{s.type}</td>
            <td>{s.terms}</td>
            <td className="ic-num">{fmtUSD(s.amount)}</td>
            <td className="ic-num">{fmtPct(s.percentage)}</td>
          </tr>
        ))}
        <tr>
          <td>
            <strong>Total Capitalization</strong>
          </td>
          <td></td>
          <td></td>
          <td className="ic-num">
            <strong>{fmtUSD(total)}</strong>
          </td>
          <td className="ic-num">
            <strong>100%</strong>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
