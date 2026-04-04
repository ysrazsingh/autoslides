import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";

export const runtime = "nodejs";

// ── Types ─────────────────────────────────────────────────────────────────────

type Provider = "anthropic" | "openai";
type Mode = "chat" | "new" | "update";
type Role = "system" | "user" | "assistant";

type ChatMessage = { role: Role; content: string };

type TokenUsage = { inputTokens: number; outputTokens: number };

type SSEEvent =
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "done"; reply?: string; slides?: Slide[]; usage?: TokenUsage; suggestions?: string[] }
  | { type: "error"; message: string };

type RequestBody = {
  mode?: Mode;
  instruction?: string;
  slides?: unknown;
  history?: unknown;
  provider?: Provider;
  apiKey?: string;
  stream?: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_INSTRUCTION = 4000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_CHAT_TOKENS = 700;
const MAX_DECK_TOKENS = 4096;
const MAX_REPAIR_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 5;

const OPENAI_CHAT_MODEL = "gpt-4o-mini";
const OPENAI_DECK_MODEL = "gpt-4o";
const ANTHROPIC_CHAT_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_DECK_MODEL = "claude-sonnet-4-6";

const SUGGESTIONS_NEW = ["Make it more concise", "Add speaker notes context", "Make it more visual"];
const SUGGESTIONS_UPDATE = ["Apply change to all slides", "Undo last change", "Make it punchier"];

// ── Slide Examples for Tool Responses ────────────────────────────────────────

const SLIDE_EXAMPLES: Record<string, object> = {
  title: {
    type: "title",
    title: "Presentation Title",
    subtitle: "Optional subtitle line",
    theme: "dark",
  },
  content: {
    type: "content",
    title: "Section Title",
    points: ["First bullet point", "Second bullet point", "Third bullet point"],
    theme: "dark",
  },
  "two-column": {
    type: "two-column",
    title: "Comparison Title",
    left: { heading: "Left Heading", points: ["Point one", "Point two", "Point three"] },
    right: { heading: "Right Heading", points: ["Point A", "Point B", "Point C"] },
    theme: "dark",
  },
  "three-column": {
    type: "three-column",
    title: "Three Aspects",
    columns: [
      { heading: "Column 1", body: "Body text for column 1." },
      { heading: "Column 2", body: "Body text for column 2." },
      { heading: "Column 3", body: "Body text for column 3." },
    ],
    theme: "dark",
  },
  cards: {
    type: "cards",
    title: "Key Features",
    cards: [
      { icon: "⚡", title: "Feature One", description: "Short description of feature one" },
      { icon: "🎯", title: "Feature Two", description: "Short description of feature two" },
      { title: "Feature Three", description: "Icon is optional — just omit it" },
    ],
    theme: "dark",
  },
  stats: {
    type: "stats",
    title: "By the Numbers",
    stats: [
      { value: "98%", label: "Customer Satisfaction" },
      { value: "2.4M", label: "Active Users" },
      { value: "150+", label: "Countries" },
    ],
    theme: "dark",
  },
  quote: {
    type: "quote",
    quote: "The full text of the quote goes here as a single string.",
    author: "Author Name, Their Title",
    theme: "dark",
  },
  image: {
    type: "image",
    title: "Image Slide Title",
    imageUrl: "https://example.com/image.png",
    caption: "Optional caption text below the image",
    theme: "dark",
  },
  end: { type: "end", title: "Thank You", theme: "dark" },
};

// ── Tool Definitions ──────────────────────────────────────────────────────────

const ANTHROPIC_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "list_slide_types",
    description:
      "List all available slide types with brief descriptions. Call this first to understand your options.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_slide_schema",
    description:
      "Get a complete JSON example and field notes for a specific slide type. Call this for each type you plan to use to ensure correct field structure and avoid schema errors.",
    input_schema: {
      type: "object" as const,
      required: ["type"],
      properties: {
        type: {
          type: "string",
          description:
            "The slide type. One of: title, content, two-column, three-column, cards, stats, quote, image, end",
        },
      },
    },
  },
  {
    name: "get_current_slides",
    description:
      "Get the current slide deck as JSON. Use in update mode to see what slides exist before deciding what to change.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_slide_types",
      description: "List all available slide types with brief descriptions. Call this first.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_slide_schema",
      description:
        "Get a complete JSON example for a specific slide type. Call for each type you plan to use.",
      parameters: {
        type: "object",
        required: ["type"],
        properties: {
          type: {
            type: "string",
            description: "Slide type name, e.g. 'two-column', 'cards', 'stats'",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_slides",
      description: "Get the current slides array as JSON. Use in update mode.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ── Tool Executor ─────────────────────────────────────────────────────────────

function executeTool(
  name: string,
  input: Record<string, unknown>,
  currentSlides: Slide[]
): string {
  switch (name) {
    case "list_slide_types": {
      const types = [
        { type: "title", description: "Cover/intro slide with title and optional subtitle" },
        { type: "content", description: "Bullet-point slide with title and 1–6 text points" },
        { type: "two-column", description: "Two-column layout: each column has heading (optional) + points array (required)" },
        { type: "three-column", description: "Three-column layout: exactly 3 columns, each with heading + body string" },
        { type: "cards", description: "Feature cards: 2–6 cards, each with title + description, optional icon emoji" },
        { type: "stats", description: "Big-number metrics: 2–4 stats, each with value string + label string" },
        { type: "quote", description: "Full-screen quote with optional author attribution" },
        { type: "image", description: "Image slide with title, imageUrl, and optional caption" },
        { type: "end", description: "Closing/thank-you slide with just a title" },
      ];
      return JSON.stringify({ slide_types: types });
    }

    case "get_slide_schema": {
      const type = typeof input.type === "string" ? input.type.toLowerCase().trim() : "";
      const example = SLIDE_EXAMPLES[type];
      if (!example) {
        return JSON.stringify({
          error: `Unknown slide type: "${type}". Valid types: ${Object.keys(SLIDE_EXAMPLES).join(", ")}`,
        });
      }
      const notes: Record<string, string> = {
        "two-column":
          "IMPORTANT: left and right must be objects. Each has optional heading (string) and required points (string[]). Do NOT use flat arrays.",
        "three-column":
          "IMPORTANT: columns must be EXACTLY 3 items. Each item has heading (string) and body (string, not array).",
        cards: "cards array: min 2, max 6 items. icon is optional emoji string.",
        stats: "stats array: min 2, max 4 items. Both value and label must be strings.",
      };
      return JSON.stringify({ type, example, notes: notes[type] ?? null });
    }

    case "get_current_slides": {
      if (currentSlides.length === 0) {
        return JSON.stringify({ slides: [], total: 0, note: "No slides loaded yet" });
      }
      return JSON.stringify({
        total: currentSlides.length,
        slides: currentSlides.map((s, i) => ({ index: i, ...s })),
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

function toolStatusMessage(toolName: string): string {
  switch (toolName) {
    case "list_slide_types":
      return "Checking available slide types…";
    case "get_slide_schema":
      return "Loading slide schema…";
    case "get_current_slides":
      return "Reading current slides…";
    default:
      return "Consulting slide data…";
  }
}

// ── JSON Parsing Utilities ────────────────────────────────────────────────────

function normalizeWhitespace(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}

function cleanModelJson(text: string): string {
  return text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function extractJsonPayload(text: string): string | null {
  const cleaned = cleanModelJson(text);

  const firstArray = cleaned.indexOf("[");
  const lastArray = cleaned.lastIndexOf("]");
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");

  // Prefer array if it starts before object
  if (firstArray !== -1 && lastArray > firstArray && (firstObject === -1 || firstArray < firstObject)) {
    return cleaned.slice(firstArray, lastArray + 1).trim();
  }

  if (firstObject !== -1 && lastObject > firstObject) {
    return cleaned.slice(firstObject, lastObject + 1).trim();
  }

  return null;
}

// ── Slide Normalization ───────────────────────────────────────────────────────

const SLIDE_TYPE_SET = new Set([
  "title", "content", "two-column", "three-column", "cards", "stats", "quote", "image", "end",
]);

const TYPE_ALIASES: Record<string, string> = {
  intro: "title", cover: "title", hero: "title",
  text: "content", bullet: "content", bullets: "content", list: "content",
  twocolumn: "two-column", two_column: "two-column", "two column": "two-column",
  threecolumn: "three-column", three_column: "three-column", "three column": "three-column",
  card: "cards",
  stat: "stats",
  photo: "image",
  closing: "end",
};

function inferSlideType(slide: Record<string, unknown>, index: number, total: number): string {
  const rawType =
    typeof slide.type === "string"
      ? slide.type.trim().toLowerCase().replace(/[\s_]+/g, "-")
      : "";

  if (rawType) {
    if (SLIDE_TYPE_SET.has(rawType)) return rawType;
    const alias = TYPE_ALIASES[rawType];
    if (alias) return alias;
  }

  if (slide.imageUrl) return "image";
  if (Array.isArray(slide.cards)) return "cards";
  if (Array.isArray(slide.stats)) return "stats";
  if (Array.isArray(slide.columns)) return "three-column";
  if (slide.left || slide.right) return "two-column";
  if (typeof slide.quote === "string") return "quote";
  if (Array.isArray(slide.points)) return "content";
  if (index === 0) return "title";
  if (index === total - 1) return "end";
  return "content";
}

function normalizeTheme(theme: unknown): "light" | "dark" {
  return theme === "light" ? "light" : "dark";
}

function normalizeSlidesArray(input: unknown[]): unknown[] {
  const total = input.length;
  return input.map((item, index) => {
    if (!item || typeof item !== "object") return item;
    const slide = item as Record<string, unknown>;
    return { ...slide, type: inferSlideType(slide, index, total), theme: normalizeTheme(slide.theme) };
  });
}

function coerceSlides(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return normalizeSlidesArray(parsed);
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.slides)) return normalizeSlidesArray(obj.slides);
  }
  return null;
}

function parseDeckJson(raw: string): Slide[] {
  const payload = extractJsonPayload(raw);
  if (!payload) throw new Error("No JSON found in model output");
  const parsed = JSON.parse(payload) as unknown;
  const slidesLike = coerceSlides(parsed);
  if (!slidesLike) throw new Error("JSON must be an array or object with slides[]");
  return SlidesSchema.parse(slidesLike);
}

// ── Prompt Builders ───────────────────────────────────────────────────────────

function buildDeckSystemPrompt(mode: Exclude<Mode, "chat">): string {
  return [
    "You are a professional presentation slide generator.",
    "You have tools to look up slide types and their exact JSON schemas — use them before generating.",
    mode === "new"
      ? "Create a fresh deck: 6–9 slides. First slide type must be 'title'. Last slide type must be 'end'."
      : "Edit the existing deck. Call get_current_slides first to see what exists. Preserve slides not asked to change.",
    "After consulting schemas with your tools, output a JSON object with a top-level 'slides' array.",
    "Output JSON only — no markdown, no explanation, no code blocks.",
    "Every slide MUST include a 'theme' field: 'dark' or 'light'. Default to 'dark'.",
    "Use varied, engaging slide types — avoid repeating the same type consecutively.",
  ].join("\n");
}

function buildChatSystemPrompt(history: string, slideSummary: string): string {
  return [
    "You are a helpful presentation copilot.",
    "Discuss presentation structure, flow, wording, speaker notes, and slide ideas.",
    "Do not emit slide JSON — just talk.",
    "Be direct and concise.",
    history ? `Conversation context:\n${history}` : "",
    slideSummary ? `Current deck summary:\n${slideSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRepairPrompt(raw: string, existingSlidesJson: string): string {
  return [
    "The following slide JSON is invalid or broken. Fix it and return only valid JSON.",
    "Return a JSON object with a top-level 'slides' array. No markdown. No explanation.",
    `Full schema examples for reference:\n${JSON.stringify(SLIDE_EXAMPLES, null, 2)}`,
    "Rules: every slide needs type + theme. First slide type='title'. Last slide type='end'. 6–9 slides preferred.",
    existingSlidesJson ? `Original slides for reference:\n${existingSlidesJson}` : "",
    `Broken output to fix:\n${raw.slice(0, 8000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── History / Summary Helpers ─────────────────────────────────────────────────

function compactHistory(history: unknown): string {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const msg = item as Partial<ChatMessage>;
      const role = msg.role === "assistant" ? "Assistant" : "User";
      const content = typeof msg.content === "string" ? msg.content : "";
      return `${role}: ${normalizeWhitespace(content).slice(0, 320)}`;
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeSlides(slides: Slide[]): string {
  if (!Array.isArray(slides) || slides.length === 0) return "";
  return slides
    .map((slide, index) => {
      const s = slide as Record<string, unknown>;
      const title =
        typeof s.title === "string" ? s.title :
        typeof s.quote === "string" ? s.quote.slice(0, 40) + "…" :
        "Untitled";
      return `${index + 1}. ${slide.type}: ${title}`;
    })
    .join("\n");
}

// ── SSE Helpers ───────────────────────────────────────────────────────────────

function sseEncode(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  obj: SSEEvent
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
}

// ── Fallback Slides ───────────────────────────────────────────────────────────

function fallbackTitleFromInstruction(instruction: string): string {
  const cleaned = instruction
    .replace(/^(create|make|generate|build|write|update|edit|improve)\s+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return cleaned ? cleaned.slice(0, 80) : "Presentation";
}

function buildFallbackSlides(mode: Exclude<Mode, "chat">, instruction: string, existingSlides: Slide[]): Slide[] {
  if (mode === "update" && existingSlides.length > 0) return existingSlides;
  const title = fallbackTitleFromInstruction(instruction);
  return SlidesSchema.parse([
    { type: "title", title, subtitle: "Generated presentation", theme: "dark" },
    {
      type: "content",
      title: "Key Points",
      points: [
        "AI generation encountered an issue — please try again",
        "Check your API key in Settings",
        "Try a more specific prompt for better results",
      ],
      theme: "dark",
    },
    { type: "end", title: "Try Again", theme: "dark" },
  ]);
}

// ── Anthropic Tool Calling Loop ───────────────────────────────────────────────

async function runAnthropicDeck(args: {
  apiKey: string;
  mode: Exclude<Mode, "chat">;
  userMessage: string;
  currentSlides: Slide[];
  usage: TokenUsage;
  onStatus: (msg: string) => void;
  onDelta: (text: string) => void;
}): Promise<string> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const systemPrompt = buildDeckSystemPrompt(args.mode);

  type AnthropicMsg = Anthropic.Messages.MessageParam;
  const messages: AnthropicMsg[] = [{ role: "user", content: args.userMessage }];

  let lastTextContent = "";

  // Phase 1: Tool calling loop (non-streaming, fast)
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: ANTHROPIC_DECK_MODEL,
      max_tokens: 1024,
      temperature: 0.1,
      system: systemPrompt,
      tools: ANTHROPIC_TOOLS,
      messages,
    });

    args.usage.inputTokens += response.usage.input_tokens;
    args.usage.outputTokens += response.usage.output_tokens;

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );

    // Add assistant response to conversation history
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      // Model finished with tools — it may have returned the JSON already
      const textBlock = response.content.find(
        (b): b is Anthropic.Messages.TextBlock => b.type === "text"
      );
      if (textBlock) lastTextContent = textBlock.text;
      break;
    }

    // Execute all tool calls in this round (model may call multiple at once)
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = toolUseBlocks.map((block) => {
      args.onStatus(toolStatusMessage(block.name));
      const result = executeTool(
        block.name,
        block.input as Record<string, unknown>,
        args.currentSlides
      );
      return { type: "tool_result" as const, tool_use_id: block.id, content: result };
    });

    messages.push({ role: "user", content: toolResults });
  }

  // If the model already returned JSON during the tool loop, stream it as deltas
  if (lastTextContent) {
    args.onDelta(lastTextContent);
    return lastTextContent;
  }

  // Phase 2: Final streaming generation (model exhausted tool rounds without producing JSON)
  messages.push({
    role: "user",
    content:
      "Now output the complete presentation as a JSON object with a 'slides' array. JSON only — no tool calls, no markdown, no explanation.",
  });

  let accumulated = "";
  const stream = client.messages.stream({
    model: ANTHROPIC_DECK_MODEL,
    max_tokens: MAX_DECK_TOKENS,
    temperature: 0.15,
    system: systemPrompt,
    messages,
    // No tools — force pure text generation
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const text = event.delta.text;
      accumulated += text;
      args.onDelta(text);
    }
    if (event.type === "message_start") {
      args.usage.inputTokens += event.message.usage.input_tokens;
    }
    if (event.type === "message_delta") {
      args.usage.outputTokens += event.usage.output_tokens;
    }
  }

  return accumulated;
}

// ── OpenAI Tool Calling Loop ──────────────────────────────────────────────────

async function runOpenAIDeck(args: {
  apiKey: string;
  mode: Exclude<Mode, "chat">;
  userMessage: string;
  currentSlides: Slide[];
  usage: TokenUsage;
  onStatus: (msg: string) => void;
  onDelta: (text: string) => void;
}): Promise<string> {
  const client = new OpenAI({ apiKey: args.apiKey });
  const systemPrompt = buildDeckSystemPrompt(args.mode);

  type OAIMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
  const messages: OAIMsg[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: args.userMessage },
  ];

  let lastTextContent = "";

  // Phase 1: Tool calling loop (non-streaming, fast)
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create({
      model: OPENAI_DECK_MODEL,
      messages,
      tools: OPENAI_TOOLS,
      tool_choice: "auto",
      max_tokens: 1024,
      temperature: 0.1,
    });

    if (response.usage) {
      args.usage.inputTokens += response.usage.prompt_tokens;
      args.usage.outputTokens += response.usage.completion_tokens;
    }

    const choice = response.choices[0];
    if (!choice) break;

    // Add assistant message to history
    messages.push({ role: "assistant", content: choice.message.content ?? null, tool_calls: choice.message.tool_calls } as OAIMsg);

    if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
      // No more tool calls — model may have returned JSON already
      if (choice.message.content) lastTextContent = choice.message.content;
      break;
    }

    // Execute all tool calls
    for (const tc of choice.message.tool_calls) {
      if (tc.type !== "function") continue;
      const fnCall = tc.function as { name: string; arguments: string };
      args.onStatus(toolStatusMessage(fnCall.name));
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(fnCall.arguments) as Record<string, unknown>;
      } catch {}
      const result = executeTool(fnCall.name, parsedInput, args.currentSlides);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  // If the model already returned JSON during the tool loop, stream it as deltas
  if (lastTextContent) {
    args.onDelta(lastTextContent);
    return lastTextContent;
  }

  // Phase 2: Final streaming generation
  messages.push({
    role: "user",
    content:
      "Now output the complete presentation as a JSON object with a 'slides' array. JSON only — no tool calls, no markdown, no explanation.",
  });

  let accumulated = "";
  const stream = await client.chat.completions.create({
    model: OPENAI_DECK_MODEL,
    messages,
    max_tokens: MAX_DECK_TOKENS,
    temperature: 0.15,
    stream: true,
    stream_options: { include_usage: true },
    response_format: undefined, // plain text during streaming — JSON mode not supported with streaming
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      accumulated += delta;
      args.onDelta(delta);
    }
    if (chunk.usage) {
      args.usage.inputTokens += chunk.usage.prompt_tokens;
      args.usage.outputTokens += chunk.usage.completion_tokens;
    }
  }

  return accumulated;
}

// ── Repair Utility ────────────────────────────────────────────────────────────

async function repairDeckWithModel(args: {
  provider: Provider;
  apiKey: string;
  raw: string;
  existingSlidesJson: string;
}): Promise<Slide[]> {
  const prompt = buildRepairPrompt(args.raw, args.existingSlidesJson);
  try {
    if (args.provider === "openai") {
      const client = new OpenAI({ apiKey: args.apiKey });
      const res = await client.chat.completions.create({
        model: OPENAI_DECK_MODEL,
        messages: [
          { role: "system", content: "You repair invalid slide JSON. Return a JSON object with slides array only." },
          { role: "user", content: prompt },
        ],
        max_tokens: MAX_REPAIR_TOKENS,
        temperature: 0,
        response_format: { type: "json_object" },
      });
      return parseDeckJson(res.choices[0]?.message?.content ?? "");
    }
    const client = new Anthropic({ apiKey: args.apiKey });
    const res = await client.messages.create({
      model: ANTHROPIC_DECK_MODEL,
      max_tokens: MAX_REPAIR_TOKENS,
      temperature: 0,
      system: "You repair invalid slide JSON. Return a JSON object with slides array only.",
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = res.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text");
    return parseDeckJson(textBlock?.text ?? "");
  } catch {
    return [];
  }
}

async function resolveDeckSlides(args: {
  provider: Provider;
  apiKey: string;
  mode: Exclude<Mode, "chat">;
  instruction: string;
  existingSlides: Slide[];
  existingSlidesJson: string;
  raw: string;
}): Promise<Slide[]> {
  try {
    return parseDeckJson(args.raw);
  } catch {}

  const repaired = await repairDeckWithModel({
    provider: args.provider,
    apiKey: args.apiKey,
    raw: args.raw,
    existingSlidesJson: args.existingSlidesJson,
  });

  if (repaired.length > 0) return repaired;
  return buildFallbackSlides(args.mode, args.instruction, args.existingSlides);
}

// ── Chat Handler ──────────────────────────────────────────────────────────────

async function handleChat(args: {
  provider: Provider;
  apiKey: string;
  instruction: string;
  history: string;
  slideSummary: string;
  stream: boolean;
}) {
  const system = buildChatSystemPrompt(args.history, args.slideSummary);

  if (!args.stream) {
    try {
      let text = "";
      if (args.provider === "openai") {
        const client = new OpenAI({ apiKey: args.apiKey });
        const res = await client.chat.completions.create({
          model: OPENAI_CHAT_MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: args.instruction }],
          max_tokens: MAX_CHAT_TOKENS,
          temperature: 0.4,
        });
        text = res.choices[0]?.message?.content ?? "";
      } else {
        const client = new Anthropic({ apiKey: args.apiKey });
        const res = await client.messages.create({
          model: ANTHROPIC_CHAT_MODEL,
          max_tokens: MAX_CHAT_TOKENS,
          temperature: 0.4,
          system,
          messages: [{ role: "user", content: args.instruction }],
        });
        const block = res.content[0];
        text = block?.type === "text" ? block.text : "";
      }
      return NextResponse.json({ reply: text.trim() });
    } catch (err) {
      console.error("Chat API error:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "AI service unavailable" }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (args.provider === "openai") {
          const client = new OpenAI({ apiKey: args.apiKey });
          const stream = await client.chat.completions.create({
            model: OPENAI_CHAT_MODEL,
            messages: [{ role: "system", content: system }, { role: "user", content: args.instruction }],
            max_tokens: MAX_CHAT_TOKENS,
            temperature: 0.4,
            stream: true,
          });
          let accumulated = "";
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              sseEncode(controller, encoder, { type: "delta", text: delta });
            }
          }
          sseEncode(controller, encoder, { type: "done", reply: accumulated.trim() });
        } else {
          const client = new Anthropic({ apiKey: args.apiKey });
          const stream = client.messages.stream({
            model: ANTHROPIC_CHAT_MODEL,
            max_tokens: MAX_CHAT_TOKENS,
            temperature: 0.4,
            system,
            messages: [{ role: "user", content: args.instruction }],
          });
          let accumulated = "";
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              accumulated += event.delta.text;
              sseEncode(controller, encoder, { type: "delta", text: event.delta.text });
            }
          }
          sseEncode(controller, encoder, { type: "done", reply: accumulated.trim() });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sseEncode(controller, encoder, { type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// ── Deck Handler ──────────────────────────────────────────────────────────────

async function handleDeck(args: {
  provider: Provider;
  apiKey: string;
  mode: Exclude<Mode, "chat">;
  instruction: string;
  history: string;
  slideSummary: string;
  existingSlides: Slide[];
  existingSlidesJson: string;
  stream: boolean;
}) {
  // Build the user message that includes context
  const userMessage = [
    args.history ? `Conversation context:\n${args.history}` : "",
    args.slideSummary ? `Current deck summary:\n${args.slideSummary}` : "",
    `User instruction: ${args.instruction}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!args.stream) {
    // Non-streaming path (rarely used, included for completeness)
    try {
      const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      let raw = "";
      if (args.provider === "openai") {
        raw = await runOpenAIDeck({
          apiKey: args.apiKey,
          mode: args.mode,
          userMessage,
          currentSlides: args.existingSlides,
          usage,
          onStatus: () => {},
          onDelta: (t) => { raw += t; },
        });
      } else {
        raw = await runAnthropicDeck({
          apiKey: args.apiKey,
          mode: args.mode,
          userMessage,
          currentSlides: args.existingSlides,
          usage,
          onStatus: () => {},
          onDelta: (t) => { raw += t; },
        });
      }
      const slides = await resolveDeckSlides({
        provider: args.provider,
        apiKey: args.apiKey,
        mode: args.mode,
        instruction: args.instruction,
        existingSlides: args.existingSlides,
        existingSlidesJson: args.existingSlidesJson,
        raw,
      });
      return NextResponse.json({ slides, usage });
    } catch (err) {
      console.error("Deck API error:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "AI service unavailable" }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      try {
        let accumulated = "";

        const onStatus = (msg: string) =>
          sseEncode(controller, encoder, { type: "status", message: msg });

        const onDelta = (text: string) => {
          accumulated += text;
          sseEncode(controller, encoder, { type: "delta", text });
        };

        if (args.provider === "openai") {
          await runOpenAIDeck({
            apiKey: args.apiKey,
            mode: args.mode,
            userMessage,
            currentSlides: args.existingSlides,
            usage,
            onStatus,
            onDelta,
          });
        } else {
          await runAnthropicDeck({
            apiKey: args.apiKey,
            mode: args.mode,
            userMessage,
            currentSlides: args.existingSlides,
            usage,
            onStatus,
            onDelta,
          });
        }

        const slides = await resolveDeckSlides({
          provider: args.provider,
          apiKey: args.apiKey,
          mode: args.mode,
          instruction: args.instruction,
          existingSlides: args.existingSlides,
          existingSlidesJson: args.existingSlidesJson,
          raw: accumulated,
        });

        const suggestions = args.mode === "new" ? SUGGESTIONS_NEW : SUGGESTIONS_UPDATE;

        sseEncode(controller, encoder, { type: "done", slides, usage, suggestions });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sseEncode(controller, encoder, { type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// ── POST Handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    const raw = await req.json();
    body = (raw && typeof raw === "object" ? raw : {}) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const provider: Provider = body.provider === "openai" ? "openai" : "anthropic";
  const apiKey =
    body.apiKey?.trim() ||
    (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY) ||
    "";

  const instruction =
    typeof body.instruction === "string" ? normalizeWhitespace(body.instruction) : "";
  const stream = body.stream === true;
  const history = compactHistory(body.history);

  const slidesResult = Array.isArray(body.slides) ? SlidesSchema.safeParse(body.slides) : null;
  const existingSlides = slidesResult?.success ? slidesResult.data : [];
  const slideSummary = summarizeSlides(existingSlides);
  const existingSlidesJson = existingSlides.length ? JSON.stringify(existingSlides) : "";
  const mode: Mode = body.mode ?? (existingSlides.length > 0 ? "update" : "chat");

  if (!instruction) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  if (instruction.length > MAX_INSTRUCTION) {
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

  if (mode === "update" && !slidesResult?.success) {
    return NextResponse.json({ error: "Invalid slides payload for update mode" }, { status: 400 });
  }

  if (mode === "chat") {
    return handleChat({ provider, apiKey, instruction, history, slideSummary, stream });
  }

  return handleDeck({
    provider,
    apiKey,
    mode,
    instruction,
    history,
    slideSummary,
    existingSlides,
    existingSlidesJson,
    stream,
  });
}
