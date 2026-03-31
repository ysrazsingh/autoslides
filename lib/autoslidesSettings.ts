/** How the user edits decks: browser APIs vs Claude Code MCP only. */
export type DeckSource = "web" | "mcp";

export const SETTINGS_KEY = "autoslides_settings";

export function getDeckSource(): DeckSource {
  if (typeof window === "undefined") return "web";
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return "web";
    const o = JSON.parse(raw) as { deckSource?: string };
    return o.deckSource === "mcp" ? "mcp" : "web";
  } catch {
    return "web";
  }
}
