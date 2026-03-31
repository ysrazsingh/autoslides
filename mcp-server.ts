#!/usr/bin/env node
/**
 * AutoSlides MCP Server
 *
 * Exposes tools for Claude Code to read and manage slides in data/slides.json.
 *
 * Tools:
 *   get_slides       — read all slides
 *   set_slides       — replace all slides (validates schema)
 *   add_slide        — insert a slide at a given index (or append)
 *   update_slide     — overwrite a slide at a given index
 *   delete_slide     — remove a slide at a given index
 *   list_slide_types — describe available slide types and their fields
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SlidesSchema, SlideSchema, TypographySchema, type Slide } from "./schemas/slideSchema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLIDES_PATH = join(__dirname, "data/slides.json");

function readSlides(): Slide[] {
  const raw = JSON.parse(readFileSync(SLIDES_PATH, "utf-8"));
  return SlidesSchema.parse(raw);
}

function writeSlides(slides: Slide[]): void {
  SlidesSchema.parse(slides); // validate before writing
  writeFileSync(SLIDES_PATH, JSON.stringify(slides, null, 2) + "\n");
}

// ── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "autoslides", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_slides",
      description: "Read all slides from data/slides.json. Returns the full slide array with 1-based page numbers.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_slide",
      description:
        "Get a specific slide by 1-based page number, or pass page=0 to get the full presentation data (total count + all slides with page numbers). Use this to inspect any exact slide.",
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
      description:
        "Replace ALL slides in data/slides.json. The array is validated against the Zod schema before writing — invalid slides are rejected with an error.",
      inputSchema: {
        type: "object",
        required: ["slides"],
        properties: {
          slides: {
            type: "array",
            description: "Array of slide objects. Use list_slide_types to see available schemas.",
          },
        },
      },
    },
    {
      name: "add_slide",
      description:
        "Insert a single slide at a specific position (0-based). Omit index to append at the end.",
      inputSchema: {
        type: "object",
        required: ["slide"],
        properties: {
          slide: {
            type: "object",
            description: "The slide to add. Must conform to one of the available slide schemas.",
          },
          index: {
            type: "number",
            description: "0-based position to insert. Appends if omitted.",
          },
        },
      },
    },
    {
      name: "update_slide",
      description: "Overwrite a single slide at a specific 0-based index.",
      inputSchema: {
        type: "object",
        required: ["index", "slide"],
        properties: {
          index: { type: "number", description: "0-based index of the slide to replace." },
          slide: { type: "object", description: "New slide data." },
        },
      },
    },
    {
      name: "delete_slide",
      description: "Remove the slide at a specific 0-based index.",
      inputSchema: {
        type: "object",
        required: ["index"],
        properties: {
          index: { type: "number", description: "0-based index of the slide to delete." },
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
        "Returns a description of every available slide type and their required/optional fields. Use this before creating or updating slides.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    switch (name) {
      // ── get_slides ───────────────────────────────────────────────────────
      case "get_slides": {
        const slides = readSlides();
        const annotated = slides.map((slide, i) => ({ page: i + 1, ...slide }));
        return {
          content: [{ type: "text", text: JSON.stringify({ total: slides.length, slides: annotated }, null, 2) }],
        };
      }

      // ── get_slide ────────────────────────────────────────────────────────
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

      // ── set_slides ───────────────────────────────────────────────────────
      case "set_slides": {
        if (!Array.isArray(args.slides)) {
          throw new Error('"slides" must be an array');
        }
        const slides = SlidesSchema.parse(args.slides);
        writeSlides(slides);
        return {
          content: [
            { type: "text", text: `Wrote ${slides.length} slides to data/slides.json.` },
          ],
        };
      }

      // ── add_slide ────────────────────────────────────────────────────────
      case "add_slide": {
        const slides = readSlides();
        const slide = SlideSchema.parse(args.slide);
        const idx =
          args.index !== undefined && args.index !== null
            ? Number(args.index)
            : slides.length;
        if (idx < 0 || idx > slides.length) {
          throw new Error(`index ${idx} out of range (0–${slides.length})`);
        }
        slides.splice(idx, 0, slide);
        writeSlides(slides);
        return {
          content: [
            {
              type: "text",
              text: `Inserted slide at index ${idx}. Total: ${slides.length} slides.`,
            },
          ],
        };
      }

      // ── update_slide ─────────────────────────────────────────────────────
      case "update_slide": {
        const slides = readSlides();
        const idx = Number(args.index);
        if (idx < 0 || idx >= slides.length) {
          throw new Error(`index ${idx} out of range (0–${slides.length - 1})`);
        }
        slides[idx] = SlideSchema.parse(args.slide);
        writeSlides(slides);
        return {
          content: [{ type: "text", text: `Updated slide at index ${idx}.` }],
        };
      }

      // ── delete_slide ─────────────────────────────────────────────────────
      case "delete_slide": {
        const slides = readSlides();
        const idx = Number(args.index);
        if (idx < 0 || idx >= slides.length) {
          throw new Error(`index ${idx} out of range (0–${slides.length - 1})`);
        }
        const [removed] = slides.splice(idx, 1);
        writeSlides(slides);
        return {
          content: [
            {
              type: "text",
              text: `Deleted slide at index ${idx} (type: "${removed.type}"). Total: ${slides.length} slides.`,
            },
          ],
        };
      }

      // ── set_typography ───────────────────────────────────────────────────
      case "set_typography": {
        const slides = readSlides();
        const typography = TypographySchema.parse(args.typography ?? {});
        const page = args.page !== undefined ? Number(args.page) : 0;

        if (page === 0) {
          // Apply to all slides
          const updated = slides.map((slide) => ({ ...slide, typography }));
          writeSlides(SlidesSchema.parse(updated));
          return {
            content: [{ type: "text", text: `Applied typography to all ${slides.length} slides.` }],
          };
        } else {
          if (!Number.isInteger(page) || page < 1 || page > slides.length) {
            throw new Error(`page must be 0 (all) or 1–${slides.length}`);
          }
          const idx = page - 1;
          const updated = slides.map((slide, i) =>
            i === idx ? { ...slide, typography } : slide
          );
          writeSlides(SlidesSchema.parse(updated));
          return {
            content: [{ type: "text", text: `Applied typography to slide ${page} (${slides[idx].type}).` }],
          };
        }
      }

      // ── list_slide_types ─────────────────────────────────────────────────
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
  Required: title (string)

Rules enforced by the schema:
  - First slide should be type "title"
  - Last slide should be type "end"
  - 6–9 slides total is recommended`;
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

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
