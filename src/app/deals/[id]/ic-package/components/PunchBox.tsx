interface Props {
  paragraphsHtml: string[];
}

export default function PunchBox({ paragraphsHtml }: Props) {
  return (
    <div className="ic-punch">
      {paragraphsHtml.map((html, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: html }} />
      ))}
    </div>
  );
}
