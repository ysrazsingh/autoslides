import type { TwoColumnSlide } from "@/schemas/slideSchema";

type ColumnProps = { heading?: string; points: string[] };

function Column({ heading, points }: ColumnProps) {
  return (
    <div className="flex-1 flex flex-col gap-5 min-w-0">
      {heading && (
        <h3 className="text-2xl font-semibold border-b border-current/20 pb-3">
          {heading}
        </h3>
      )}
      <ul className="space-y-4 text-xl">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="opacity-30 mt-1 text-sm">▸</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TwoColumnSlide({ title, left, right }: TwoColumnSlide) {
  return (
    <div className="w-full h-full flex flex-col px-16 py-12">
      <h2 className="text-5xl font-semibold mb-10">{title}</h2>
      <div className="flex-1 flex gap-10 min-h-0">
        <Column {...left} />
        <div className="w-px bg-current opacity-15 self-stretch shrink-0" />
        <Column {...right} />
      </div>
    </div>
  );
}
