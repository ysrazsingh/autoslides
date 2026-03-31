/** How the user edits decks: browser APIs vs Claude Code MCP only. */
export type DeckSource = "web" | "mcp";

/** Where the deck panel docks in the viewer. */
export type PanelSide = "left" | "right";

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

export function getPanelSide(): PanelSide {
  if (typeof window === "undefined") return "right";
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return "right";
    const o = JSON.parse(raw) as { panelSide?: string };
    return o.panelSide === "left" ? "left" : "right";
  } catch {
    return "right";
  }
}
