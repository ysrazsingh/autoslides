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
import { SlidesSchema, SlideSchema, type Slide } from "./schemas/slideSchema.js";

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
      description: "Read all slides from data/slides.json. Returns the full slide array.",
      inputSchema: { type: "object", properties: {} },
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
        return {
          content: [{ type: "text", text: JSON.stringify(slides, null, 2) }],
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

      // ── list_slide_types ─────────────────────────────────────────────────
      case "list_slide_types": {
        const description = `All slide types share: "theme": "light" | "dark" (defaults to "dark").

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
