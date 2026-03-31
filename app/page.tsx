"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { DEFAULT_SLIDES } from "@/lib/defaultSlides";
import { getDeckSource } from "@/lib/autoslidesSettings";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";
import { renderSlide } from "@/components/slides/registry";
import { ChatSlidePanel } from "@/components/ChatSlidePanel";

const GENERATED_KEY = "autoslides_generated";

function loadSlides(): Slide[] {
  if (typeof window === "undefined") return DEFAULT_SLIDES;
  try {
    const raw = localStorage.getItem(GENERATED_KEY);
    if (raw) return SlidesSchema.parse(JSON.parse(raw));
  } catch {}
  return DEFAULT_SLIDES;
}

export default function Home() {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [index, setIndex] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [deckSource, setDeckSource] = useState<"web" | "mcp">("web");

  useEffect(() => {
    setSlides(loadSlides());
    setDeckSource(getDeckSource());
  }, []);

  useEffect(() => {
    const sync = () => {
      setDeckSource(getDeckSource());
      setSlides(loadSlides());
    };
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("chat") === "1") {
      if (getDeckSource() === "web") setChatOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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
  }, [slides]);

  const handleSlidesUpdated = useCallback((next: Slide[]) => {
    try {
      localStorage.setItem(GENERATED_KEY, JSON.stringify(next));
    } catch {}
    setSlides(next);
    setIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
  }, []);

  const exportPptx = useCallback(async () => {
    if (slides.length === 0) return;
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slides }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error("Export failed:", t);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "presentation.pptx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    }
  }, [slides]);

  if (slides.length === 0) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black text-white">
        <p className="text-xl opacity-50">No slides to display.</p>
      </div>
    );
  }

  const slide = slides[index];
  const isDark = slide.theme === "dark";
  const showChat = deckSource === "web";

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden transition-colors duration-300 ${
        isDark ? "bg-black text-white" : "bg-white text-black"
      }`}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {processing && (
          <div
            className={`absolute top-4 left-1/2 z-40 -translate-x-1/2 rounded-full border px-4 py-2 text-xs font-medium shadow-lg ${
              isDark
                ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                : "border-amber-600/30 bg-amber-50 text-amber-900"
            }`}
          >
            Updating slides…
          </div>
        )}

        <div key={index} className="min-h-0 flex-1 overflow-hidden animate-fade-in">
          {renderSlide(slide)}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end">
          <div className="pointer-events-auto mb-5 mr-8 flex items-center gap-4">
            {showChat && (
              <button
                type="button"
                onClick={() => setChatOpen((o) => !o)}
                className={`text-xs transition-opacity border border-current/20 rounded px-2 py-1 inline-flex items-center gap-1.5 ${
                  chatOpen ? "opacity-80" : "opacity-40 hover:opacity-80"
                }`}
                title={chatOpen ? "Close chat" : "Chat to update this deck"}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Chat
              </button>
            )}
            <Link
              href="/settings"
              className="text-xs opacity-40 hover:opacity-80 transition-opacity border border-current/20 rounded px-2 py-1"
            >
              {showChat ? "Generate" : "Settings"}
            </Link>
            <button
              type="button"
              onClick={() => void exportPptx()}
              className="text-xs opacity-40 hover:opacity-80 transition-opacity border border-current/20 rounded px-2 py-1"
            >
              Export PPTX
            </button>
            <span className="text-sm opacity-30 tabular-nums">
              {index + 1} / {slides.length}
            </span>
          </div>
        </div>
      </div>

      {chatOpen && showChat && (
        <aside className="flex h-full w-full max-w-[min(420px,42vw)] shrink-0 flex-col border-l border-black/10 bg-zinc-950 text-white shadow-2xl dark:border-white/10">
          <ChatSlidePanel
            onClose={() => setChatOpen(false)}
            slides={slides}
            onSlidesUpdated={handleSlidesUpdated}
            onProcessingChange={setProcessing}
          />
        </aside>
      )}
    </div>
  );
}
