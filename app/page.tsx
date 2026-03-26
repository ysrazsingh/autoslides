'use client';
import { useState, useEffect } from "react";
import staticSlides from "@/data/slides.json";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";
import { renderSlide } from "@/components/slides/registry";

function parseSlides(): Slide[] {
  try {
    return SlidesSchema.parse(staticSlides);
  } catch (err) {
    console.error("slides.json failed validation:", err);
    return [];
  }
}

// Parse once at module scope — never re-parsed on re-render
const slides = parseSlides();

export default function Home() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length === 0) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === " ") e.preventDefault();

      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        setIndex((i) => Math.min(i + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(i - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  if (slides.length === 0) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black text-white">
        <p className="text-xl opacity-50">No slides to display.</p>
      </div>
    );
  }

  const slide = slides[index];
  const isDark = slide.theme === "dark";

  return (
    <div
      className={`w-screen h-screen relative overflow-hidden transition-colors duration-300 ${
        isDark ? "bg-black text-white" : "bg-white text-black"
      }`}
    >
      {/* key forces remount (and animate-fade-in) on slide change */}
      <div key={index} className="w-full h-full animate-fade-in">
        {renderSlide(slide)}
      </div>

      <div className="absolute bottom-5 right-8 flex items-center gap-4">
        <a
          href="/api/export"
          download="presentation.pptx"
          className="text-xs opacity-40 hover:opacity-80 transition-opacity border border-current/20 rounded px-2 py-1"
        >
          Export PPTX
        </a>
        <span className="text-sm opacity-30 tabular-nums">
          {index + 1} / {slides.length}
        </span>
      </div>
    </div>
  );
}
