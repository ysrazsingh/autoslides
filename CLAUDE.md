# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # Next.js ESLint (next lint)
npm run mcp      # Start the MCP server (stdio transport)
```

No test suite is configured.

## Architecture

**AutoSlides** is an AI-powered slide presentation app (Next.js 16, App Router, React 19, Tailwind 4, Zod 4).

### Data flow

```
localStorage ("autoslides_generated")
  → SlidesSchema.parse()
  → renderSlide()
  → full-screen slide in the viewer
```

There is no `data/slides.json`. The browser stores slides in `localStorage` (key: `autoslides_generated`). On first load `lib/defaultSlides.ts` provides a demo deck. The MCP server uses a separate file (`data/mcp-slides.json`, git-ignored) with fallback to `DEFAULT_SLIDES`.

### Two editing modes

| Mode | Source of truth | How slides are edited |
|------|----------------|-----------------------|
| **Web** (default) | `localStorage` | Browser calls `/api/deck` via the deck panel |
| **Claude Code (MCP)** | `data/mcp-slides.json` | Claude uses MCP tools directly; the web UI makes no API calls |

Users toggle between modes on the Settings page. The mode is stored in `localStorage` under `autoslides_settings`.

### Rendering pipeline

`app/page.tsx` — client component that:
- Loads slides from `localStorage` on mount (falls back to `DEFAULT_SLIDES`)
- Handles keyboard navigation (←/→/Space/Enter), skipping when an input is focused
- Renders slides full-screen with `animate-fade-in` (tw-animate-css)
- Houses the deck panel (sidebar) with real-time updates via React state
- Provides global keyboard shortcuts (⌘/ ⌘. ⌘⇧K ⌘G ⌘⇧U ⌘E ⌘, Esc)
- Updates slides in real-time — `handleSlidesUpdated()` writes to `localStorage` and calls `setSlides()`, no page refresh needed

### Slide system — the three-file rule

Every slide type has three co-located pieces that must stay in sync:

| Piece | Location | Purpose |
|-------|----------|---------|
| Zod schema | `schemas/slideSchema.ts` | Single source of truth; validates JSON from AI and MCP |
| React component | `components/slides/*.tsx` | Props typed with `z.infer<typeof XSlideSchema>` |
| `case` in registry | `components/slides/registry.tsx` | Maps discriminated union variant → component via `switch` |

`SlideSchema` is a `z.discriminatedUnion("type", [...])`. TypeScript errors if a new schema is added but the registry case is missing.

### Available slide types

| type | Key fields |
|------|------------|
| `title` | `title`, `subtitle?` |
| `content` | `title`, `points[]` |
| `two-column` | `title`, `left{heading?,points[]}`, `right{heading?,points[]}` |
| `three-column` | `title`, `columns[3]{heading,body}` |
| `cards` | `title`, `cards[2–6]{icon?,title,description}` |
| `stats` | `title`, `stats[2–4]{value,label}` |
| `quote` | `quote`, `author?` |
| `image` | `title`, `imageUrl`, `caption?` |
| `end` | `title` |

All types share `theme: "light" | "dark"` (defaults to `"dark"`) and an optional `typography` object.

### Typography system

`schemas/slideSchema.ts` defines `TypographySchema` — all fields optional: `fontFamily`, `headingColor`, `headingSize`, `headingWeight`, `headingAlign`, `bodyColor`, `bodySize`, `bodyAlign`, `mutedColor`, `accentColor`, `lineHeight`.

`components/typography.ts` converts the schema into CSS style objects (`root`, `heading`, `body`, `muted`, `accent`). Every slide component calls `typo(typography)` and spreads the result.

Rich text markers are supported in any string field: `**bold**`, `_italic_`, `__underline__`, `` `code` ``. Rendered by `components/RichText.tsx` in the web UI and stripped for PPTX export.

### Adding a new slide type (checklist)

1. Add a `z.object({ type: z.literal("new-type"), ... })` schema to `schemas/slideSchema.ts` and include it in `SlideSchema`'s discriminated union
2. Export the inferred type: `export type NewTypeSlide = z.infer<typeof NewTypeSlideSchema>`
3. Create `components/slides/NewTypeSlide.tsx` — props typed with the exported type
4. Add `case "new-type": return <NewTypeSlide {...slide} />;` in `components/slides/registry.tsx`
5. Add a renderer in `app/api/export/route.ts` for the PPTX export

### Deck panel

`components/DeckPanel.tsx` — a sidebar chat interface with:
- **Header** at top (title + close button)
- **Chat area** in the middle (scrollable message log)
- **Composer** at the bottom (textarea + mode buttons + send button)

Three modes (buttons in composer), all routed through `/api/deck`:
- **Chat** (default) — streaming conversation about the deck (SSE), no slide JSON emitted
- **Create new** (`mode: "new"`) — generate a fresh deck from a topic prompt (SSE + tool calling)
- **Update existing** (`mode: "update"`) — one-shot edit of the existing deck (SSE + tool calling)

**`ChatLogItem` type:**
```typescript
{ role: "user" | "assistant"; text: string; usage?: { inputTokens, outputTokens }; suggestions?: string[] }
```

**UI features (as of April 2026):**
- Each message has a **copy button** (hover to reveal, `Copy`/`Check` icons from lucide-react)
- Assistant messages show **token counts** below the text: `"N in · N out"` at `text-[10px] text-white/25`
- After deck generation, **suggestion buttons** appear (click fills the draft textarea, no auto-send)
- **Status indicator** appears during tool calls: pulsing amber dot + italic status text
- Status clears automatically when real text deltas start flowing

**Key DeckPanel state:**
- `statusMsg: string | null` — current tool call status to display
- `streaming: string` — accumulated streaming text (last 6000 chars)
- The `consumeSSE` function has signature: `(body, onDelta, onStatus, signal?)`

All modes call `onSlidesUpdated` which is the single point of truth for persistence. The panel does NOT write to `localStorage` directly — that's handled by `page.tsx`'s `handleSlidesUpdated`.

### AI generation

Two providers supported: **Anthropic** (default chat: `claude-haiku-4-5-20251001`, deck: `claude-sonnet-4-6`) and **OpenAI** (chat: `gpt-4o-mini`, deck: `gpt-4o`).

**Single endpoint: `app/api/deck/route.ts`** — POST `{ mode, instruction, slides?, provider, apiKey?, stream?, history? }`.

| Field | Type | Notes |
|-------|------|-------|
| `mode` | `"chat"` \| `"new"` \| `"update"` | Inferred from `slides` if omitted |
| `instruction` | string (≤ 4000 chars) | Required |
| `slides` | `Slide[]` | Required for `update` mode |
| `stream` | boolean | Defaults to `false`; SSE when `true` |
| `history` | `ChatMessage[]` | Up to 8 messages of context |

- `mode: "chat"` — plain-text conversational reply; never emits slide JSON
- `mode: "new"` — generates a fresh deck (6–9 slides, title → end) **using tool calling**
- `mode: "update"` — edits the existing `slides` array per the instruction **using tool calling**

#### Tool calling pipeline (new/update modes only)

For `new` and `update`, the AI uses tools to look up schemas before generating JSON. This prevents schema errors and removes the need to embed full JSON examples in the system prompt.

**Tools available to the AI:**
- `list_slide_types` — returns all 9 type names + 1-line descriptions
- `get_slide_schema(type)` — returns a complete JSON example + field notes for one type (critical for `two-column`, `three-column`)
- `get_current_slides` — returns the current deck JSON (for `update` mode)

**Flow:**
1. Tool calls run non-streaming (up to `MAX_TOOL_ROUNDS = 5`)
2. Each tool call emits `{ type: "status", message: "..." }` SSE event
3. Model returns JSON after consulting schemas (usually rounds 2-3)
4. If model uses all rounds without outputting JSON → one final streaming call with no tools
5. Parse → repair-on-fail → fallback-on-repair-fail

**SSE event types** (expanded from original):
```
{ type: "status", message }          — tool call progress feedback
{ type: "delta", text }              — streaming text chunks
{ type: "done", slides?, reply?, usage?: { inputTokens, outputTokens }, suggestions?: string[] }
{ type: "error", message }
```

**Token tracking:** accumulated across ALL rounds (tool calls + final generation). Returned in `done` event.

**Suggestions:** hardcoded quick-reply options in `done` event (`SUGGESTIONS_NEW` / `SUGGESTIONS_UPDATE`). No extra API call.

API key resolution: request body → environment variable (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).

> **Deprecated** (do not use): `app/api/generate/route.ts`, `app/api/chat-update/route.ts`

#### Common generation failure: "only default slides visible"

Usually means the API key is wrong or missing. Steps:
1. Open Settings → verify provider (OpenAI vs Anthropic) matches the key you have
2. Check for error message in the DeckPanel — it shows the exact reason
3. If fallback deck shows ("AI generation encountered an issue"), it means the model returned invalid JSON AND repair failed — try a more specific prompt

#### Schema errors — why they happen and how they're prevented

The most error-prone slide types are `two-column` and `three-column`:
- `two-column`: `left` and `right` MUST be `{ heading?: string, points: string[] }` — NOT flat arrays
- `three-column`: `columns` MUST be exactly 3 items of `{ heading: string, body: string }` — NOT arrays of strings

The `get_slide_schema` tool returns these examples with IMPORTANT warning notes, which is how the AI avoids these errors. The `repairDeckWithModel` function also uses the full `SLIDE_EXAMPLES` map in its prompt.

### PPTX export

`app/api/export/route.ts` — builds PowerPoint files via `pptxgenjs`.
- **GET** — exports `DEFAULT_SLIDES` (legacy/demo endpoint)
- **POST** `{ slides, page? }` — exports slides from the request body (used by the browser)

### Key conventions

- `@/` alias maps to repo root: `components/`, `schemas/`, `lib/`, `app/`
- Tailwind dynamic class strings don't work — `CardsSlide` and `StatsSlide` use explicit lookup tables for `grid-cols-*`
- `theme` is applied in `app/page.tsx` (bg/text at page level); slide components are theme-agnostic
- Shared constants: `lib/constants.ts` (`GENERATED_KEY`), `lib/autoslidesSettings.ts` (types + getters)
- Settings page (`app/settings/page.tsx`) uses a two-column card layout; Esc returns to the viewer

### MCP server

Two transports — use whichever matches your setup.

#### Local (stdio) — for development

`.mcp.json` at the repo root is auto-discovered by Claude Code. No setup needed.

Manual register:
```bash
claude mcp add autoslides -- npx tsx mcp-server.ts
```

Reads and writes `data/mcp-slides.json` directly on disk (git-ignored).

#### Remote (HTTP) — for Vercel deployment

Endpoint: `https://<your-app>.vercel.app/api/mcp` (`app/api/mcp/route.ts`).

**Step 1 — set env vars in Vercel:**

| Variable | Purpose |
|----------|---------|
| `MCP_SECRET` | Bearer token for authentication (timing-safe comparison) |
| `ANTHROPIC_API_KEY` | For `/api/deck` |
| `OPENAI_API_KEY` | Alternative provider |

**Step 2 — register in Claude Code:**
```bash
claude mcp add --transport http \
  --header "Authorization: Bearer <your-MCP_SECRET>" \
  autoslides-remote \
  https://<your-app>.vercel.app/api/mcp
```

**Storage on Vercel:** Filesystem is read-only. Write tools return the computed array as JSON — copy it to `data/mcp-slides.json` locally and redeploy.

#### Available tools (both transports)

| Tool | Description |
|------|-------------|
| `get_slides` | Read all slides with page numbers |
| `get_slide` | Get a specific slide by page number (or page=0 for all) |
| `set_slides` | Replace all slides (Zod-validated) |
| `add_slide` | Insert a slide at an index (or append) |
| `update_slide` | Overwrite a slide at an index |
| `delete_slide` | Remove a slide at an index |
| `set_typography` | Apply typography to one or all slides |
| `list_slide_types` | Describe all slide types and their fields |

#### Generating slides in MCP mode

When Claude needs to **create or rewrite a full deck** in MCP mode, call `list_slide_types` to confirm the schema, then compose the slide array directly and pass it to `set_slides`. Do **not** call `/api/generate` or `/api/chat-update` — those routes are deprecated. The canonical AI generation endpoint is `/api/deck` (used by the web UI); in MCP mode Claude generates the JSON itself using the schema from `list_slide_types`.

Every slide **must** include `"theme": "dark"` or `"theme": "light"`. Omitting `theme` is not valid.
