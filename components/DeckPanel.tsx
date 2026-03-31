"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "@/schemas/slideSchema";
import { ArrowUp, ChevronDown, X } from "lucide-react";
import { SETTINGS_KEY } from "@/lib/autoslidesSettings";

export type DeckTab = "chat" | "new" | "update";

type ProviderSettings = {
  provider: "anthropic" | "openai";
  anthropicKey: string;
  openaiKey: string;
};

function loadSettings(): ProviderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<ProviderSettings>;
      return {
        provider: o.provider === "openai" ? "openai" : "anthropic",
        anthropicKey: o.anthropicKey ?? "",
        openaiKey: o.openaiKey ?? "",
      };
    }
  } catch {}
  return { provider: "anthropic", anthropicKey: "", openaiKey: "" };
}

/* ── SSE consumer ────────────────────────────────────────────────────────── */

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "done"; slides: Slide[] }
  | { type: "error"; message: string };

async function consumeSSE(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (t: string) => void,
  signal?: AbortSignal
): Promise<{ slides?: Slide[]; error?: string }> {
  if (!body) return { error: "No response body" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let slides: Slide[] | undefined;
  let err: string | undefined;

  const processBlock = (block: string) => {
    const line = block.trim();
    if (!line.startsWith("data: ")) return;
    try {
      const ev = JSON.parse(line.slice(6)) as SSEEvent;
      if (ev.type === "delta") onDelta(ev.text);
      if (ev.type === "done") slides = ev.slides;
      if (ev.type === "error") err = ev.message;
    } catch {}
  };

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const block of parts) processBlock(block);
    }
    if (buffer.trim()) processBlock(buffer);
  } finally {
    reader.releaseLock();
  }

  return { slides, error: err };
}

/* ── Mode config ─────────────────────────────────────────────────────────── */

const MODES: { value: DeckTab; label: string; hint: string }[] = [
  { value: "chat", label: "Chat", hint: "Edit existing slides" },
  { value: "new", label: "New deck", hint: "Generate from a topic" },
  { value: "update", label: "Update", hint: "One-shot edit (no stream)" },
];

/* ── Component ───────────────────────────────────────────────────────────── */

export function DeckPanel({
  onClose,
  slides,
  onSlidesUpdated,
  onProcessingChange,
  activeTab,
  onTabChange,
}: {
  onClose: () => void;
  slides: Slide[];
  onSlidesUpdated: (slides: Slide[]) => void;
  onProcessingChange: (v: boolean) => void;
  activeTab: DeckTab;
  onTabChange: (t: DeckTab) => void;
}) {
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  const modeRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, streaming]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) {
        setModeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const placeholder =
    activeTab === "chat"
      ? "Describe changes to your slides…"
      : activeTab === "new"
        ? "Enter a topic for a new deck…"
        : "What should change?…";

  const canSend =
    draft.trim().length > 0 &&
    !working &&
    (activeTab !== "chat" || slides.length > 0) &&
    (activeTab !== "update" || slides.length > 0);

  function getApiKeyFromSettings() {
    const s = loadSettings();
    return {
      provider: s.provider,
      apiKey: s.provider === "anthropic" ? s.anthropicKey : s.openaiKey,
    };
  }

  const sendChat = useCallback(async () => {
    const instruction = draft.trim();
    if (!instruction || slides.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDraft("");
    setError(null);
    setLog((prev) => [...prev, { role: "user", text: instruction }]);
    setStreaming("");
    setWorking(true);
    onProcessingChange(true);

    const { provider, apiKey } = getApiKeyFromSettings();

    try {
      const res = await fetch("/api/chat-update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction, slides, provider, stream: true,
          ...(apiKey ? { apiKey } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(j.error ?? res.statusText);
      }

      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("text/event-stream")) {
        const { slides: next, error: streamErr } = await consumeSSE(
          res.body,
          (t) => setStreaming((s) => s + t),
          controller.signal
        );
        setStreaming("");
        if (streamErr) throw new Error(streamErr);
        if (!next?.length) throw new Error("No slides returned");
        setLog((prev) => [
          ...prev,
          { role: "assistant", text: `Done — ${next.length} slides` },
        ]);
        onSlidesUpdated(next);
      } else {
        const next = (await res.json()) as Slide[];
        if (!Array.isArray(next) || next.length === 0) throw new Error("Invalid response");
        setLog((prev) => [...prev, { role: "assistant", text: "Updated." }]);
        onSlidesUpdated(next);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setLog((prev) => [...prev, { role: "assistant", text: msg }]);
    } finally {
      setStreaming("");
      setWorking(false);
      onProcessingChange(false);
    }
  }, [draft, onProcessingChange, onSlidesUpdated, slides]);

  const runGenerate = useCallback(async () => {
    const topic = draft.trim();
    if (!topic) { setError("Enter a topic."); return; }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDraft("");
    setError(null);
    setLog((prev) => [...prev, { role: "user", text: `New deck: ${topic}` }]);
    setWorking(true);
    onProcessingChange(true);

    const { provider, apiKey } = getApiKeyFromSettings();

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic, provider,
          ...(apiKey ? { apiKey } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }
      const next: Slide[] = await res.json();
      onSlidesUpdated(next);
      setLog((prev) => [...prev, { role: "assistant", text: `Created ${next.length} slides` }]);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setLog((prev) => [...prev, { role: "assistant", text: msg }]);
    } finally {
      setWorking(false);
      onProcessingChange(false);
    }
  }, [draft, onProcessingChange, onSlidesUpdated]);

  const runUpdate = useCallback(async () => {
    const instruction = draft.trim();
    if (!slides.length) { setError("No slides loaded."); return; }
    if (!instruction) { setError("Describe what to change."); return; }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDraft("");
    setError(null);
    setLog((prev) => [...prev, { role: "user", text: instruction }]);
    setWorking(true);
    onProcessingChange(true);

    const { provider, apiKey } = getApiKeyFromSettings();

    try {
      const res = await fetch("/api/chat-update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction, slides, provider, stream: false,
          ...(apiKey ? { apiKey } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }
      const updated: Slide[] = await res.json();
      onSlidesUpdated(updated);
      setLog((prev) => [...prev, { role: "assistant", text: `Updated — ${updated.length} slides` }]);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setLog((prev) => [...prev, { role: "assistant", text: msg }]);
    } finally {
      setWorking(false);
      onProcessingChange(false);
    }
  }, [draft, onProcessingChange, onSlidesUpdated, slides]);

  const submit = useCallback(() => {
    if (!canSend) return;
    if (activeTab === "chat") void sendChat();
    else if (activeTab === "new") void runGenerate();
    else void runUpdate();
  }, [activeTab, canSend, runGenerate, runUpdate, sendChat]);

  const modeLabel = MODES.find((m) => m.value === activeTab)?.label ?? "Chat";

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-white">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">AutoSlides</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Chat / message area ─────────────────────────────────────── */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {log.length === 0 && !streaming && (
          <p className="py-12 text-center text-sm text-white/25">
            {slides.length === 0
              ? 'Switch to "New deck" and enter a topic.'
              : "Ask anything to edit your slides."}
          </p>
        )}

        {log.map((m, i) => (
          <div
            key={i}
            className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
              m.role === "user"
                ? "ml-8 bg-white/[0.08]"
                : "mr-6 bg-white/[0.04]"
            }`}
          >
            <p className="whitespace-pre-wrap text-white/85">{m.text}</p>
          </div>
        ))}

        {streaming && (
          <div className="mr-6 rounded-xl bg-white/[0.04] px-3.5 py-2.5">
            <p className="font-mono text-xs leading-relaxed text-white/40 whitespace-pre-wrap">
              {streaming.slice(-2000)}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-400/80">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* ── Composer ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/[0.06] p-4">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03]">
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            placeholder={placeholder}
            disabled={working}
            rows={3}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1.5 text-sm leading-relaxed text-white/90 placeholder:text-white/25 focus:outline-none disabled:opacity-40"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              e.stopPropagation();
            }}
          />

          <div className="flex items-center justify-between px-3 pb-3">
            {/* mode picker */}
            <div ref={modeRef} className="relative">
              <button
                type="button"
                onClick={() => setModeOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white/90"
              >
                {modeLabel}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>

              {modeOpen && (
                <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[200px] rounded-xl border border-white/[0.1] bg-zinc-900 py-1.5 shadow-2xl">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => { onTabChange(m.value); setModeOpen(false); }}
                      className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/[0.06] ${
                        activeTab === m.value ? "text-white" : "text-white/60"
                      }`}
                    >
                      <div>
                        <p className="text-sm font-medium">{m.label}</p>
                        <p className="text-xs text-white/30">{m.hint}</p>
                      </div>
                      {activeTab === m.value && (
                        <span className="text-blue-400 text-sm">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* send button */}
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-950 transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-20"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
