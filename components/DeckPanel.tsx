"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Slide } from "@/schemas/slideSchema";
import { X } from "lucide-react";
import { SETTINGS_KEY } from "@/lib/autoslidesSettings";

const GENERATED_KEY = "autoslides_generated";

export type DeckTab = "chat" | "new" | "update";

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

const TABS: { id: DeckTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "new", label: "New deck" },
  { id: "update", label: "Update" },
];

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
  const [chatInput, setChatInput] = useState("");
  const [log, setLog] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [streaming, setStreaming] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);

  const [topicNew, setTopicNew] = useState("");
  const [topicUpdate, setTopicUpdate] = useState("");
  const [status, setStatus] = useState<
    { type: "idle" } | { type: "working" } | { type: "error"; msg: string }
  >({ type: "idle" });

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, streaming]);

  const sendChat = useCallback(async () => {
    const instruction = chatInput.trim();
    if (!instruction || slides.length === 0) return;

    setChatInput("");
    setChatError(null);
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
      setChatError(msg);
      setLog((prev) => [...prev, { role: "assistant", text: `Error: ${msg}` }]);
    } finally {
      setStreaming("");
      onProcessingChange(false);
    }
  }, [chatInput, onProcessingChange, onSlidesUpdated, slides]);

  async function runGenerate() {
    const settings = loadSettings();
    const apiKey =
      settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;

    if (!topicNew.trim()) {
      setStatus({ type: "error", msg: "Topic is required." });
      return;
    }

    setStatus({ type: "working" });
    onProcessingChange(true);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: topicNew.trim(),
          provider: settings.provider,
          ...(apiKey ? { apiKey } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }

      const next: Slide[] = await res.json();
      localStorage.setItem(GENERATED_KEY, JSON.stringify(next));
      onSlidesUpdated(next);
      setTopicNew("");
      setStatus({ type: "idle" });
    } catch (err) {
      setStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      onProcessingChange(false);
    }
  }

  async function runUpdateExisting() {
    const settings = loadSettings();
    const apiKey =
      settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;

    if (!slides.length) {
      setStatus({ type: "error", msg: "No slides to update. Create a deck first." });
      return;
    }

    if (!topicUpdate.trim()) {
      setStatus({ type: "error", msg: "Describe what to change." });
      return;
    }

    setStatus({ type: "working" });
    onProcessingChange(true);

    try {
      const res = await fetch("/api/chat-update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction: topicUpdate.trim(),
          slides,
          provider: settings.provider,
          stream: false,
          ...(apiKey ? { apiKey } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }

      const updated: Slide[] = await res.json();
      localStorage.setItem(GENERATED_KEY, JSON.stringify(updated));
      onSlidesUpdated(updated);
      setTopicUpdate("");
      setStatus({ type: "idle" });
    } catch (err) {
      setStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      onProcessingChange(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-white">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex min-w-0 flex-1 gap-0.5 rounded-lg bg-white/5 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                activeTab === t.id
                  ? "bg-white/15 text-white"
                  : "text-white/45 hover:text-white/80"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 shrink-0 rounded-md p-1.5 transition-colors hover:bg-white/10"
          aria-label="Close panel"
        >
          <X className="h-4 w-4 opacity-60" />
        </button>
      </div>

      {activeTab === "chat" && (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {slides.length === 0 && (
              <p className="text-xs text-amber-400/90">
                No slides yet. Use <strong>New deck</strong> to create one.
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
            {chatError && <p className="text-xs text-red-400/90">{chatError}</p>}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 space-y-2 border-t border-white/10 p-4">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Describe changes to your deck…"
              rows={3}
              disabled={slides.length === 0}
              className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:opacity-30 focus:border-white/25 focus:outline-none disabled:opacity-40"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void sendChat()}
              disabled={slides.length === 0 || !chatInput.trim()}
              className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </>
      )}

      {activeTab === "new" && (
        <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4">
          <p className="text-xs leading-relaxed text-white/45">
            Replaces your current deck with a new presentation. Uses your provider and API key
            from Settings.
          </p>
          <input
            type="text"
            value={topicNew}
            onChange={(e) => {
              setTopicNew(e.target.value);
              if (status.type === "error") setStatus({ type: "idle" });
            }}
            placeholder="e.g. The future of renewable energy"
            maxLength={200}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm placeholder:opacity-25 focus:border-white/30 focus:outline-none"
            onKeyDown={(e) => e.key === "Enter" && void runGenerate()}
          />
          {status.type === "error" && (
            <p className="text-xs text-red-400/90">{status.msg}</p>
          )}
          <button
            type="button"
            onClick={() => void runGenerate()}
            disabled={status.type === "working"}
            className="w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status.type === "working" ? "Generating…" : "Generate deck"}
          </button>
        </div>
      )}

      {activeTab === "update" && (
        <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4">
          <p className="text-xs leading-relaxed text-white/45">
            Edits your current deck in one pass (no streaming). Use <strong>Chat</strong> for
            streaming back-and-forth.
          </p>
          <textarea
            value={topicUpdate}
            onChange={(e) => {
              setTopicUpdate(e.target.value);
              if (status.type === "error") setStatus({ type: "idle" });
            }}
            placeholder="What should change on the current deck?"
            rows={4}
            maxLength={4000}
            className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:opacity-25 focus:border-white/30 focus:outline-none"
          />
          {status.type === "error" && (
            <p className="text-xs text-red-400/90">{status.msg}</p>
          )}
          <button
            type="button"
            onClick={() => void runUpdateExisting()}
            disabled={status.type === "working" || slides.length === 0}
            className="w-full rounded-lg border border-white/25 py-2.5 text-sm font-medium transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status.type === "working" ? "Updating…" : "Apply update"}
          </button>
        </div>
      )}
    </div>
  );
}
