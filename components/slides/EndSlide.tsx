import type { EndSlide } from "@/schemas/slideSchema";

export default function EndSlide({ title }: EndSlide) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6">
      <div className="w-16 h-0.5 rounded-full opacity-25 bg-current" />
      <h1 className="text-6xl font-bold">{title}</h1>
      <div className="w-16 h-0.5 rounded-full opacity-25 bg-current" />
    </div>
  );
}
