import type { ImageSlide } from "@/schemas/slideSchema";

export default function ImageSlide({ title, imageUrl, caption }: ImageSlide) {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-16 pt-12 pb-6 shrink-0">
        <h2 className="text-4xl font-semibold">{title}</h2>
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
        <p className="text-center text-sm opacity-40 py-4">{caption}</p>
      )}
    </div>
  );
}
