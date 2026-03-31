import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { SlidesSchema } from "@/schemas/slideSchema";

const MAX_TOPIC_LENGTH = 200;

const SYSTEM_PROMPT = `You are a presentation generator. Output ONLY valid JSON — no markdown, no explanation.

The JSON must be an array of slide objects. All slides have a "theme" field of "light" or "dark".

Available slide types:
- { "type": "title",        "title": string, "subtitle"?: string, "theme": "light"|"dark" }
- { "type": "content",      "title": string, "points": string[] (1–6 items), "theme": "light"|"dark" }
- { "type": "two-column",   "title": string, "left": { "heading"?: string, "points": string[] }, "right": { "heading"?: string, "points": string[] }, "theme": "light"|"dark" }
- { "type": "three-column", "title": string, "columns": [{ "heading": string, "body": string }, ...] (exactly 3), "theme": "light"|"dark" }
- { "type": "cards",        "title": string, "cards": [{ "icon"?: string, "title": string, "description": string }] (2–6 cards), "theme": "light"|"dark" }
- { "type": "stats",        "title": string, "stats": [{ "value": string, "label": string }] (2–4 items), "theme": "light"|"dark" }
- { "type": "quote",        "quote": string, "author"?: string, "theme": "light"|"dark" }
- { "type": "image",        "title": string, "imageUrl": string, "caption"?: string, "theme": "light"|"dark" }
- { "type": "end",          "title": string, "theme": "light"|"dark" }

Rules:
- First slide must be type "title"
- Last slide must be type "end"
- 6–9 slides total
- Use a variety of slide types — don't repeat the same type consecutively
- Use "dark" theme by default`;

type Provider = "anthropic" | "openai";

async function generateWithAnthropic(topic: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Create a presentation about: ${topic}` }],
  });
  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

async function generateWithOpenAI(topic: string, apiKey: string): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Create a presentation about: ${topic}` },
    ],
  });
  return response.choices[0].message.content ?? "";
}

export async function POST(req: Request) {
  let topic: string;
  let provider: Provider;
  let apiKey: string;

  try {
    const body = await req.json();
    topic = body?.topic;

    // Provider: body > env default
    provider = body?.provider === "openai" ? "openai" : "anthropic";

    // API key: body (from settings page) > env var
    apiKey =
      body?.apiKey?.trim() ||
      (provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY) ||
      "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    return NextResponse.json(
      { error: `topic must be ${MAX_TOPIC_LENGTH} characters or fewer` },
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

  let text = "";
  try {
    text =
      provider === "anthropic"
        ? await generateWithAnthropic(topic.trim(), apiKey)
        : await generateWithOpenAI(topic.trim(), apiKey);
  } catch (err) {
    console.error(`${provider} API error:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "AI service unavailable" }, { status: 502 });
  }

  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    const validSlides = SlidesSchema.parse(JSON.parse(cleaned));
    return NextResponse.json(validSlides);
  } catch (err) {
    console.error("AI output failed Zod validation:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "AI returned invalid slide data" }, { status: 500 });
  }
}
