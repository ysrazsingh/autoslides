import type { QuoteSlide } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

export default function QuoteSlide({ quote, author, typography }: QuoteSlide) {
  const t = typo(typography);
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center px-24 text-center"
      style={t.root}
    >
      <span className="text-9xl leading-none opacity-15 select-none mb-2" style={t.accent}>
        "
      </span>
      <blockquote
        className="text-3xl font-medium leading-relaxed max-w-4xl -mt-6"
        style={{ ...t.body, textAlign: "center" }}
      >
        <RichText>{quote}</RichText>
      </blockquote>
      {author && (
        <p className="mt-10 text-lg opacity-40 tracking-wide" style={t.muted}>
          — <RichText>{author}</RichText>
        </p>
      )}
    </div>
  );
}
