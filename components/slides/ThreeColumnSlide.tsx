import type { ThreeColumnSlide } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

export default function ThreeColumnSlide({ title, columns, typography }: ThreeColumnSlide) {
  const t = typo(typography);
  return (
    <div className="w-full h-full flex flex-col px-16 py-12" style={t.root}>
      <h2 className="text-5xl font-semibold mb-10" style={t.heading}>
        <RichText>{title}</RichText>
      </h2>
      <div className="flex-1 flex gap-8 min-h-0">
        {columns.map((col, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col gap-4 border-l border-current/15 pl-7 first:border-none first:pl-0"
            style={t.accent}
          >
            <h3 className="text-xl font-semibold" style={t.body}>
              <RichText>{col.heading}</RichText>
            </h3>
            <p className="text-lg opacity-70 leading-relaxed" style={t.muted}>
              <RichText>{col.body}</RichText>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
