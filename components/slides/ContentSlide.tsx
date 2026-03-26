import type { ContentSlide } from "@/schemas/slideSchema";

export default function ContentSlide({ title, points }: ContentSlide) {
  return (
    <div className="w-full h-full flex flex-col justify-center px-20">
      <h2 className="text-5xl font-semibold mb-10">{title}</h2>
      <ul className="space-y-5 text-2xl">
        {points.map((point, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="opacity-30 mt-1 text-lg">▸</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
