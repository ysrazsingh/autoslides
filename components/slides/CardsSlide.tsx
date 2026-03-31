import type { CardsSlide } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

// Tailwind requires complete class strings — not dynamic `grid-cols-${n}`
const colClass: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2",
  5: "grid-cols-3",
  6: "grid-cols-3",
};

export default function CardsSlide({ title, cards, typography }: CardsSlide) {
  const t = typo(typography);
  const cols = colClass[cards.length] ?? "grid-cols-3";

  return (
    <div className="w-full h-full flex flex-col px-16 py-12" style={t.root}>
      <h2 className="text-5xl font-semibold mb-8" style={t.heading}>
        <RichText>{title}</RichText>
      </h2>
      <div className={`flex-1 grid ${cols} gap-5 content-start`}>
        {cards.map((card, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 p-6 rounded-2xl border border-current/15 bg-current/5"
            style={t.accent}
          >
            {card.icon && (
              <span className="text-3xl leading-none mb-1">{card.icon}</span>
            )}
            <h3 className="text-xl font-semibold" style={t.body}>
              <RichText>{card.title}</RichText>
            </h3>
            <p className="text-base opacity-60 leading-relaxed" style={t.muted}>
              <RichText>{card.description}</RichText>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
