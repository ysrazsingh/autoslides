import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";

const MAX_INSTRUCTION = 4000;

const SCHEMA_RULES = `Available slide types (same as new decks):
- { "type": "title", "title": string, "subtitle"?: string, "theme": "light"|"dark", "typography"?: Typography }
- { "type": "content", "title": string, "points": string[] (1–6), "theme": "light"|"dark", "typography"?: Typography }
- { "type": "two-column", "title": string, "left": { "heading"?: string, "points": string[] }, "right": { "heading"?: string, "points": string[] }, "theme": "light"|"dark", "typography"?: Typography }
- { "type": "three-column", "title": string, "columns": [{ "heading": string, "body": string }] (exactly 3), "theme": "light"|"dark", "typography"?: Typography }
- { "type": "cards", "title": string, "cards": [{ "icon"?: string, "title": string, "description": string }] (2–6), "theme": "light"|"dark", "typography"?: Typography }
- { "type": "stats", "title": string, "stats": [{ "value": string, "label": string }] (2–4), "theme": "light"|"dark", "typography"?: Typography }
- { "type": "quote", "quote": string, "author"?: string, "theme": "light"|"dark", "typography"?: Typography }
- { "type": "image", "title": string, "imageUrl": string, "caption"?: string, "theme": "light"|"dark", "typography"?: Typography }
- { "type": "end", "title": string, "theme": "light"|"dark", "typography"?: Typography }

Typography object (all fields optional): fontFamily, headingColor, headingSize, headingWeight, headingAlign, bodyColor, bodySize, bodyAlign, mutedColor, accentColor, lineHeight.

Rich text markers in strings: **bold** _italic_ __underline__ \`code\`

Rules:
- First slide must be type "title"
- Last slide must be type "end"
- 6–9 slides total unless the user explicitly asks for fewer or more slides
- Preserve the deck's intent when editing; only change what the instruction asks`;

function buildSystemPrompt(existingSlides: Slide[]): string {
  return `You are editing an existing presentation. Current slides JSON:
${JSON.stringify(existingSlides)}

${SCHEMA_RULES}

Output ONLY valid JSON — a single array of slide objects. No markdown fences, no explanation.`;
}

function cleanModelJson(text: string): string {
  return text.replace(/```json|```/g, "").trim();
}

function parseSlides(text: string): Slide[] {
  const cleaned = cleanModelJson(text);
  return SlidesSchema.parse(JSON.parse(cleaned));
}

type Provider = "anthropic" | "openai";

async function updateAnthropic(
  apiKey: string,
  instruction: string,
  existingSlides: Slide[]
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: buildSystemPrompt(existingSlides),
    messages: [{ role: "user", content: instruction }],
  });
  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

async function updateOpenAI(
  apiKey: string,
  instruction: string,
  existingSlides: Slide[]
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: buildSystemPrompt(existingSlides) },
      { role: "user", content: instruction },
    ],
  });
  return response.choices[0].message.content ?? "";
}

async function* streamAnthropic(
  apiKey: string,
  instruction: string,
  existingSlides: Slide[]
): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: buildSystemPrompt(existingSlides),
    messages: [{ role: "user", content: instruction }],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

async function* streamOpenAI(
  apiKey: string,
  instruction: string,
  existingSlides: Slide[]
): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey });
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    stream: true,
    messages: [
      { role: "system", content: buildSystemPrompt(existingSlides) },
      { role: "user", content: instruction },
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

export async function POST(req: Request) {
  let instruction: string;
  let provider: Provider;
  let apiKey: string;
  let stream: boolean;
  let existingSlides: Slide[];

  try {
    const body = await req.json();
    instruction = typeof body?.instruction === "string" ? body.instruction : "";
    provider = body?.provider === "openai" ? "openai" : "anthropic";
    stream = body?.stream === true;
    apiKey =
      body?.apiKey?.trim() ||
      (provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY) ||
      "";
    try {
      existingSlides = SlidesSchema.parse(body?.slides);
    } catch {
      return NextResponse.json({ error: "Invalid slides payload" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const trimmed = instruction.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }
  if (trimmed.length > MAX_INSTRUCTION) {
    return NextResponse.json(
      { error: `instruction must be ${MAX_INSTRUCTION} characters or fewer` },
      { status: 400 }
    );
  }
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          provider === "anthropic"
            ? "No Anthropic API key. Set ANTHROPIC_API_KEY or provide one in Settings."
            : "No OpenAI API key. Set OPENAI_API_KEY or provide one in Settings.",
      },
      { status: 400 }
    );
  }

  if (!stream) {
    let text = "";
    try {
      text =
        provider === "anthropic"
          ? await updateAnthropic(apiKey, trimmed, existingSlides)
          : await updateOpenAI(apiKey, trimmed, existingSlides);
    } catch (err) {
      console.error(`${provider} API error:`, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "AI service unavailable" }, { status: 502 });
    }
    try {
      const slides = parseSlides(text);
      return NextResponse.json(slides);
    } catch (err) {
      console.error("AI output failed Zod validation:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "AI returned invalid slide data" }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        const gen =
          provider === "anthropic"
            ? streamAnthropic(apiKey, trimmed, existingSlides)
            : streamOpenAI(apiKey, trimmed, existingSlides);
        let accumulated = "";
        for await (const chunk of gen) {
          accumulated += chunk;
          send({ type: "delta", text: chunk });
        }
        const slides = parseSlides(accumulated);
        send({ type: "done", slides });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
