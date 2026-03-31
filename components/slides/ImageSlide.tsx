import type { ImageSlide } from "@/schemas/slideSchema";
import { typo } from "@/components/typography";
import RichText from "@/components/RichText";

export default function ImageSlide({ title, imageUrl, caption, typography }: ImageSlide) {
  const t = typo(typography);
  return (
    <div className="w-full h-full flex flex-col" style={t.root}>
      <div className="px-16 pt-12 pb-6 shrink-0">
        <h2 className="text-4xl font-semibold" style={t.heading}>
          <RichText>{title}</RichText>
        </h2>
      </div>

      <div className="flex-1 px-16 min-h-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={caption ?? title}
          className="w-full h-full object-contain rounded-xl"
        />
      </div>

      {caption && (
        <p className="text-center text-sm opacity-40 py-4" style={t.muted}>
          <RichText>{caption}</RichText>
        </p>
      )}
    </div>
  );
}
