import type { SectionHeadProps } from "../types";

export default function SectionHead({ number, headlineHtml, tag }: SectionHeadProps) {
  return (
    <div className="ic-section-head">
      <div className="ic-section-num">{number}</div>
      <h2 dangerouslySetInnerHTML={{ __html: headlineHtml }} />
      <div className="ic-section-tag">{tag}</div>
    </div>
  );
}
