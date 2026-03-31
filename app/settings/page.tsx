"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";

type Provider = "anthropic" | "openai";

interface Settings {
  provider: Provider;
  anthropicKey: string;
  openaiKey: string;
}

const STORAGE_KEY = "autoslides_settings";
const GENERATED_KEY = "autoslides_generated";

function loadStoredSlides(): Slide[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GENERATED_KEY);
    if (!raw) return null;
    return SlidesSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function loadSettings(): Settings {
  if (typeof window === "undefined") {
    return { provider: "anthropic", anthropicKey: "", openaiKey: "" };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { provider: "anthropic", anthropicKey: "", openaiKey: "", ...JSON.parse(raw) };
  } catch {}
  return { provider: "anthropic", anthropicKey: "", openaiKey: "" };
}

function saveSettings(s: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function getActiveSettings(): Settings {
  return loadSettings();
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>({
    provider: "anthropic",
    anthropicKey: "",
    openaiKey: "",
  });
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState<
    { type: "idle" } | { type: "saving" } | { type: "saved" } | { type: "generating" } | { type: "error"; msg: string }
  >({ type: "idle" });

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  function handleSave() {
    saveSettings(settings);
    setStatus({ type: "saved" });
    setTimeout(() => setStatus({ type: "idle" }), 2000);
  }

  async function handleGenerate() {
    const apiKey =
      settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;

    if (!topic.trim()) {
      setStatus({ type: "error", msg: "Topic is required." });
      return;
    }

    setStatus({ type: "generating" });

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          provider: settings.provider,
          // Only send key if user provided one; server falls back to env vars
          ...(apiKey ? { apiKey } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }

      const slides: Slide[] = await res.json();

      localStorage.setItem(GENERATED_KEY, JSON.stringify(slides));
      router.push("/");
    } catch (err) {
      setStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleUpdateExisting() {
    const apiKey =
      settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;

    const existing = loadStoredSlides();
    if (!existing?.length) {
      setStatus({ type: "error", msg: "No saved presentation. Generate a deck first." });
      return;
    }

    if (!topic.trim()) {
      setStatus({ type: "error", msg: "Describe what to change." });
      return;
    }

    setStatus({ type: "generating" });

    try {
      const res = await fetch("/api/chat-update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction: topic.trim(),
          slides: existing,
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
      router.push("/");
    } catch (err) {
      setStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  }

  const activeKey =
    settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-8 py-5 flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="text-sm opacity-50 hover:opacity-100 transition-opacity flex items-center gap-2"
        >
          ← Back
        </button>
        <span className="text-sm font-medium tracking-wide opacity-60">Settings</span>
        <div className="w-16" />
      </header>

      <main className="flex-1 px-8 py-10 max-w-xl mx-auto w-full space-y-10">

        {/* ── AI Provider ──────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
            AI Provider
          </h2>

          <div className="grid grid-cols-2 gap-3">
            {(["anthropic", "openai"] as Provider[]).map((p) => (
              <button
                key={p}
                onClick={() => setSettings((s) => ({ ...s, provider: p }))}
                className={`relative rounded-lg border px-5 py-4 text-left transition-all ${
                  settings.provider === p
                    ? "border-white/60 bg-white/5"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                {settings.provider === p && (
                  <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-white" />
                )}
                <p className="font-medium text-sm">
                  {p === "anthropic" ? "Claude" : "OpenAI"}
                </p>
                <p className="text-xs opacity-40 mt-0.5">
                  {p === "anthropic" ? "Anthropic · claude-sonnet-4-6" : "OpenAI · gpt-4.1-mini"}
                </p>
              </button>
            ))}
          </div>

          {/* MCP note */}
          <p className="text-xs opacity-30 leading-relaxed border border-white/8 rounded-md px-4 py-3">
            When accessed via <span className="opacity-70">Claude Code MCP</span>, Claude
            generates slides directly — no API key needed. This setting only applies to
            the web UI below.
          </p>
        </section>

        {/* ── API Key ──────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
            API Key
            <span className="ml-2 normal-case tracking-normal font-normal opacity-60">
              — {settings.provider === "anthropic" ? "Anthropic" : "OpenAI"}
            </span>
          </h2>

          <div className="space-y-3">
            <input
              type="password"
              placeholder={
                settings.provider === "anthropic"
                  ? "sk-ant-… (leave blank to use ANTHROPIC_API_KEY env var)"
                  : "sk-… (leave blank to use OPENAI_API_KEY env var)"
              }
              value={activeKey}
              onChange={(e) =>
                setSettings((s) =>
                  settings.provider === "anthropic"
                    ? { ...s, anthropicKey: e.target.value }
                    : { ...s, openaiKey: e.target.value }
                )
              }
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm placeholder:opacity-25 focus:outline-none focus:border-white/30 transition-colors font-mono"
            />
            <p className="text-xs opacity-25">
              Stored in <code>localStorage</code> — never sent to our servers, only forwarded to{" "}
              {settings.provider === "anthropic" ? "api.anthropic.com" : "api.openai.com"} on
              generation.
            </p>
          </div>

          <button
            onClick={handleSave}
            className="text-sm border border-white/20 rounded-lg px-5 py-2.5 hover:bg-white/5 transition-colors"
          >
            {status.type === "saved" ? "✓ Saved" : "Save Settings"}
          </button>
        </section>

        {/* ── Generate ─────────────────────────────────────────────────── */}
        <section className="space-y-4 border-t border-white/8 pt-10">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
            Generate or update
          </h2>

          <div className="space-y-3">
            <input
              type="text"
              placeholder="Topic for a new deck, or instructions to change the current deck"
              value={topic}
              maxLength={200}
              onChange={(e) => {
                setTopic(e.target.value);
                if (status.type === "error") setStatus({ type: "idle" });
              }}
              onKeyDown={(e) => e.key === "Enter" && void handleGenerate()}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm placeholder:opacity-25 focus:outline-none focus:border-white/30 transition-colors"
            />

            {status.type === "error" && (
              <p className="text-xs text-red-400 opacity-80">{status.msg}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={status.type === "generating"}
                className="w-full rounded-lg bg-white text-black text-sm font-medium py-3 hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {status.type === "generating" ? "Working…" : "New deck"}
              </button>
              <button
                type="button"
                onClick={() => void handleUpdateExisting()}
                disabled={status.type === "generating"}
                className="w-full rounded-lg border border-white/25 text-sm font-medium py-3 hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {status.type === "generating" ? "Working…" : "Update existing"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => router.push("/?chat=1")}
              className="w-full text-xs opacity-40 hover:opacity-70 transition-opacity border border-white/10 rounded-lg py-2"
            >
              Open chat panel on the viewer →
            </button>

            <p className="text-xs opacity-25 text-center">
              Using{" "}
              <span className="opacity-70">
                {settings.provider === "anthropic" ? "Claude (Anthropic)" : "OpenAI"}
              </span>
              {!activeKey && " · key from env var"}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
