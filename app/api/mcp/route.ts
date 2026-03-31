/**
 * AutoSlides HTTP MCP Endpoint
 *
 * Implements the MCP Streamable HTTP transport so Claude Code can connect
 * to the deployed Vercel app at https://<your-app>.vercel.app/api/mcp
 *
 * Authentication
 * ──────────────
 * Set MCP_SECRET in Vercel env vars. Claude Code then sends:
 *   Authorization: Bearer <MCP_SECRET>
 *
 * Storage notes
 * ─────────────
 * Vercel's filesystem is read-only at runtime. Write tools (set_slides,
 * add_slide, update_slide, delete_slide) return the modified slide array
 * as JSON content instead of persisting it. Copy the result back to
 * data/mcp-slides.json and redeploy, or set up Vercel Blob/KV for live writes.
 *
 * In local dev (no VERCEL env var) write tools write to disk as normal.
 */

import { NextRequest } from "next/server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SlidesSchema, SlideSchema, TypographySchema, type Slide } from "@/schemas/slideSchema";
import { DEFAULT_SLIDES } from "@/lib/defaultSlides";

// ── Storage helpers ───────────────────────────────────────────────────────────

const SLIDES_PATH = join(process.cwd(), "data/mcp-slides.json");
const IS_VERCEL = !!process.env.VERCEL;

function readSlides(): Slide[] {
  if (!existsSync(SLIDES_PATH)) {
    return DEFAULT_SLIDES;
  }
  try {
    const raw = JSON.parse(readFileSync(SLIDES_PATH, "utf-8"));
    return SlidesSchema.parse(raw);
  } catch {
    return DEFAULT_SLIDES;
  }
}

function writeSlides(slides: Slide[]): void {
  SlidesSchema.parse(slides);
  writeFileSync(SLIDES_PATH, JSON.stringify(slides, null, 2) + "\n");
}

/** On Vercel the filesystem is read-only. Return the result instead of writing. */
function applyWrite(
  slides: Slide[]
): { persisted: true } | { persisted: false; slides: Slide[] } {
  if (IS_VERCEL) {
    return { persisted: false, slides };
  }
  writeSlides(slides);
  return { persisted: true };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req: NextRequest): Response | null {
  const secret = process.env.MCP_SECRET;
  if (!secret) return null; // no secret configured — open access (local dev)

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}

// ── MCP server factory ────────────────────────────────────────────────────────

function createMCPServer(): Server {
  const server = new Server(
    { name: "autoslides", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // ── Tool list ───────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_slides",
        description: "Read all slides from the current presentation. Returns each slide annotated with its 1-based page number.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_slide",
        description:
          "Get a specific slide by 1-based page number. Pass page=0 to return the full presentation data (total count + all slides with page numbers).",
        inputSchema: {
          type: "object",
          required: ["page"],
          properties: {
            page: {
              type: "number",
              description: "1-based slide number. Pass 0 to return all slides with metadata.",
            },
          },
        },
      },
      {
        name: "set_slides",
        description: IS_VERCEL
          ? "Compute a new slide array (Zod-validated). On Vercel the result is returned as JSON — copy it to data/mcp-slides.json and redeploy to persist."
          : "Replace ALL slides in data/mcp-slides.json. Zod-validated before writing.",
        inputSchema: {
          type: "object",
          required: ["slides"],
          properties: {
            slides: {
              type: "array",
              description: "Array of slide objects.",
            },
          },
        },
      },
      {
        name: "add_slide",
        description: IS_VERCEL
          ? "Insert a slide and return the updated array. On Vercel copy the result to data/mcp-slides.json and redeploy to persist."
          : "Insert a slide at a specific position (0-based). Omit index to append.",
        inputSchema: {
          type: "object",
          required: ["slide"],
          properties: {
            slide: { type: "object" },
            index: {
              type: "number",
              description: "0-based insert position. Appends if omitted.",
            },
          },
        },
      },
      {
        name: "update_slide",
        description: IS_VERCEL
          ? "Overwrite a slide and return the updated array. On Vercel copy the result to data/mcp-slides.json and redeploy to persist."
          : "Overwrite a single slide at a specific 0-based index.",
        inputSchema: {
          type: "object",
          required: ["index", "slide"],
          properties: {
            index: { type: "number" },
            slide: { type: "object" },
          },
        },
      },
      {
        name: "delete_slide",
        description: IS_VERCEL
          ? "Remove a slide and return the updated array. On Vercel copy the result to data/mcp-slides.json and redeploy to persist."
          : "Remove the slide at a specific 0-based index.",
        inputSchema: {
          type: "object",
          required: ["index"],
          properties: {
            index: { type: "number" },
          },
        },
      },
      {
        name: "generate_slides",
        description:
          "Generate a full presentation from a topic using AI (OpenAI). Returns the slide array. On Vercel, use set_slides afterwards to persist.",
        inputSchema: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: {
              type: "string",
              description: "Topic to generate slides about (max 200 chars).",
            },
          },
        },
      },
      {
        name: "set_typography",
        description:
          "Apply typography settings to slides. Pass page=0 (or omit) to apply to ALL slides at once; pass page=N (1-based) to update a single slide only. Typography controls font family, heading/body/muted/accent colors, sizes, weight, alignment, and line height. Supports rich text markers in string fields: **bold**, _italic_, __underline__, `code`.",
        inputSchema: {
          type: "object",
          required: ["typography"],
          properties: {
            page: {
              type: "number",
              description: "0 or omitted = all slides. 1-based page number = that slide only.",
            },
            typography: {
              type: "object",
              description: "Typography overrides. All fields optional.",
              properties: {
                fontFamily: { type: "string", description: "CSS font family e.g. 'Georgia', 'Inter'" },
                headingColor: { type: "string", description: "Hex color e.g. '#6366f1'" },
                headingSize: { type: "number", description: "px (web) / pt (PPTX), e.g. 48" },
                headingWeight: { type: "string", enum: ["normal", "medium", "semibold", "bold"] },
                headingAlign: { type: "string", enum: ["left", "center", "right"] },
                bodyColor: { type: "string", description: "Hex color for body text" },
                bodySize: { type: "number", description: "px (web) / pt (PPTX)" },
                bodyAlign: { type: "string", enum: ["left", "center", "right"] },
                mutedColor: { type: "string", description: "Hex color for secondary/muted text" },
                accentColor: { type: "string", description: "Hex color for borders and highlights" },
                lineHeight: { type: "number", description: "Multiplier e.g. 1.6" },
              },
            },
          },
        },
      },
      {
        name: "list_slide_types",
        description:
          "Describe all available slide types, typography options, and rich text markers.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  // ── Tool handlers ───────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    try {
      switch (name) {
        // ── get_slides ──────────────────────────────────────────────────────
        case "get_slides": {
          const slides = readSlides();
          const annotated = slides.map((slide, i) => ({ page: i + 1, ...slide }));
          return {
            content: [{ type: "text", text: JSON.stringify({ total: slides.length, slides: annotated }, null, 2) }],
          };
        }

        // ── get_slide ───────────────────────────────────────────────────────
        case "get_slide": {
          const slides = readSlides();
          const page = Number(args.page);
          if (page === 0) {
            const annotated = slides.map((slide, i) => ({ page: i + 1, ...slide }));
            return {
              content: [{ type: "text", text: JSON.stringify({ total: slides.length, slides: annotated }, null, 2) }],
            };
          }
          if (!Number.isInteger(page) || page < 1 || page > slides.length) {
            throw new Error(`page must be 0 (all) or 1–${slides.length}`);
          }
          const slide = slides[page - 1];
          return {
            content: [{ type: "text", text: JSON.stringify({ page, total: slides.length, slide }, null, 2) }],
          };
        }

        // ── set_slides ──────────────────────────────────────────────────────
        case "set_slides": {
          if (!Array.isArray(args.slides)) throw new Error('"slides" must be an array');
          const slides = SlidesSchema.parse(args.slides);
          const result = applyWrite(slides);
          const msg = result.persisted
            ? `Wrote ${slides.length} slides to data/mcp-slides.json.`
            : `Computed ${slides.length} slides. Filesystem is read-only on Vercel — copy the JSON below to data/mcp-slides.json and redeploy:\n\n${JSON.stringify(slides, null, 2)}`;
          return { content: [{ type: "text", text: msg }] };
        }

        // ── add_slide ───────────────────────────────────────────────────────
        case "add_slide": {
          const slides = readSlides();
          const slide = SlideSchema.parse(args.slide);
          const idx =
            args.index !== undefined && args.index !== null
              ? Number(args.index)
              : slides.length;
          if (idx < 0 || idx > slides.length)
            throw new Error(`index ${idx} out of range (0–${slides.length})`);
          slides.splice(idx, 0, slide);
          const result = applyWrite(slides);
          const msg = result.persisted
            ? `Inserted slide at index ${idx}. Total: ${slides.length} slides.`
            : `Computed insert at index ${idx}. Filesystem is read-only on Vercel — copy the JSON below to data/mcp-slides.json and redeploy:\n\n${JSON.stringify(slides, null, 2)}`;
          return { content: [{ type: "text", text: msg }] };
        }

        // ── update_slide ────────────────────────────────────────────────────
        case "update_slide": {
          const slides = readSlides();
          const idx = Number(args.index);
          if (idx < 0 || idx >= slides.length)
            throw new Error(`index ${idx} out of range (0–${slides.length - 1})`);
          slides[idx] = SlideSchema.parse(args.slide);
          const result = applyWrite(slides);
          const msg = result.persisted
            ? `Updated slide at index ${idx}.`
            : `Computed update at index ${idx}. Filesystem is read-only on Vercel — copy the JSON below to data/mcp-slides.json and redeploy:\n\n${JSON.stringify(slides, null, 2)}`;
          return { content: [{ type: "text", text: msg }] };
        }

        // ── delete_slide ────────────────────────────────────────────────────
        case "delete_slide": {
          const slides = readSlides();
          const idx = Number(args.index);
          if (idx < 0 || idx >= slides.length)
            throw new Error(`index ${idx} out of range (0–${slides.length - 1})`);
          const [removed] = slides.splice(idx, 1);
          const result = applyWrite(slides);
          const msg = result.persisted
            ? `Deleted slide at index ${idx} (type: "${removed.type}"). Total: ${slides.length} slides.`
            : `Computed delete at index ${idx} (type: "${removed.type}"). Filesystem is read-only on Vercel — copy the JSON below to data/mcp-slides.json and redeploy:\n\n${JSON.stringify(slides, null, 2)}`;
          return { content: [{ type: "text", text: msg }] };
        }

        // ── generate_slides ─────────────────────────────────────────────────
        case "generate_slides": {
          const topic =
            typeof args.topic === "string" ? args.topic.trim() : "";
          if (!topic) throw new Error('"topic" is required');
          if (topic.length > 200)
            throw new Error('"topic" must be 200 characters or fewer');

          const base =
            process.env.NEXT_PUBLIC_APP_URL ??
            (IS_VERCEL
              ? `https://${process.env.VERCEL_URL}`
              : "http://localhost:3000");

          const res = await fetch(`${base}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ topic }),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(`/api/generate failed (${res.status}): ${err.error ?? res.statusText}`);
          }

          const slides: Slide[] = await res.json();
          return {
            content: [
              {
                type: "text",
                text: `Generated ${slides.length} slides for "${topic}".\nUse set_slides to apply them.\n\n${JSON.stringify(slides, null, 2)}`,
              },
            ],
          };
        }

        // ── set_typography ──────────────────────────────────────────────────
        case "set_typography": {
          const slides = readSlides();
          const typography = TypographySchema.parse(args.typography ?? {});
          const page = args.page !== undefined ? Number(args.page) : 0;

          if (page === 0) {
            const updated = slides.map((slide) => ({ ...slide, typography }));
            const result = applyWrite(SlidesSchema.parse(updated));
            const msg = result.persisted
              ? `Applied typography to all ${slides.length} slides.`
              : `Computed typography update for all ${slides.length} slides. Filesystem is read-only on Vercel — copy the JSON below to data/mcp-slides.json and redeploy:\n\n${JSON.stringify(SlidesSchema.parse(updated), null, 2)}`;
            return { content: [{ type: "text", text: msg }] };
          } else {
            if (!Number.isInteger(page) || page < 1 || page > slides.length) {
              throw new Error(`page must be 0 (all) or 1–${slides.length}`);
            }
            const idx = page - 1;
            const updated = slides.map((slide, i) =>
              i === idx ? { ...slide, typography } : slide
            );
            const result = applyWrite(SlidesSchema.parse(updated));
            const msg = result.persisted
              ? `Applied typography to slide ${page} (${slides[idx].type}).`
              : `Computed typography update for slide ${page}. Filesystem is read-only on Vercel — copy the JSON below to data/mcp-slides.json and redeploy:\n\n${JSON.stringify(SlidesSchema.parse(updated), null, 2)}`;
            return { content: [{ type: "text", text: msg }] };
          }
        }

        // ── list_slide_types ────────────────────────────────────────────────
        case "list_slide_types": {
          const description = `All slide types share: "theme": "light" | "dark" (defaults to "dark").

Optional typography object (per slide — use set_typography to apply):
  fontFamily    string           CSS font family e.g. "Georgia", "Inter"
  headingColor  string           Hex color e.g. "#6366f1"
  headingSize   number           px (web) / pt (PPTX export), e.g. 48
  headingWeight "normal"|"medium"|"semibold"|"bold"
  headingAlign  "left"|"center"|"right"
  bodyColor     string           Hex color for body/bullet text
  bodySize      number           px / pt
  bodyAlign     "left"|"center"|"right"
  mutedColor    string           Hex color for secondary text
  accentColor   string           Hex color for borders/highlights
  lineHeight    number           Multiplier e.g. 1.6

Rich text markers (in any string field):
  **bold**  _italic_  __underline__  \`code\`

title
  Required: title (string)
  Optional: subtitle (string)

content
  Required: title (string), points (string[], 1–6 items)

two-column
  Required: title (string)
            left  { heading?: string, points: string[] }
            right { heading?: string, points: string[] }

three-column
  Required: title (string)
            columns — exactly 3 objects: { heading: string, body: string }

cards
  Required: title (string)
            cards — 2–6 objects: { title: string, description: string, icon?: string }

stats
  Required: title (string)
            stats — 2–4 objects: { value: string, label: string }

quote
  Required: quote (string)
  Optional: author (string)

image
  Required: title (string), imageUrl (string)
  Optional: caption (string)

end
  Required: title (string)`;
          return { content: [{ type: "text", text: description }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: String(err) }],
      };
    }
  });

  return server;
}

// ── Route handler ─────────────────────────────────────────────────────────────

async function handler(req: NextRequest): Promise<Response> {
  const authError = checkAuth(req);
  if (authError) return authError;

  const server = createMCPServer();

  // Stateless mode: sessionIdGenerator = undefined
  // Each serverless invocation is independent — no in-memory session state.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handler as GET, handler as POST, handler as DELETE };
