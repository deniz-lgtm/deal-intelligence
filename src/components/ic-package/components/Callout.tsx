import type { CalloutProps } from "../types";

export default function Callout({ label, bodyHtml }: CalloutProps) {
  return (
    <div className="ic-callout">
      <div className="ic-callout-label">{label}</div>
      <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </div>
  );
}
