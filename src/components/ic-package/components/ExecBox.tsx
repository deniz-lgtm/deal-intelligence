import type { ExecBoxProps } from "../types";

export default function ExecBox({ label, headlineHtml, bodyHtml }: ExecBoxProps) {
  return (
    <div className="ic-exec-box">
      <div className="ic-label">{label}</div>
      <h3 dangerouslySetInnerHTML={{ __html: headlineHtml }} />
      <p dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    </div>
  );
}
