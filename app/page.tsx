"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_SLIDES } from "@/lib/defaultSlides";
import { GENERATED_KEY } from "@/lib/constants";
import { getDeckSource, getPanelSide } from "@/lib/autoslidesSettings";
import type { PanelSide } from "@/lib/autoslidesSettings";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";
import { renderSlide } from "@/components/slides/registry";
import { DeckPanel, type DeckTab } from "@/components/DeckPanel";

function loadSlides(): Slide[] {
  if (typeof window === "undefined") return DEFAULT_SLIDES;
  try {
    const raw = localStorage.getItem(GENERATED_KEY);
    if (raw) return SlidesSchema.parse(JSON.parse(raw));
  } catch {}
  return DEFAULT_SLIDES;
}

function isFocusedInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable;
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

  /* ── Load from localStorage on mount ───────────────────────────────── */

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

  /* ── Query-param driven open ───────────────────────────────────────── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const chat = q.get("chat");
    const tab = q.get("tab") as DeckTab | null;
    if (getDeckSource() === "web") {
      if (chat === "1") { setPanelOpen(true); setPanelTab("chat"); }
      if (tab === "new" || tab === "update" || tab === "chat") {
        setPanelOpen(true);
        setPanelTab(tab);
      }
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  /* ── Slide navigation (skip when typing) ───────────────────────────── */

  useEffect(() => {
    if (slides.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (isFocusedInput()) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [slides]);

  /* ── Slide update handler (single source of truth for persistence) ── */

  const handleSlidesUpdated = useCallback((next: Slide[]) => {
    try { localStorage.setItem(GENERATED_KEY, JSON.stringify(next)); } catch {}
    setSlides(next);
    setIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
  }, []);

  /* ── Export ─────────────────────────────────────────────────────────── */

  const exportPptx = useCallback(async () => {
    if (slides.length === 0) return;
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slides }),
      });
      if (!res.ok) { console.error("Export failed:", await res.text()); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "presentation.pptx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
  }, [slides]);

  /* ── Global keyboard shortcuts ─────────────────────────────────────── */

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

      if (e.key === ",") { e.preventDefault(); router.push("/settings"); return; }
      if (e.key === "e" || e.key === "E") { e.preventDefault(); void exportPptx(); return; }

      if (!showWeb) return;

      if ((e.key === "g" || e.key === "G") && !e.shiftKey) {
        e.preventDefault(); setPanelTab("new"); setPanelOpen(true); return;
      }
      if ((e.key === "u" || e.key === "U") && e.shiftKey) {
        e.preventDefault(); setPanelTab("update"); setPanelOpen(true); return;
      }
      if (e.key === "/" || e.key === ".") {
        e.preventDefault(); setPanelOpen((o) => !o); return;
      }
      if ((e.key === "k" || e.key === "K") && e.shiftKey) {
        e.preventDefault(); setPanelTab("chat"); setPanelOpen(true); return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, router, exportPptx, deckSource]);

  /* ── Empty state ───────────────────────────────────────────────────── */

  if (slides.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
        <p className="text-lg opacity-50">No slides to display.</p>
      </div>
    );
  }

  const slide = slides[index];
  const isDark = slide.theme === "dark";
  const showWeb = deckSource === "web";

  /* ── Edge clip (handle to open panel) ──────────────────────────────── */

  const edgeClip = !panelOpen && showWeb && (
    <button
      type="button"
      onClick={() => setPanelOpen(true)}
      className={`flex h-20 w-5 shrink-0 items-center justify-center self-center border border-white/[0.06] bg-zinc-950/90 text-white/30 backdrop-blur-sm transition-all hover:w-6 hover:bg-zinc-900 hover:text-white/70 ${
        panelSide === "right" ? "rounded-l-lg border-r-0" : "rounded-r-lg border-l-0"
      }`}
      title="Open panel (⌘/)"
      aria-label="Open panel"
    >
      {panelSide === "right" ? (
        <ChevronLeft className="h-4 w-4" strokeWidth={2} />
      ) : (
        <ChevronRight className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  );

  /* ── Panel wrapper — full sidebar height ───────────────────────────── */

  const panelWidth = "w-[min(400px,38vw)]";

  const panelInner = showWeb && (
    <div
      className={`h-full overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none ${
        panelOpen ? panelWidth : "w-0"
      }`}
    >
      <div
        className={`h-full ${panelWidth} overflow-hidden border-white/[0.06] bg-zinc-950 shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
          panelSide === "right" ? "border-l" : "border-r"
        } ${
          panelOpen
            ? "translate-x-0"
            : panelSide === "right"
              ? "translate-x-full"
              : "-translate-x-full"
        }`}
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

  /* ── Render ────────────────────────────────────────────────────────── */

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

      {/* Main slide area */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {processing && (
          <div
            className={`absolute top-4 left-1/2 z-40 -translate-x-1/2 rounded-full border px-4 py-2 text-xs font-medium shadow-lg ${
              isDark
                ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                : "border-amber-600/30 bg-amber-50 text-amber-900"
            }`}
          >
            Updating…
          </div>
        )}

        <div key={index} className="min-h-0 flex-1 overflow-hidden animate-fade-in">
          {renderSlide(slide)}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end">
          <div className="pointer-events-auto mb-5 mr-8 flex items-center gap-3">
            <Link
              href="/settings"
              className="rounded-md border border-current/15 px-2.5 py-1 text-xs opacity-35 transition-opacity hover:opacity-75"
              title="Settings (⌘,)"
            >
              Settings
            </Link>
            <button
              type="button"
              onClick={() => void exportPptx()}
              className="rounded-md border border-current/15 px-2.5 py-1 text-xs opacity-35 transition-opacity hover:opacity-75"
              title="Export (⌘E)"
            >
              Export
            </button>
            <span className="text-sm tabular-nums opacity-25">
              {index + 1}/{slides.length}
            </span>
          </div>
        </div>
      </div>

      {panelSide === "right" && showWeb && (
        <div className="flex h-full shrink-0 items-stretch">
          {edgeClip}
          {panelInner}
        </div>
      )}
    </div>
  );
}
