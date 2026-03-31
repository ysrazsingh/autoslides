import type { TitleSlide } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

export default function TitleSlide({ title, subtitle, typography }: TitleSlide) {
  const t = typo(typography);
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center text-center px-16"
      style={t.root}
    >
      <h1 className="text-6xl font-bold mb-6 leading-tight" style={t.heading}>
        <RichText>{title}</RichText>
      </h1>
      {subtitle && (
        <p className="text-2xl opacity-60" style={t.muted}>
          <RichText>{subtitle}</RichText>
        </p>
      )}
    </div>
  );
}
