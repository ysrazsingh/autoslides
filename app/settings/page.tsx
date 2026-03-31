"use client";

import { useState, useEffect, type ReactNode } from "react";
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

const DEFAULTS: Settings = {
  provider: "anthropic",
  anthropicKey: "",
  openaiKey: "",
  deckSource: "web",
  panelSide: "right",
};

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
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
  return DEFAULTS;
}

function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function getActiveSettings(): Settings {
  return loadSettings();
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/35">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Pill({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-lg border px-4 py-3 text-left transition-all ${
        active
          ? "border-white/40 bg-white/[0.06]"
          : "border-white/[0.06] hover:border-white/15"
      }`}
    >
      {active && (
        <span className="absolute top-2.5 right-2.5 h-1.5 w-1.5 rounded-full bg-white" />
      )}
      <p className="text-sm font-medium text-white/90">{label}</p>
      <p className="mt-0.5 text-xs text-white/35">{hint}</p>
    </button>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [status, setStatus] = useState<"idle" | "saved">("idle");

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      if (e.key === "Escape") { e.preventDefault(); router.push("/"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  function handleSave() {
    saveSettings(settings);
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  const activeKey =
    settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;
  const isWeb = settings.deckSource === "web";

  const mod =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-8 py-4">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-sm text-white/40 transition hover:text-white/80"
        >
          ← Back
        </button>
        <span className="text-sm font-medium tracking-wide text-white/50">Settings</span>
        <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/25">
          Esc
        </kbd>
      </header>

      {/* ── Two-column layout ───────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-8">
        <div className="grid gap-5 md:grid-cols-2">
          {/* ── Mode ──────────────────────────────────────────────── */}
          <Card title="Mode">
            <div className="grid grid-cols-2 gap-2.5">
              <Pill
                active={settings.deckSource === "web"}
                onClick={() => setSettings((s) => ({ ...s, deckSource: "web" }))}
                label="Web"
                hint="Panel + APIs"
              />
              <Pill
                active={settings.deckSource === "mcp"}
                onClick={() => setSettings((s) => ({ ...s, deckSource: "mcp" }))}
                label="MCP"
                hint="Claude Code tools"
              />
            </div>
          </Card>

          {/* ── Panel position ────────────────────────────────────── */}
          {isWeb && (
            <Card title="Panel position">
              <div className="grid grid-cols-2 gap-2.5">
                <Pill
                  active={settings.panelSide === "left"}
                  onClick={() => setSettings((s) => ({ ...s, panelSide: "left" }))}
                  label="Left"
                  hint="Dock left"
                />
                <Pill
                  active={settings.panelSide === "right"}
                  onClick={() => setSettings((s) => ({ ...s, panelSide: "right" }))}
                  label="Right"
                  hint="Dock right"
                />
              </div>
            </Card>
          )}

          {/* ── AI Provider ───────────────────────────────────────── */}
          {isWeb && (
            <Card title="AI provider">
              <div className="grid grid-cols-2 gap-2.5">
                <Pill
                  active={settings.provider === "anthropic"}
                  onClick={() => setSettings((s) => ({ ...s, provider: "anthropic" }))}
                  label="Claude"
                  hint="Anthropic"
                />
                <Pill
                  active={settings.provider === "openai"}
                  onClick={() => setSettings((s) => ({ ...s, provider: "openai" }))}
                  label="OpenAI"
                  hint="gpt-4o"
                />
              </div>
            </Card>
          )}

          {/* ── API key ───────────────────────────────────────────── */}
          {isWeb && (
            <Card title="API key">
              <input
                type="password"
                name="autoslides-key"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                placeholder={
                  settings.provider === "anthropic"
                    ? "sk-ant-… (or leave blank for env)"
                    : "sk-… (or leave blank for env)"
                }
                value={activeKey}
                onChange={(e) =>
                  setSettings((s) =>
                    settings.provider === "anthropic"
                      ? { ...s, anthropicKey: e.target.value }
                      : { ...s, openaiKey: e.target.value }
                  )
                }
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 font-mono text-sm text-white/80 placeholder:text-white/20 focus:border-white/20 focus:outline-none"
              />
              <p className="mt-2 text-xs text-white/25">
                Forwarded only to{" "}
                {settings.provider === "anthropic" ? "api.anthropic.com" : "api.openai.com"}
              </p>
            </Card>
          )}

          {/* ── MCP info ──────────────────────────────────────────── */}
          {!isWeb && (
            <Card title="MCP workflow">
              <p className="text-sm leading-relaxed text-white/50">
                Use Claude Code with MCP tools:{" "}
                <code className="text-white/70">get_slides</code>,{" "}
                <code className="text-white/70">set_slides</code>,{" "}
                <code className="text-white/70">list_slide_types</code>.
                No browser API calls in this mode.
              </p>
            </Card>
          )}

          {/* ── Shortcuts (full width, individual rows) ───────────── */}
          {isWeb && (
            <div className="md:col-span-2">
              <Card title="Keyboard shortcuts">
                <div className="grid gap-1.5">
                  {([
                    ["Toggle panel", `${mod}/`, `${mod}.`],
                    ["Open Chat", `${mod}⇧K`],
                    ["New deck", `${mod}G`],
                    ["Update existing", `${mod}⇧U`],
                    ["Export PPTX", `${mod}E`],
                    ["Settings", `${mod},`],
                    ["Close panel / Back", "Esc"],
                  ] as string[][]).map(([label, ...keys]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-lg bg-white/[0.02] px-4 py-2.5"
                    >
                      <span className="text-sm text-white/60">{label}</span>
                      <span className="flex items-center gap-2">
                        {keys.map((k) => (
                          <kbd
                            key={k}
                            className="rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-mono text-xs text-white/35"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>

        {/* ── Save button ──────────────────────────────────────────── */}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-white/[0.06] px-6 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/[0.1]"
          >
            {status === "saved" ? "✓ Saved" : "Save"}
          </button>
        </div>
      </main>
    </div>
  );
}
