import type { CardsSlide } from "@/schemas/slideSchema";

// Tailwind requires complete class strings — not dynamic `grid-cols-${n}`
const colClass: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2",
  5: "grid-cols-3",
  6: "grid-cols-3",
};

export default function CardsSlide({ title, cards }: CardsSlide) {
  const cols = colClass[cards.length] ?? "grid-cols-3";

  return (
    <div className="w-full h-full flex flex-col px-16 py-12">
      <h2 className="text-5xl font-semibold mb-8">{title}</h2>
      <div className={`flex-1 grid ${cols} gap-5 content-start`}>
        {cards.map((card, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 p-6 rounded-2xl border border-current/15 bg-current/5"
          >
            {card.icon && (
              <span className="text-3xl leading-none mb-1">{card.icon}</span>
            )}
            <h3 className="text-xl font-semibold">{card.title}</h3>
            <p className="text-base opacity-60 leading-relaxed">
              {card.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
