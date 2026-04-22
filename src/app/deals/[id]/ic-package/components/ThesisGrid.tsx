import type { ThesisCard } from "../types";

interface Props {
  cards: ThesisCard[];
}

export default function ThesisGrid({ cards }: Props) {
  return (
    <div className="ic-thesis-grid">
      {cards.map((card, i) => (
        <div key={i} className="ic-thesis-card">
          <div className="ic-pill">{card.pill}</div>
          <h4 dangerouslySetInnerHTML={{ __html: card.headlineHtml }} />
          <p dangerouslySetInnerHTML={{ __html: card.bodyHtml }} />
        </div>
      ))}
    </div>
  );
}
