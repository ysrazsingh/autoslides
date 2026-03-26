import type { ThreeColumnSlide } from "@/schemas/slideSchema";

export default function ThreeColumnSlide({ title, columns }: ThreeColumnSlide) {
  return (
    <div className="w-full h-full flex flex-col px-16 py-12">
      <h2 className="text-5xl font-semibold mb-10">{title}</h2>
      <div className="flex-1 flex gap-8 min-h-0">
        {columns.map((col, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col gap-4 border-l border-current/15 pl-7 first:border-none first:pl-0"
          >
            <h3 className="text-xl font-semibold">{col.heading}</h3>
            <p className="text-lg opacity-70 leading-relaxed">{col.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
