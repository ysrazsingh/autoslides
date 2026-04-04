"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "@/schemas/slideSchema";
import { ArrowUp, MessageCircle, PencilLine, Sparkles, X } from "lucide-react";
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

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "done"; slides?: Slide[]; reply?: string }
  | { type: "error"; message: string };

async function consumeSSE(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (t: string) => void,
  signal?: AbortSignal
): Promise<{ slides?: Slide[]; reply?: string; error?: string }> {
  if (!body) return { error: "No response body" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let slides: Slide[] | undefined;
  let reply: string | undefined;
  let err: string | undefined;

  const processBlock = (block: string) => {
    const line = block.trim();
    if (!line.startsWith("data: ")) return;
    try {
      const ev = JSON.parse(line.slice(6)) as SSEEvent;
      if (ev.type === "delta") onDelta(ev.text);
      if (ev.type === "done") {
        slides = ev.slides;
        reply = ev.reply;
      }
      if (ev.type === "error") err = ev.message;
    } catch {
      // ignore malformed frames
    }
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

  return { slides, reply, error: err };
}

const MODES: { value: Exclude<DeckTab, "chat">; label: string; hint: string; icon: typeof Sparkles }[] = [
  { value: "new", label: "Create new", hint: "Generate a deck from a topic", icon: Sparkles },
  { value: "update", label: "Update existing", hint: "Edit the current slides", icon: PencilLine },
];

async function postDeck(args: {
  instruction: string;
  mode: DeckTab;
  slides: Slide[];
  provider: ProviderSettings["provider"];
  apiKey: string;
  signal: AbortSignal;
}): Promise<Response> {
  const { instruction, mode, slides, provider, apiKey, signal } = args;

  const body: Record<string, unknown> = {
    mode,
    instruction,
    provider,
    stream: true,
    ...(apiKey ? { apiKey } : {}),
  };

  if (mode === "update") body.slides = slides;
  if (mode === "chat") body.slides = slides; // optional context for discussion

  return fetch("/api/deck", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

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

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, streaming]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const placeholder =
    activeTab === "chat"
      ? "Ask about structure, flow, story, tone, or slide content…"
      : activeTab === "new"
        ? "Describe the deck you want to create…"
        : "Describe the changes you want in the current slides…";

  const canSend =
    draft.trim().length > 0 &&
    !working &&
    (activeTab !== "update" || slides.length > 0);

  function getApiKeyFromSettings() {
    const s = loadSettings();
    return {
      provider: s.provider,
      apiKey: s.provider === "anthropic" ? s.anthropicKey : s.openaiKey,
    };
  }

  const run = useCallback(
    async (mode: DeckTab) => {
      const instruction = draft.trim();
      if (!instruction) return;

      if (mode === "update" && slides.length === 0) {
        setError("No slides loaded.");
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setDraft("");
      setError(null);
      setStreaming("");
      setWorking(true);
      onProcessingChange(true);

      const { provider, apiKey } = getApiKeyFromSettings();

      const label =
        mode === "chat" ? "Chat" : mode === "new" ? "Create" : "Update";
      setLog((prev) => [...prev, { role: "user", text: instruction }]);

      try {
        const res = await postDeck({
          instruction,
          mode,
          slides,
          provider,
          apiKey,
          signal: controller.signal,
        });

        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(j.error ?? res.statusText);
        }

        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("text/event-stream")) {
          const { slides: nextSlides, reply, error: streamErr } = await consumeSSE(
            res.body,
            (t) => setStreaming((s) => s + t),
            controller.signal
          );

          setStreaming("");
          if (streamErr) throw new Error(streamErr);

          if (mode === "chat") {
            const finalReply = reply?.trim() || "Done.";
            setLog((prev) => [...prev, { role: "assistant", text: finalReply }]);
          } else {
            if (!nextSlides?.length) throw new Error("No slides returned");
            onSlidesUpdated(nextSlides);
            setLog((prev) => [
              ...prev,
              { role: "assistant", text: `${label} complete — ${nextSlides.length} slides` },
            ]);
          }
        } else {
          if (mode === "chat") {
            const data = (await res.json()) as { reply?: string };
            setLog((prev) => [
              ...prev,
              { role: "assistant", text: data.reply?.trim() || "Done." },
            ]);
          } else {
            const next = (await res.json()) as Slide[];
            if (!Array.isArray(next) || next.length === 0) throw new Error("Invalid response");
            onSlidesUpdated(next);
            setLog((prev) => [
              ...prev,
              { role: "assistant", text: `${label} complete — ${next.length} slides` },
            ]);
          }
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
    },
    [draft, onProcessingChange, onSlidesUpdated, slides]
  );

  const submit = useCallback(() => {
    if (!canSend) return;
    void run(activeTab);
  }, [activeTab, canSend, run]);

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-white">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <MessageCircle className="h-3.5 w-3.5" />
        <p className="text-lg font-semibold tracking-tight"> AutoSlides</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">

        {log.length === 0 && !streaming && (
          <div className="py-10 text-center text-sm text-white/25">
            Start with a prompt. Chat is the default state.
          </div>
        )}

        <div className="space-y-3">
          {log.map((m, i) => (
            <div
              key={i}
              className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                m.role === "user"
                  ? "ml-10 border border-white/[0.06] bg-white/[0.07]"
                  : "mr-6 border border-white/[0.05] bg-white/[0.035]"
              }`}
            >
              <p className="whitespace-pre-wrap text-white/88">{m.text}</p>
            </div>
          ))}

          {streaming && (
            <div className="mr-6 rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-3 shadow-sm">
              <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/45">
                {streaming.slice(-4000)}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-400/80">{error}</p>}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.06] bg-zinc-950/80 p-4 backdrop-blur">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            disabled={working}
            rows={3}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            className="w-full resize-none bg-transparent px-1 pt-1 pb-2 text-sm leading-relaxed text-white/90 placeholder:text-white/25 focus:outline-none disabled:opacity-40"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              e.stopPropagation();
            }}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              {MODES.map((m) => {
                const active = activeTab === m.value;
                const Icon = m.icon;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => onTabChange(active ? "chat" : m.value)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                      active
                        ? "border-white/20 bg-white text-zinc-950"
                        : "border-white/[0.08] bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white/90"
                    }`}
                    title={m.hint}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {m.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-950 transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-20"
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
