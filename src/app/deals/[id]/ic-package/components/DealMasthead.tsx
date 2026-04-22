import type { MastheadProps } from "../types";

export default function DealMasthead({
  dealName,
  italicWord,
  kicker,
  dealCode,
  dealSubtitle,
  preparedDate,
}: MastheadProps) {
  const headline = italicWord && dealName.includes(italicWord)
    ? dealName.replace(italicWord, `<em>${italicWord}</em>`)
    : dealName;

  return (
    <header className="ic-masthead">
      <div>
        <div className="ic-kicker">{kicker}</div>
        <h1 dangerouslySetInnerHTML={{ __html: headline }} />
      </div>
      <div className="ic-meta">
        DEAL CODE · {dealCode}
        <br />
        {dealSubtitle}
        <br />
        <strong>PREPARED {preparedDate}</strong>
      </div>
    </header>
  );
}
