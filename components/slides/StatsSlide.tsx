import type { StatsSlide } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

// Tailwind requires complete static strings — not dynamic `grid-cols-${n}`
const colClass: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export default function StatsSlide({ title, stats, typography }: StatsSlide) {
  const t = typo(typography);
  const cols = colClass[stats.length] ?? "grid-cols-3";

  return (
    <div className="w-full h-full flex flex-col px-16 py-12" style={t.root}>
      <h2 className="text-5xl font-semibold mb-12" style={t.heading}>
        <RichText>{title}</RichText>
      </h2>
      <div className={`flex-1 grid ${cols} gap-8 items-center`}>
        {stats.map((stat, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-3 text-center p-6 rounded-2xl border border-current/10"
            style={t.accent}
          >
            <span className="text-7xl font-bold tracking-tight" style={t.heading}>
              <RichText>{stat.value}</RichText>
            </span>
            <span className="text-xl opacity-50 leading-snug" style={t.muted}>
              <RichText>{stat.label}</RichText>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
