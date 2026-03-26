# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # Next.js ESLint (next lint)
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
