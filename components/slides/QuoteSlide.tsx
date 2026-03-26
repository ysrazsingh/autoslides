import type { QuoteSlide } from "@/schemas/slideSchema";

export default function QuoteSlide({ quote, author }: QuoteSlide) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-24 text-center">
      <span className="text-9xl leading-none opacity-15 select-none mb-2">"</span>
      <blockquote className="text-3xl font-medium leading-relaxed max-w-4xl -mt-6">
        {quote}
      </blockquote>
      {author && (
        <p className="mt-10 text-lg opacity-40 tracking-wide">— {author}</p>
      )}
    </div>
  );
}
