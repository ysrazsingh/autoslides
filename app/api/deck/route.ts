import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";

export const runtime = "nodejs";

const MAX_INSTRUCTION = 4000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_CHAT_TOKENS = 700;
const MAX_DECK_TOKENS = 4096;
const MAX_REPAIR_TOKENS = 1200;
const MAX_TOOL_ROUNDS = 2;

type Provider = "anthropic" | "openai";
type Mode = "chat" | "new" | "update";
type Role = "system" | "user" | "assistant" | "tool";

type ChatMessage = {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
};

type RequestBody = {
  mode?: Mode;
  instruction?: string;
  slides?: Slide[];
  history?: ChatMessage[];
  provider?: Provider;
  apiKey?: string;
  stream?: boolean;
};

type SSEEvent =
  | { type: "delta"; text: string }
  | { type: "done"; reply?: string; slides?: Slide[] }
  | { type: "error"; message: string };

const MODELS = {
  openai: {
    chat: "gpt-4o-mini",
    deck: "gpt-4o",
    repair: "gpt-4o",
  },
  anthropic: {
    chat: "claude-sonnet-4-6",
    deck: "claude-sonnet-4-6",
    repair: "claude-sonnet-4-6",
  },
} as const;

const SLIDE_SCHEMA_CATALOG: Record<string, string> = {
  title: 'title(title, subtitle?, theme:"light"|"dark", typography?)',
  content: 'content(title, points[1-6], theme:"light"|"dark", typography?)',
  "two-column": 'two-column(title, left.heading?, left.points[], right.heading?, right.points[], theme:"light"|"dark", typography?)',
  "three-column": 'three-column(title, columns[3] where each item has heading + body, theme:"light"|"dark", typography?)',
  cards: 'cards(title, cards[2-6] where each card has icon?, title, description, theme:"light"|"dark", typography?)',
  stats: 'stats(title, stats[2-4] where each stat has value + label, theme:"light"|"dark", typography?)',
  quote: 'quote(quote, author?, theme:"light"|"dark", typography?)',
  image: 'image(title, imageUrl, caption?, theme:"light"|"dark", typography?)',
  end: 'end(title, theme:"light"|"dark", typography?)',
};

const SLIDE_TYPE_KEYS = Object.keys(SLIDE_SCHEMA_CATALOG) as Array<keyof typeof SLIDE_SCHEMA_CATALOG>;

const SLIDE_SCHEMA_TOOL = {
  type: "function" as const,
  function: {
    name: "get_slide_schema",
    description:
      "Return a compact schema summary for all slide types or for one requested slide type. Use this to avoid guessing field names or shapes.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["all", "type"],
          description: "Return the full compact catalog or a single slide type.",
        },
        slideType: {
          type: "string",
          enum: SLIDE_TYPE_KEYS,
          description: "Required when mode is 'type'.",
        },
      },
      required: ["mode", "slideType"],
      additionalProperties: false,
    },
    strict: true,
  },
} as const;

function normalizeWhitespace(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}

function cleanModelJson(text: string): string {
  return text.replace(/```json|```/g, "").trim();
}

function extractJsonPayload(text: string): string | null {
  const cleaned = cleanModelJson(text);
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");
  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    return cleaned.slice(firstObject, lastObject + 1).trim();
  }
  const firstArray = cleaned.indexOf("[");
  const lastArray = cleaned.lastIndexOf("]");
  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    return cleaned.slice(firstArray, lastArray + 1).trim();
  }
  return null;
}

function safeSlice(text: string, limit: number): string {
  const cleaned = normalizeWhitespace(text);
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit)}\n[truncated]`;
}

function compactHistory(history: ChatMessage[] | undefined): string {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => {
      const role = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
      return `${role}: ${safeSlice(String(m.content ?? ""), 320)}`;
    })
    .join("\n");
}

function summarizeSlides(slides: Slide[]): string {
  if (!Array.isArray(slides) || slides.length === 0) return "";
  return slides
    .map((slide, index) => {
      const title = typeof slide?.title === "string" ? slide.title : "Untitled";
      const type = typeof slide?.type === "string" ? slide.type : "unknown";
      return `${index + 1}. ${type}: ${title}`;
    })
    .join("\n");
}

function compactSlidesJson(slides: Slide[]): string {
  return JSON.stringify(slides);
}

function getProvider(body: RequestBody): Provider {
  return body.provider === "openai" ? "openai" : "anthropic";
}

function getApiKey(body: RequestBody, provider: Provider): string {
  return (
    body.apiKey?.trim() ||
    (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY) ||
    ""
  );
}

function validateBody(body: unknown): RequestBody {
  if (!body || typeof body !== "object") return {};
  return body as RequestBody;
}

function schemaToolOutput(mode: "all" | "type", slideType?: string): string {
  if (mode === "type") {
    if (slideType && slideType in SLIDE_SCHEMA_CATALOG) {
      return JSON.stringify({ mode: "type", slideType, schema: SLIDE_SCHEMA_CATALOG[slideType] });
    }
    return JSON.stringify({ error: "Unknown slide type" });
  }

  return JSON.stringify({
    mode: "all",
    types: SLIDE_TYPE_KEYS.map((type) => ({ type, schema: SLIDE_SCHEMA_CATALOG[type] })),
  });
}

function buildChatSystemPrompt(history: string, slideSummary: string): string {
  return [
    "You are a PPT copilot.",
    "Discuss only presentation structure, flow, wording, speaker notes, and slide ideas.",
    "Do not emit slide JSON.",
    "Be direct and useful.",
    history ? `Conversation context:\n${history}` : "",
    slideSummary ? `Current deck summary:\n${slideSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildDeckSystemPrompt(mode: Mode, history: string, slideSummary: string, existingSlidesJson: string): string {
  const base = [
    "You are generating or editing presentation slides.",
    "Use the get_slide_schema tool only when you need exact field names or want to confirm a slide type.",
    "Keep the output compact.",
    "If the task is chat-only, answer in plain text and never output slide JSON.",
    "For slide generation/editing, output JSON only.",
    mode === "new"
      ? "Create a fresh deck. Start with title and end with end."
      : "Edit the existing deck. Preserve what is not explicitly asked to change.",
    'Schema rules: every slide MUST have "theme": "dark" or "theme": "light" (default "dark"). Available types: title, content, two-column, three-column, cards, stats, quote, image, end.',
    history ? `Conversation context:\n${history}` : "",
    slideSummary ? `Current deck summary:\n${slideSummary}` : "",
    existingSlidesJson ? `Current slides JSON:\n${existingSlidesJson}` : "",
    'Rules: first slide is title, last slide is end, 6-9 slides unless the user asks otherwise, no markdown fences, "theme" must be exactly "dark" or "light".',
  ];
  return base.filter(Boolean).join("\n\n");
}

function buildRepairPrompt(mode: Exclude<Mode, "chat">, raw: string, existingSlidesJson: string): string {
  return [
    `Fix this broken slide JSON for ${mode} mode.`,
    "Return JSON only. No markdown. No explanation.",
    "Wrap the slides in an object: {\"slides\": [...] }.",
    "Rules: first slide is title, last slide is end, 6-9 slides unless the user asked otherwise.",
    existingSlidesJson ? `Current slides JSON:\n${existingSlidesJson}` : "",
    `Broken model output:\n${safeSlice(raw, 12000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseDeckJson(raw: string): Slide[] {
  const payload = extractJsonPayload(raw) ?? cleanModelJson(raw);
  const parsed = JSON.parse(payload) as unknown;

  if (Array.isArray(parsed)) {
    return SlidesSchema.parse(parsed);
  }

  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { slides?: unknown }).slides)) {
    return SlidesSchema.parse((parsed as { slides: Slide[] }).slides);
  }

  throw new Error("Deck JSON must be an array or an object with slides[]");
}

function parseDeckJsonMaybe(raw: string): Slide[] {
  try {
    return parseDeckJson(raw);
  } catch {
    return [];
  }
}

function sseEncode(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  obj: SSEEvent
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
}

async function callAnthropicText(args: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  model: string;
}): Promise<string> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const response = await client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });
  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

async function* streamAnthropicText(args: {
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  model: string;
}): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const stream = client.messages.stream({
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

async function callOpenAIText(args: {
  apiKey: string;
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  tools?: any[];
  responseFormat?: any;
  messages?: ChatMessage[];
}): Promise<{ text: string; toolMessages?: ChatMessage[]; assistantMessage?: ChatMessage }> {
  const client = new OpenAI({ apiKey: args.apiKey });
  const messages = args.messages ?? [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ];

  const response = await client.chat.completions.create({
    model: args.model,
    messages: messages as any,
    max_tokens: args.maxTokens,
    tools: args.tools,
    tool_choice: args.tools ? "auto" : undefined,
    response_format: args.responseFormat,
  });

  const assistantMessage = response.choices[0]?.message as ChatMessage | undefined;
  const toolCalls = response.choices[0]?.message?.tool_calls ?? [];
  const toolMessages: ChatMessage[] = [];

  for (const call of toolCalls) {
    if (call.type !== "function") continue;
    if (call.function?.name !== "get_slide_schema") continue;

    let parsed: { mode?: "all" | "type"; slideType?: string } = {};
    try {
      parsed = JSON.parse(call.function.arguments || "{}");
    } catch {
      parsed = {};
    }

    const output = schemaToolOutput(parsed.mode ?? "all", parsed.slideType);
    toolMessages.push({
      role: "tool",
      tool_call_id: call.id,
      content: output,
    });
  }

  return {
    text: response.choices[0]?.message?.content ?? "",
    toolMessages,
    assistantMessage,
  };
}

async function* streamOpenAIText(args: {
  apiKey: string;
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  responseFormat?: any;
  messages?: ChatMessage[];
}): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey: args.apiKey });
  const stream = await client.chat.completions.create({
    model: args.model,
    messages: (args.messages ?? [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ]) as any,
    max_tokens: args.maxTokens,
    response_format: args.responseFormat,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

async function resolveOpenAIToolRound(args: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}): Promise<ChatMessage[]> {
  const client = new OpenAI({ apiKey: args.apiKey });
  const response = await client.chat.completions.create({
    model: args.model,
    messages: args.messages as any,
    tools: [SLIDE_SCHEMA_TOOL],
    tool_choice: "auto",
    max_tokens: 400,
  });

  const assistantMessage = response.choices[0]?.message as ChatMessage | undefined;
  const nextMessages = [...args.messages];
  if (assistantMessage) nextMessages.push(assistantMessage);

  const toolCalls = response.choices[0]?.message?.tool_calls ?? [];
  for (const call of toolCalls) {
    if (call.type !== "function") continue;
    if (call.function?.name !== "get_slide_schema") continue;

    let parsed: { mode?: "all" | "type"; slideType?: string } = {};
    try {
      parsed = JSON.parse(call.function.arguments || "{}");
    } catch {
      parsed = {};
    }

    nextMessages.push({
      role: "tool",
      tool_call_id: call.id,
      content: schemaToolOutput(parsed.mode ?? "all", parsed.slideType),
    });
  }

  return nextMessages;
}

async function repairDeckWithModel(args: {
  provider: Provider;
  apiKey: string;
  mode: Exclude<Mode, "chat">;
  raw: string;
  existingSlidesJson: string;
}): Promise<Slide[]> {
  const prompt = buildRepairPrompt(args.mode, args.raw, args.existingSlidesJson);

  if (args.provider === "openai") {
    const { text } = await callOpenAIText({
      apiKey: args.apiKey,
      model: MODELS.openai.repair,
      system: "You fix invalid slide JSON. Return JSON only.",
      user: prompt,
      maxTokens: MAX_REPAIR_TOKENS,
      responseFormat: { type: "json_object" },
    });
    const repaired = parseDeckJson(text);
    return repaired;
  }

  const text = await callAnthropicText({
    apiKey: args.apiKey,
    model: MODELS.anthropic.repair,
    system: "You fix invalid slide JSON. Return JSON only.",
    user: prompt,
    maxTokens: MAX_REPAIR_TOKENS,
  });
  return parseDeckJson(text);
}

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
      const text =
        args.provider === "openai"
          ? (
              await callOpenAIText({
                apiKey: args.apiKey,
                model: MODELS.openai.chat,
                system,
                user: args.instruction,
                maxTokens: MAX_CHAT_TOKENS,
              })
            ).text
          : await callAnthropicText({
              apiKey: args.apiKey,
              model: MODELS.anthropic.chat,
              system,
              user: args.instruction,
              maxTokens: MAX_CHAT_TOKENS,
            });
      return NextResponse.json({ reply: text.trim() });
    } catch (err) {
      console.error(`${args.provider} chat API error:`, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "AI service unavailable" }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const gen =
          args.provider === "openai"
            ? streamOpenAIText({
                apiKey: args.apiKey,
                model: MODELS.openai.chat,
                system,
                user: args.instruction,
                maxTokens: MAX_CHAT_TOKENS,
              })
            : streamAnthropicText({
                apiKey: args.apiKey,
                model: MODELS.anthropic.chat,
                system,
                user: args.instruction,
                maxTokens: MAX_CHAT_TOKENS,
              });

        let accumulated = "";
        for await (const chunk of gen) {
          accumulated += chunk;
          sseEncode(controller, encoder, { type: "delta", text: chunk });
        }

        sseEncode(controller, encoder, { type: "done", reply: accumulated.trim() });
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
  const system = buildDeckSystemPrompt(args.mode, args.history, args.slideSummary, args.existingSlidesJson);
  const user = args.instruction;

  if (args.provider === "openai") {
    const initialMessages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    const withToolContext = await resolveOpenAIToolRound({
      apiKey: args.apiKey,
      model: MODELS.openai.deck,
      messages: initialMessages,
    });

    const finalMessages = [
      ...withToolContext,
      {
        role: "user" as const,
        content:
          args.mode === "update"
            ? "Return the edited deck now as JSON object {\"slides\": [...]}."
            : "Return the new deck now as JSON object {\"slides\": [...]}.",
      },
    ];

    if (!args.stream) {
      try {
        const { text } = await callOpenAIText({
          apiKey: args.apiKey,
          model: MODELS.openai.deck,
          system,
          user,
          maxTokens: MAX_DECK_TOKENS,
          messages: finalMessages,
          responseFormat: { type: "json_object" },
        });

        try {
          return NextResponse.json(parseDeckJson(text));
        } catch {
          const repaired = await repairDeckWithModel({
            provider: args.provider,
            apiKey: args.apiKey,
            mode: args.mode,
            raw: text,
            existingSlidesJson: args.existingSlidesJson,
          });
          return NextResponse.json(repaired);
        }
      } catch (err) {
        console.error(`${args.provider} deck API error:`, err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "AI service unavailable" }, { status: 502 });
      }
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const gen = streamOpenAIText({
            apiKey: args.apiKey,
            model: MODELS.openai.deck,
            system,
            user,
            maxTokens: MAX_DECK_TOKENS,
            messages: finalMessages,
            responseFormat: { type: "json_object" },
          });

          let accumulated = "";
          for await (const chunk of gen) {
            accumulated += chunk;
            sseEncode(controller, encoder, { type: "delta", text: chunk });
          }

          try {
            const slides = parseDeckJson(accumulated);
            sseEncode(controller, encoder, { type: "done", slides });
          } catch {
            const repaired = await repairDeckWithModel({
              provider: args.provider,
              apiKey: args.apiKey,
              mode: args.mode,
              raw: accumulated,
              existingSlidesJson: args.existingSlidesJson,
            });
            sseEncode(controller, encoder, { type: "done", slides: repaired });
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

  if (!args.stream) {
    try {
      const text = await callAnthropicText({
        apiKey: args.apiKey,
        model: MODELS.anthropic.deck,
        system,
        user,
        maxTokens: MAX_DECK_TOKENS,
      });

      try {
        return NextResponse.json(parseDeckJson(text));
      } catch {
        const repaired = await repairDeckWithModel({
          provider: args.provider,
          apiKey: args.apiKey,
          mode: args.mode,
          raw: text,
          existingSlidesJson: args.existingSlidesJson,
        });
        return NextResponse.json(repaired);
      }
    } catch (err) {
      console.error(`${args.provider} deck API error:`, err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "AI service unavailable" }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        const gen = streamAnthropicText({
          apiKey: args.apiKey,
          model: MODELS.anthropic.deck,
          system,
          user,
          maxTokens: MAX_DECK_TOKENS,
        });

        let accumulated = "";
        for await (const chunk of gen) {
          accumulated += chunk;
          sseEncode(controller, encoder, { type: "delta", text: chunk });
        }

        try {
          const slides = parseDeckJson(accumulated);
          sseEncode(controller, encoder, { type: "done", slides });
        } catch {
          const repaired = await repairDeckWithModel({
            provider: args.provider,
            apiKey: args.apiKey,
            mode: args.mode,
            raw: accumulated,
            existingSlidesJson: args.existingSlidesJson,
          });
          sseEncode(controller, encoder, { type: "done", slides: repaired });
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

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = validateBody(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const provider = getProvider(body);
  const apiKey = getApiKey(body, provider);
  const instruction = typeof body.instruction === "string" ? normalizeWhitespace(body.instruction) : "";
  const stream = body.stream === true;
  const history = compactHistory(body.history);
  const parsedSlides = Array.isArray(body.slides) ? SlidesSchema.safeParse(body.slides) : null;
  const slides = parsedSlides?.success ? parsedSlides.data : [];
  const slideSummary = summarizeSlides(slides);
  const existingSlidesJson = slides.length ? compactSlidesJson(slides) : "";
  const mode: Mode =
    body.mode ?? (slides.length > 0 ? "update" : "chat");

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

  if (mode === "update" && !parsedSlides?.success) {
    return NextResponse.json({ error: "Invalid slides payload" }, { status: 400 });
  }

  if (mode === "chat") {
    return handleChat({
      provider,
      apiKey,
      instruction,
      history,
      slideSummary,
      stream,
    });
  }

  return handleDeck({
    provider,
    apiKey,
    mode,
    instruction,
    history,
    slideSummary,
    existingSlides: slides,
    existingSlidesJson,
    stream,
  });
}
