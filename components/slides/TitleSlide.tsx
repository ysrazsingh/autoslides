import type { TitleSlide } from "@/schemas/slideSchema";

export default function TitleSlide({ title, subtitle }: TitleSlide) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center px-16">
      <h1 className="text-6xl font-bold mb-6 leading-tight">{title}</h1>
      {subtitle && <p className="text-2xl opacity-60">{subtitle}</p>}
    </div>
  );
}
