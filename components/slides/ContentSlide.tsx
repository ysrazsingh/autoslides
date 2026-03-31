import type { ContentSlide } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

export default function ContentSlide({ title, points, typography }: ContentSlide) {
  const t = typo(typography);
  return (
    <div className="w-full h-full flex flex-col justify-center px-20" style={t.root}>
      <h2 className="text-5xl font-semibold mb-10" style={t.heading}>
        <RichText>{title}</RichText>
      </h2>
      <ul className="space-y-5 text-2xl" style={t.body}>
        {points.map((point, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="opacity-30 mt-1 text-lg shrink-0">▸</span>
            <span>
              <RichText>{point}</RichText>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
