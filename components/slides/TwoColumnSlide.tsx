import type { TwoColumnSlide } from "@/schemas/slideSchema";
import type { Typography } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

type ColumnProps = { heading?: string; points: string[]; t: ReturnType<typeof typo> };

function Column({ heading, points, t }: ColumnProps) {
  return (
    <div className="flex-1 flex flex-col gap-5 min-w-0">
      {heading && (
        <h3
          className="text-2xl font-semibold border-b border-current/20 pb-3"
          style={{ ...t.body, ...t.accent }}
        >
          <RichText>{heading}</RichText>
        </h3>
      )}
      <ul className="space-y-4 text-xl" style={t.body}>
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="opacity-30 mt-1 text-sm shrink-0">▸</span>
            <span>
              <RichText>{p}</RichText>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TwoColumnSlide({ title, left, right, typography }: TwoColumnSlide) {
  const t = typo(typography);
  return (
    <div className="w-full h-full flex flex-col px-16 py-12" style={t.root}>
      <h2 className="text-5xl font-semibold mb-10" style={t.heading}>
        <RichText>{title}</RichText>
      </h2>
      <div className="flex-1 flex gap-10 min-h-0">
        <Column {...left} t={t} />
        <div className="w-px bg-current opacity-15 self-stretch shrink-0" />
        <Column {...right} t={t} />
      </div>
    </div>
  );
}
