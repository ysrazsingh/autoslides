"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "@/schemas/slideSchema";
import { MessageSquare, X } from "lucide-react";
import { SETTINGS_KEY } from "@/lib/autoslidesSettings";

type Settings = {
  provider: "anthropic" | "openai";
  anthropicKey: string;
  openaiKey: string;
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<Settings>;
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
  | { type: "done"; slides: Slide[] }
  | { type: "error"; message: string };

async function consumeSSE(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (t: string) => void
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
    const json = line.slice(6);
    let ev: SSEEvent;
    try {
      ev = JSON.parse(json) as SSEEvent;
    } catch {
      return;
    }
    if (ev.type === "delta") onDelta(ev.text);
    if (ev.type === "done") slides = ev.slides;
    if (ev.type === "error") err = ev.message;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const block of parts) processBlock(block);
  }
  if (buffer.trim()) processBlock(buffer);

  return { slides, error: err };
}

/** Right column: chat to update slides via /api/chat-update (Web deck mode only). */
export function ChatSlidePanel(props: {
  onClose: () => void;
  slides: Slide[];
  onSlidesUpdated: (slides: Slide[]) => void;
  onProcessingChange: (v: boolean) => void;
}) {
  const { onClose, slides, onSlidesUpdated, onProcessingChange } = props;
  const [input, setInput] = useState("");
  const [log, setLog] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, streaming]);

  const send = useCallback(async () => {
    const instruction = input.trim();
    if (!instruction || slides.length === 0) return;

    setInput("");
    setError(null);
    setLog((prev) => [...prev, { role: "user", text: instruction }]);
    setStreaming("");
    onProcessingChange(true);

    const settings = loadSettings();
    const apiKey =
      settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;

    try {
      const res = await fetch("/api/chat-update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction,
          slides,
          provider: settings.provider,
          stream: true,
          ...(apiKey ? { apiKey } : {}),
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(j.error ?? res.statusText);
      }

      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        const { slides: next, error: streamErr } = await consumeSSE(res.body, (t) =>
          setStreaming((s) => s + t)
        );
        setStreaming("");
        if (streamErr) throw new Error(streamErr);
        if (!next?.length) throw new Error("No slides returned");
        setLog((prev) => [
          ...prev,
          { role: "assistant", text: `Applied changes (${next.length} slides).` },
        ]);
        onSlidesUpdated(next);
      } else {
        const next = (await res.json()) as Slide[];
        if (!Array.isArray(next) || next.length === 0) throw new Error("Invalid response");
        setLog((prev) => [...prev, { role: "assistant", text: "Updated slides." }]);
        onSlidesUpdated(next);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setLog((prev) => [...prev, { role: "assistant", text: `Error: ${msg}` }]);
    } finally {
      setStreaming("");
      onProcessingChange(false);
    }
  }, [input, onProcessingChange, onSlidesUpdated, slides]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2 text-lg font-medium">
          AutoSlides
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 transition-colors hover:bg-white/10"
          aria-label="Close chat"
        >
          <X className="h-4 w-4 opacity-60" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {slides.length === 0 && (
          <p className="text-xs text-amber-400/90">
            No slides loaded. Generate a deck in Settings first.
          </p>
        )}
        {log.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 ${
              m.role === "user" ? "ml-4 bg-white/10" : "mr-4 bg-white/5"
            }`}
          >
            <p className="mb-1 text-[10px] uppercase tracking-wider opacity-40">
              {m.role === "user" ? "You" : "Assistant"}
            </p>
            <p className="whitespace-pre-wrap opacity-90">{m.text}</p>
          </div>
        ))}
        {streaming && (
          <div className="mr-4 rounded-lg bg-white/5 px-3 py-2">
            <p className="mb-1 text-[10px] uppercase tracking-wider opacity-40">Streaming</p>
            <p className="max-h-40 overflow-y-auto font-mono text-xs whitespace-pre-wrap opacity-60">
              {streaming}
            </p>
          </div>
        )}
        {error && <p className="text-xs text-red-400/90">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 space-y-2 border-t border-white/10 p-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe changes to your deck…"
          rows={3}
          disabled={slides.length === 0}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:opacity-30 focus:border-white/25 focus:outline-none disabled:opacity-40"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={slides.length === 0 || !input.trim()}
          className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
