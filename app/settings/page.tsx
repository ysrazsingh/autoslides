"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SETTINGS_KEY, type DeckSource, type PanelSide } from "@/lib/autoslidesSettings";

type Provider = "anthropic" | "openai";

interface Settings {
  provider: Provider;
  anthropicKey: string;
  openaiKey: string;
  deckSource: DeckSource;
  panelSide: PanelSide;
}

function loadSettings(): Settings {
  if (typeof window === "undefined") {
    return {
      provider: "anthropic",
      anthropicKey: "",
      openaiKey: "",
      deckSource: "web",
      panelSide: "right",
    };
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<Settings>;
      return {
        provider: o.provider === "openai" ? "openai" : "anthropic",
        anthropicKey: o.anthropicKey ?? "",
        openaiKey: o.openaiKey ?? "",
        deckSource: o.deckSource === "mcp" ? "mcp" : "web",
        panelSide: o.panelSide === "left" ? "left" : "right",
      };
    }
  } catch {}
  return {
    provider: "anthropic",
    anthropicKey: "",
    openaiKey: "",
    deckSource: "web",
    panelSide: "right",
  };
}

function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
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
    deckSource: "web",
    panelSide: "right",
  });
  const [status, setStatus] = useState<
    { type: "idle" } | { type: "saved" }
  >({ type: "idle" });

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  function handleSave() {
    saveSettings(settings);
    setStatus({ type: "saved" });
    setTimeout(() => setStatus({ type: "idle" }), 2000);
  }

  const activeKey =
    settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;
  const isWeb = settings.deckSource === "web";

  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-8 py-5">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-2 text-sm opacity-50 transition-opacity hover:opacity-100"
        >
          ← Back
        </button>
        <span className="text-sm font-medium tracking-wide opacity-60">Settings</span>
        <div className="w-16" />
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 space-y-10 px-8 py-10">
        <section className="space-y-3">
          <p className="text-sm leading-relaxed text-white/55">
            Configure how decks are edited and where keys live.{" "}
            <strong className="text-white/80">Generate, update, and chat</strong> run from the{" "}
            <strong className="text-white/80">deck panel</strong> on the viewer (Web mode only)—
            not on this page.
          </p>
        </section>

        {/* ── Deck editing mode ─────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
            Deck editing
          </h2>
          <p className="text-xs leading-relaxed text-white/35">
            <span className="text-white/80">Web</span> — the browser calls{" "}
            <code className="opacity-60">/api/generate</code> and{" "}
            <code className="opacity-60">/api/chat-update</code> from the deck panel.{" "}
            <span className="text-white/80">Claude Code (MCP)</span> — you edit slides only via
            MCP tools; this site does not run those APIs from the UI.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(["web", "mcp"] as DeckSource[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSettings((s) => ({ ...s, deckSource: mode }))}
                className={`relative rounded-lg border px-5 py-4 text-left transition-all ${
                  settings.deckSource === mode
                    ? "border-white/60 bg-white/5"
                    : "border-white/10 hover:border-white/25"
                }`}
              >
                {settings.deckSource === mode && (
                  <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-white" />
                )}
                <p className="text-sm font-medium">
                  {mode === "web" ? "Web (API)" : "Claude Code (MCP)"}
                </p>
                <p className="mt-0.5 text-xs opacity-40">
                  {mode === "web" ? "Deck panel + APIs" : "MCP tools only"}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* ── Panel side (Web only) ─────────────────────────────────────── */}
        {isWeb && (
          <section className="space-y-4 border-t border-white/8 pt-10">
            <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
              Deck panel position
            </h2>
            <p className="text-xs text-white/35">
              When the panel is closed, a narrow strip stays on the edge to reopen it.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(["left", "right"] as PanelSide[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, panelSide: side }))}
                  className={`relative rounded-lg border px-5 py-4 text-left transition-all ${
                    settings.panelSide === side
                      ? "border-white/60 bg-white/5"
                      : "border-white/10 hover:border-white/25"
                  }`}
                >
                  {settings.panelSide === side && (
                    <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-white" />
                  )}
                  <p className="text-sm font-medium capitalize">{side}</p>
                  <p className="mt-0.5 text-xs opacity-40">
                    {side === "right" ? "Panel opens from the right" : "Panel opens from the left"}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Keyboard shortcuts ────────────────────────────────────────── */}
        {isWeb && (
          <section className="space-y-4 border-t border-white/8 pt-10">
            <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
              Keyboard shortcuts
            </h2>
            <p className="text-xs text-white/35">
              On Windows/Linux, use <kbd className="rounded bg-white/10 px-1">Ctrl</kbd> instead of{" "}
              <kbd className="rounded bg-white/10 px-1">⌘</kbd>.
            </p>
            <ul className="space-y-3 text-sm text-white/70">
              <li className="flex flex-col gap-1 border-b border-white/5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Toggle deck panel</span>
                <span className="flex flex-wrap items-center gap-2">
                  <kbd className="rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-xs">
                    {mod}/
                  </kbd>
                  <span className="text-xs text-white/35">or</span>
                  <kbd className="rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-xs">
                    {mod}.
                  </kbd>
                </span>
              </li>
              <li className="flex flex-col gap-1 border-b border-white/5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Open panel → Chat</span>
                <kbd className="w-fit rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-xs">
                  {mod}⇧K
                </kbd>
              </li>
              <li className="flex flex-col gap-1 border-b border-white/5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Open panel → New deck</span>
                <kbd className="w-fit rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-xs">
                  {mod}G
                </kbd>
              </li>
              <li className="flex flex-col gap-1 border-b border-white/5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Open panel → Update</span>
                <kbd className="w-fit rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-xs">
                  {mod}⇧U
                </kbd>
              </li>
              <li className="flex flex-col gap-1 border-b border-white/5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Close panel</span>
                <kbd className="w-fit rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-xs">
                  Esc
                </kbd>
              </li>
              <li className="flex flex-col gap-1 border-b border-white/5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Export PPTX</span>
                <kbd className="w-fit rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-xs">
                  {mod}E
                </kbd>
              </li>
              <li className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span>Settings (this page)</span>
                <kbd className="w-fit rounded border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-xs">
                  {mod},
                </kbd>
              </li>
            </ul>
          </section>
        )}

        {!isWeb && (
          <section className="space-y-4 border-t border-white/8 pt-10">
            <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
              MCP workflow
            </h2>
            <p className="text-sm leading-relaxed text-white/60">
              Connect Claude Code to this app’s MCP endpoint (stdio locally or HTTP on deploy).
              Use tools such as <code className="text-xs opacity-80">get_slides</code>,{" "}
              <code className="text-xs opacity-80">list_slide_types</code>, and{" "}
              <code className="text-xs opacity-80">set_slides</code>—Claude builds or edits JSON;
              this UI does not call the generate APIs.
            </p>
            <p className="text-xs text-white/35">
              The viewer reads <code className="opacity-50">localStorage</code>. After MCP changes,
              sync JSON into the browser the way you deploy.
            </p>
          </section>
        )}

        {isWeb && (
          <>
            <section className="space-y-4 border-t border-white/8 pt-10">
              <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
                AI Provider
              </h2>

              <div className="grid grid-cols-2 gap-3">
                {(["anthropic", "openai"] as Provider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, provider: p }))}
                    className={`relative rounded-lg border px-5 py-4 text-left transition-all ${
                      settings.provider === p
                        ? "border-white/60 bg-white/5"
                        : "border-white/10 hover:border-white/25"
                    }`}
                  >
                    {settings.provider === p && (
                      <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-white" />
                    )}
                    <p className="text-sm font-medium">
                      {p === "anthropic" ? "Claude" : "OpenAI"}
                    </p>
                    <p className="mt-0.5 text-xs opacity-40">
                      {p === "anthropic" ? "Anthropic · claude-sonnet-4-6" : "OpenAI · gpt-4o"}
                    </p>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest opacity-40">
                API Key
                <span className="ml-2 font-normal normal-case tracking-normal opacity-60">
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
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm transition-colors placeholder:opacity-25 focus:border-white/30 focus:outline-none"
                />
                <p className="text-xs opacity-25">
                  Stored in <code>localStorage</code> — forwarded only to{" "}
                  {settings.provider === "anthropic" ? "api.anthropic.com" : "api.openai.com"} when
                  you generate or update from the deck panel.
                </p>
              </div>
            </section>
          </>
        )}

        <button
          type="button"
          onClick={handleSave}
          className="rounded-lg border border-white/20 px-5 py-2.5 text-sm transition-colors hover:bg-white/5"
        >
          {status.type === "saved" ? "✓ Saved" : "Save settings"}
        </button>
      </main>
    </div>
  );
}
