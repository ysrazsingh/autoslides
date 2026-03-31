import type { EndSlide } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

export default function EndSlide({ title, typography }: EndSlide) {
  const t = typo(typography);
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-6"
      style={t.root}
    >
      <div className="w-16 h-0.5 rounded-full opacity-25 bg-current" />
      <h1 className="text-6xl font-bold" style={t.heading}>
        <RichText>{title}</RichText>
      </h1>
      <div className="w-16 h-0.5 rounded-full opacity-25 bg-current" />
    </div>
  );
}
