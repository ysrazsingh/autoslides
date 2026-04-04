"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Slide } from "@/schemas/slideSchema";
import { ArrowUp, Check, Copy, MessageCircle, PencilLine, Sparkles, X } from "lucide-react";
import { SETTINGS_KEY } from "@/lib/autoslidesSettings";

export type DeckTab = "chat" | "new" | "update";

type ProviderSettings = {
  provider: "anthropic" | "openai";
  anthropicKey: string;
  openaiKey: string;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type ChatLogItem = {
  role: "user" | "assistant";
  text: string;
  usage?: TokenUsage;
  suggestions?: string[];
};

type PostDeckArgs = {
  instruction: string;
  mode: DeckTab;
  slides: Slide[];
  history: ChatLogItem[];
  provider: ProviderSettings["provider"];
  apiKey: string;
  signal: AbortSignal;
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
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "done"; slides?: Slide[]; reply?: string; usage?: TokenUsage; suggestions?: string[] }
  | { type: "error"; message: string };

async function consumeSSE(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (t: string) => void,
  onStatus: (msg: string) => void,
  signal?: AbortSignal
): Promise<{ slides?: Slide[]; reply?: string; usage?: TokenUsage; suggestions?: string[]; error?: string }> {
  if (!body) return { error: "No response body" };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let slides: Slide[] | undefined;
  let reply: string | undefined;
  let usage: TokenUsage | undefined;
  let suggestions: string[] | undefined;
  let err: string | undefined;

  const processBlock = (block: string) => {
    const line = block.trim();
    if (!line.startsWith("data: ")) return;
    try {
      const ev = JSON.parse(line.slice(6)) as SSEEvent;
      if (ev.type === "status") onStatus(ev.message);
      if (ev.type === "delta") onDelta(ev.text);
      if (ev.type === "done") {
        slides = ev.slides;
        reply = ev.reply;
        usage = ev.usage;
        suggestions = ev.suggestions;
      }
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
  return { slides, reply, usage, suggestions, error: err };
}

const MODES: {
  value: Exclude<DeckTab, "chat">;
  label: string;
  hint: string;
  icon: typeof Sparkles;
}[] = [
  { value: "new", label: "Create new", hint: "Generate a deck from a topic", icon: Sparkles },
  { value: "update", label: "Update existing", hint: "Edit the current slides", icon: PencilLine },
];

async function postDeck(args: PostDeckArgs): Promise<Response> {
  const { instruction, mode, slides, history, provider, apiKey, signal } = args;
  const body: Record<string, unknown> = {
    mode,
    instruction,
    provider,
    stream: true,
    history: history.map((m) => ({ role: m.role, content: m.text })),
    ...(apiKey ? { apiKey } : {}),
  };
  if (mode === "update") body.slides = slides;
  if (mode === "chat") body.slides = slides;
  return fetch("/api/deck", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

// ── Copy Button Component ────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      className="flex-shrink-0 rounded p-1 text-white/20 opacity-0 transition-all group-hover:opacity-100 hover:text-white/60"
      aria-label="Copy message"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

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
  const [log, setLog] = useState<ChatLogItem[]>([]);
  const [streaming, setStreaming] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [log, streaming, statusMsg]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const placeholder =
    activeTab === "chat"
      ? "Ask about structure, flow, story, tone, or slide content…"
      : activeTab === "new"
        ? "Describe the deck you want to create…"
        : "Describe the changes you want in the current slides…";

  const canSend =
    draft.trim().length > 0 && !working && (activeTab !== "update" || slides.length > 0);

  const helpText = useMemo(() => {
    if (activeTab === "chat") return "Simple PPT chat. Ask for strategy, critique, or explanation.";
    if (activeTab === "new") return "Generate a new deck from a topic.";
    if (slides.length === 0) return "Load or generate slides first, then update.";
    return "Edit the current slides.";
  }, [activeTab, slides.length]);

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
      const { provider, apiKey } = getApiKeyFromSettings();
      const nextLog: ChatLogItem[] = [...log, { role: "user", text: instruction }];

      setDraft("");
      setError(null);
      setStreaming("");
      setStatusMsg(null);
      setWorking(true);
      onProcessingChange(true);
      setLog(nextLog);

      try {
        const res = await postDeck({
          instruction,
          mode,
          slides,
          history: nextLog,
          provider,
          apiKey,
          signal: controller.signal,
        });

        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error((j as { error?: string }).error ?? res.statusText);
        }

        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("text/event-stream")) {
          const { slides: nextSlides, reply, usage, suggestions, error: streamErr } =
            await consumeSSE(
              res.body,
              (t) => {
                setStatusMsg(null); // Clear status once real text starts flowing
                setStreaming((s) => {
                  const next = s + t;
                  return next.length > 6000 ? next.slice(-6000) : next;
                });
              },
              (msg) => setStatusMsg(msg),
              controller.signal
            );

          setStreaming("");
          setStatusMsg(null);

          if (streamErr) throw new Error(streamErr);

          if (mode === "chat") {
            setLog((prev) => [
              ...prev,
              { role: "assistant", text: reply?.trim() || "Done." },
            ]);
          } else {
            if (!nextSlides?.length) throw new Error("No slides returned");
            onSlidesUpdated(nextSlides);
            setLog((prev) => [
              ...prev,
              {
                role: "assistant",
                text: `${mode === "new" ? "Created" : "Updated"} — ${nextSlides.length} slide${nextSlides.length !== 1 ? "s" : ""}`,
                usage,
                suggestions,
              },
            ]);
          }
        } else {
          // Non-streaming fallback
          if (mode === "chat") {
            const data = (await res.json()) as { reply?: string };
            setLog((prev) => [...prev, { role: "assistant", text: data.reply?.trim() || "Done." }]);
          } else {
            const data = (await res.json()) as { slides?: Slide[] };
            const next = data.slides;
            if (!Array.isArray(next) || next.length === 0) throw new Error("Invalid response");
            onSlidesUpdated(next);
            setLog((prev) => [
              ...prev,
              {
                role: "assistant",
                text: `${mode === "new" ? "Created" : "Updated"} — ${next.length} slides`,
              },
            ]);
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStreaming("");
        setStatusMsg(null);
        setWorking(false);
        onProcessingChange(false);
      }
    },
    [draft, log, onProcessingChange, onSlidesUpdated, slides]
  );

  const submit = useCallback(() => {
    if (!canSend) return;
    void run(activeTab);
  }, [activeTab, canSend, run]);

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-3.5 w-3.5" />
          <p className="text-lg font-semibold tracking-tight">AutoSlides</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Chat Area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {log.length === 0 && !streaming && !statusMsg && (
          <div className="py-10 text-center text-sm text-white/25">
            {helpText}
          </div>
        )}

        <div className="space-y-3">
          {log.map((m, i) => (
            <div
              key={i}
              className={`group relative rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                m.role === "user"
                  ? "ml-10 border border-white/[0.06] bg-white/[0.07]"
                  : "mr-6 border border-white/[0.05] bg-white/[0.035]"
              }`}
            >
              {/* Copy button */}
              <div className="absolute right-2 top-2">
                <CopyButton text={m.text} />
              </div>

              <p className="whitespace-pre-wrap pr-6 text-white/88">{m.text}</p>

              {/* Token usage (assistant only) */}
              {m.role === "assistant" && m.usage && (
                <p className="mt-1.5 text-[10px] text-white/25">
                  {m.usage.inputTokens.toLocaleString()} in · {m.usage.outputTokens.toLocaleString()} out
                </p>
              )}

              {/* Quick-action suggestions (assistant only) */}
              {m.role === "assistant" && m.suggestions && m.suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setDraft(s);
                        setError(null);
                      }}
                      className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] text-white/55 transition hover:bg-white/[0.09] hover:text-white/80"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Tool call status indicator */}
          {statusMsg && !streaming && (
            <div className="mr-6 flex items-center gap-2 rounded-2xl border border-white/[0.04] bg-white/[0.02] px-4 py-2.5">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400/60" />
              <p className="text-xs text-white/35 italic">{statusMsg}</p>
            </div>
          )}

          {/* Streaming response */}
          {streaming && (
            <div className="mr-6 rounded-2xl border border-white/[0.05] bg-white/[0.035] px-4 py-3 shadow-sm">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/75">
                {streaming.slice(-6000)}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2.5">
              <p className="text-sm text-red-400/80">{error}</p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
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
