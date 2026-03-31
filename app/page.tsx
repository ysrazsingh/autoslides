"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_SLIDES } from "@/lib/defaultSlides";
import { getDeckSource, getPanelSide } from "@/lib/autoslidesSettings";
import type { PanelSide } from "@/lib/autoslidesSettings";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";
import { renderSlide } from "@/components/slides/registry";
import { DeckPanel, type DeckTab } from "@/components/DeckPanel";

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
  const router = useRouter();
  const [slides, setSlides] = useState<Slide[]>([]);
  const [index, setIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<DeckTab>("chat");
  const [processing, setProcessing] = useState(false);
  const [deckSource, setDeckSource] = useState<"web" | "mcp">("web");
  const [panelSide, setPanelSide] = useState<PanelSide>("right");

  useEffect(() => {
    setSlides(loadSlides());
    setDeckSource(getDeckSource());
    setPanelSide(getPanelSide());
  }, []);

  useEffect(() => {
    const sync = () => {
      setDeckSource(getDeckSource());
      setPanelSide(getPanelSide());
      setSlides(loadSlides());
    };
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const chat = q.get("chat");
    const tab = q.get("tab") as DeckTab | null;
    if (getDeckSource() === "web") {
      if (chat === "1") {
        setPanelOpen(true);
        setPanelTab("chat");
      }
      if (tab === "new" || tab === "update" || tab === "chat") {
        setPanelOpen(true);
        setPanelTab(tab);
      }
    }
    window.history.replaceState({}, "", window.location.pathname);
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

  useEffect(() => {
    const showWeb = deckSource === "web";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panelOpen) {
        e.preventDefault();
        setPanelOpen(false);
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === ",") {
        e.preventDefault();
        router.push("/settings");
        return;
      }

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        void exportPptx();
        return;
      }

      if (!showWeb) return;

      if (e.key === "g" || e.key === "G") {
        if (e.shiftKey) return;
        e.preventDefault();
        setPanelTab("new");
        setPanelOpen(true);
        return;
      }

      if (e.key === "u" || e.key === "U") {
        if (!e.shiftKey) return;
        e.preventDefault();
        setPanelTab("update");
        setPanelOpen(true);
        return;
      }

      if (e.key === "/" || e.key === ".") {
        e.preventDefault();
        setPanelOpen((o) => !o);
        return;
      }

      if ((e.key === "k" || e.key === "K") && e.shiftKey) {
        e.preventDefault();
        setPanelTab("chat");
        setPanelOpen(true);
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, router, exportPptx, deckSource]);

  if (slides.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
        <p className="text-xl opacity-50">No slides to display.</p>
      </div>
    );
  }

  const slide = slides[index];
  const isDark = slide.theme === "dark";
  const showWeb = deckSource === "web";

  const panelWidthClass = "w-[min(420px,42vw)]";

  const edgeClip = !panelOpen &&
    showWeb && (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className={`flex h-28 w-5 shrink-0 flex-col items-center justify-center border border-white/10 bg-zinc-950/95 text-white/45 shadow-lg backdrop-blur-sm transition-colors hover:bg-zinc-900 hover:text-white/85 ${
          panelSide === "right"
            ? "rounded-l-lg border-r-0"
            : "rounded-r-lg border-l-0"
        }`}
        title="Open deck panel (⌘/ or ⌘.)"
        aria-label="Open deck panel"
      >
        {panelSide === "right" ? (
          <ChevronLeft className="h-4 w-4" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-4 w-4" strokeWidth={2} />
        )}
      </button>
    );

  const panelInner = showWeb && (
    <div
      className={`h-full overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none ${
        panelOpen ? panelWidthClass : "w-0"
      }`}
    >
      <div
        className={`h-full ${panelWidthClass} border-black/10 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none dark:border-white/10 ${
          panelSide === "right" ? "border-l" : "border-r"
        } ${panelOpen ? "translate-x-0" : panelSide === "right" ? "translate-x-full" : "-translate-x-full"}`}
      >
        <DeckPanel
          onClose={() => setPanelOpen(false)}
          slides={slides}
          onSlidesUpdated={handleSlidesUpdated}
          onProcessingChange={setProcessing}
          activeTab={panelTab}
          onTabChange={setPanelTab}
        />
      </div>
    </div>
  );

  const mainColumn = (
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
          <Link
            href="/settings"
            className="text-xs opacity-40 transition-opacity hover:opacity-80 border border-current/20 rounded px-2 py-1"
            title="Settings (⌘,)"
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={() => void exportPptx()}
            className="text-xs opacity-40 transition-opacity hover:opacity-80 border border-current/20 rounded px-2 py-1"
            title="Export PPTX (⌘E)"
          >
            Export
          </button>
          <span className="text-sm opacity-30 tabular-nums">
            {index + 1} / {slides.length}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden transition-colors duration-300 ${
        isDark ? "bg-black text-white" : "bg-white text-black"
      }`}
    >
      {panelSide === "left" && showWeb && (
        <div className="flex h-full shrink-0 flex-row-reverse items-stretch">
          {panelInner}
          {edgeClip}
        </div>
      )}

      {mainColumn}

      {panelSide === "right" && showWeb && (
        <div className="flex h-full shrink-0 items-stretch">
          {edgeClip}
          {panelInner}
        </div>
      )}
    </div>
  );
}
