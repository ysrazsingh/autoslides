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

### Rendering pipeline

```
data/slides.json  →  SlidesSchema.parse()  →  renderSlide()  →  rendered full-screen slide
```

`app/page.tsx` is the entire client-side app: parses slides once at module scope (with try/catch), handles keyboard navigation (←/→/Space/Enter), and renders the active slide full-screen with a fade-in animation via `tw-animate-css`. No `mounted` guard — `useState(0)` renders identically on server and client.

### Slide system — the three-file rule

Every slide type has three co-located pieces that must stay in sync:

| Piece | Location | Purpose |
|-------|----------|---------|
| Zod schema | `schemas/slideSchema.ts` | Single source of truth; used for static JSON and AI output validation |
| React component | `components/slides/*.tsx` | Props typed with `z.infer<typeof XSlideSchema>` |
| `case` in registry | `components/slides/registry.tsx` | Maps discriminated union variant → component via type-safe `switch` |

`SlideSchema` is a `z.discriminatedUnion("type", [...])`. The `switch` in `registry.tsx` exhaustively covers every variant — TypeScript will error if a new schema is added but the case is missing.

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

All types share `theme: "light" | "dark"` (defaults to `"dark"` after Zod parse).

### Adding a new slide type (checklist)

1. Add a `z.object({ type: z.literal("new-type"), ... })` schema to `schemas/slideSchema.ts` and include it in `SlideSchema`'s discriminated union
2. Export the inferred type: `export type NewTypeSlide = z.infer<typeof NewTypeSlideSchema>`
3. Create `components/slides/NewTypeSlide.tsx` — props typed with the exported type
4. Add `case "new-type": return <NewTypeSlide {...slide} />;` in `components/slides/registry.tsx`
5. Add an example entry to `data/slides.json`

### AI generation

`app/api/generate/route.ts` — POST `{ topic: string }` (max 200 chars). Calls OpenAI (`gpt-4.1-mini`) with a system prompt describing all available slide types and their schemas. Strips markdown fences, parses JSON, validates with `SlidesSchema`. Returns validated array or structured error (400/502/500). Requires `OPENAI_API_KEY` env var.

### Key conventions

- `@/` alias maps to repo root (not `app/`): components in `components/`, schemas in `schemas/`, data in `data/`
- Tailwind dynamic class strings don't work — `CardsSlide` and `StatsSlide` use explicit lookup tables for `grid-cols-*`
- `theme` is applied in `app/page.tsx` (bg/text at page level); slide components themselves are theme-agnostic and use `opacity-*` / `bg-current` / `border-current` for relative styling
- `data/slides.json` is the static demo deck; the `/api/generate` endpoint is API-only (no UI trigger yet)

### MCP server

Two transports are available — use whichever matches your setup.

#### Local (stdio) — for development

`.mcp.json` at the repo root is auto-discovered by Claude Code when you open this directory. No setup needed.

Manual register (if needed):
```bash
claude mcp add autoslides -- npx tsx /Users/yashraj/Documents/autoslides/mcp-server.ts
```

Reads and writes `data/slides.json` directly on disk.

#### Remote (HTTP) — for Vercel deployment

The endpoint lives at `https://<your-app>.vercel.app/api/mcp` (`app/api/mcp/route.ts`).

**Step 1 — set env vars in Vercel:**

| Variable | Purpose |
|----------|---------|
| `MCP_SECRET` | Bearer token Claude Code will send. Pick any strong random string. |
| `OPENAI_API_KEY` | Already required for `/api/generate` |

**Step 2 — register in Claude Code (run once):**
```bash
claude mcp add --transport http \
  --header "Authorization: Bearer <your-MCP_SECRET>" \
  autoslides-remote \
  https://<your-app>.vercel.app/api/mcp
```

Or add manually to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "autoslides-remote": {
      "type": "http",
      "url": "https://<your-app>.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <your-MCP_SECRET>" }
    }
  }
}
```

**Storage behaviour on Vercel:**
Vercel's filesystem is read-only at runtime. Read tools (`get_slides`, `list_slide_types`, `generate_slides`) work normally. Write tools (`set_slides`, `add_slide`, `update_slide`, `delete_slide`) return the computed slide array as JSON — copy it into `data/slides.json` locally and redeploy to persist.

#### Available tools (both transports)

| Tool | Description |
|------|-------------|
| `get_slides` | Read the current slide array |
| `set_slides` | Replace all slides (Zod-validated) |
| `add_slide` | Insert a slide at an index (or append) |
| `update_slide` | Overwrite a slide at an index |
| `delete_slide` | Remove a slide at an index |
| `generate_slides` | Generate slides from a topic via OpenAI (HTTP only) |
| `list_slide_types` | Describe all slide types and their fields |
