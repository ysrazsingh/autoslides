"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "@/schemas/slideSchema";
import { MessageSquare, X } from "lucide-react";

const SETTINGS_KEY = "autoslides_settings";

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

export function ChatSlidePanel(props: {
  open: boolean;
  onClose: () => void;
  slides: Slide[];
  onSlidesUpdated: (slides: Slide[]) => void;
  onProcessingChange: (v: boolean) => void;
}) {
  const { open, onClose, slides, onSlidesUpdated, onProcessingChange } = props;
  const [input, setInput] = useState("");
  const [log, setLog] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, streaming, open]);

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end pointer-events-none"
      aria-modal="true"
      role="dialog"
    >
      <button
        type="button"
        className="flex-1 bg-black/40 pointer-events-auto cursor-default"
        onClick={onClose}
        aria-label="Close chat"
      />
      <div
        className="w-full max-w-md h-full bg-zinc-950 border-l border-white/10 shadow-2xl flex flex-col pointer-events-auto text-white"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="w-4 h-4 opacity-70" />
            Update presentation
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 opacity-60" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          {slides.length === 0 && (
            <p className="text-amber-400/90 text-xs">
              No slides loaded. Generate a deck in Settings first.
            </p>
          )}
          {log.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 ${
                m.role === "user" ? "bg-white/10 ml-4" : "bg-white/5 mr-4"
              }`}
            >
              <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">
                {m.role === "user" ? "You" : "Assistant"}
              </p>
              <p className="whitespace-pre-wrap opacity-90">{m.text}</p>
            </div>
          ))}
          {streaming && (
            <div className="rounded-lg px-3 py-2 bg-white/5 mr-4">
              <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">Streaming</p>
              <p className="whitespace-pre-wrap opacity-60 font-mono text-xs max-h-40 overflow-y-auto">
                {streaming}
              </p>
            </div>
          )}
          {error && <p className="text-xs text-red-400/90">{error}</p>}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-white/10 space-y-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe changes to your deck…"
            rows={3}
            disabled={slides.length === 0}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder:opacity-30 focus:outline-none focus:border-white/25 resize-none disabled:opacity-40"
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
            className="w-full rounded-lg bg-white text-black text-sm font-medium py-2.5 hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
