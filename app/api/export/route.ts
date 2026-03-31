import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { SlidesSchema, type Slide, type Typography } from "@/schemas/slideSchema";
import { DEFAULT_SLIDES } from "@/lib/defaultSlides";

// ── Constants ────────────────────────────────────────────────────────────────

const W = 13.33; // slide width (inches, 16:9)
const H = 7.5; // slide height (inches)
const MARGIN = 0.8;
const CONTENT_W = W - MARGIN * 2;

const DARK_BG = "0a0a0a";
const LIGHT_BG = "ffffff";
const DARK_TEXT = "ffffff";
const LIGHT_TEXT = "0a0a0a";
const DARK_MUTED = "666666";
const LIGHT_MUTED = "888888";
const DARK_BORDER = "2a2a2a";
const LIGHT_BORDER = "e5e5e5";

function colors(theme: "light" | "dark") {
  return {
    bg: theme === "dark" ? DARK_BG : LIGHT_BG,
    text: theme === "dark" ? DARK_TEXT : LIGHT_TEXT,
    muted: theme === "dark" ? DARK_MUTED : LIGHT_MUTED,
    border: theme === "dark" ? DARK_BORDER : LIGHT_BORDER,
    cardBg: theme === "dark" ? "141414" : "f9f9f9",
  };
}

/** Strip leading # from hex color for pptxgenjs (which wants "FF0000" not "#FF0000") */
function hex(color: string): string {
  return color.replace(/^#/, "");
}

/**
 * Resolve colors for a slide, overlaying typography overrides on theme defaults.
 * Returns { bg, heading, body, muted, border, cardBg, fontFace } ready for pptxgenjs.
 */
function resolveColors(theme: "light" | "dark", typography: Typography) {
  const base = colors(theme);
  const weightPt: Record<string, boolean> = {
    bold: true,
    semibold: true,
    medium: false,
    normal: false,
  };
  return {
    bg: base.bg,
    heading: typography?.headingColor ? hex(typography.headingColor) : base.text,
    body: typography?.bodyColor ? hex(typography.bodyColor) : base.text,
    muted: typography?.mutedColor ? hex(typography.mutedColor) : base.muted,
    border: typography?.accentColor ? hex(typography.accentColor) : base.border,
    cardBg: base.cardBg,
    fontFace: typography?.fontFamily ?? undefined,
    headingSize: typography?.headingSize ?? undefined,
    bodySize: typography?.bodySize ?? undefined,
    headingBold: typography?.headingWeight
      ? weightPt[typography.headingWeight] ?? false
      : undefined,
    headingAlign: typography?.headingAlign as "left" | "center" | "right" | undefined,
    bodyAlign: typography?.bodyAlign as "left" | "center" | "right" | undefined,
  };
}

/** Strip markdown markers from a string for clean PPTX plain text */
function stripMd(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

// ── Slide renderers ───────────────────────────────────────────────────────────

function addTitleSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "title" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };

  s.addText(stripMd(slide.title), {
    x: MARGIN, y: 2.5, w: CONTENT_W, h: 1.6,
    fontSize: c.headingSize ?? 48,
    bold: c.headingBold ?? true,
    color: c.heading,
    align: c.headingAlign ?? "center",
    ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  if (slide.subtitle) {
    s.addText(stripMd(slide.subtitle), {
      x: MARGIN, y: 4.3, w: CONTENT_W, h: 0.8,
      fontSize: c.bodySize ?? 24,
      color: c.muted,
      align: c.bodyAlign ?? "center",
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
  }
}

function addContentSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "content" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };

  s.addText(stripMd(slide.title), {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: c.headingSize ?? 36,
    bold: c.headingBold ?? true,
    color: c.heading,
    align: c.headingAlign,
    ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  s.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: 1.65, w: CONTENT_W, h: 0.02, fill: { color: c.border },
  });

  const bulletItems = slide.points.map((p) => ({
    text: stripMd(p),
    options: {
      bullet: { type: "bullet" as const },
      fontSize: c.bodySize ?? 22,
      color: c.body,
      breakLine: true,
      paraSpaceAfter: 8,
      align: c.bodyAlign,
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    },
  }));

  s.addText(bulletItems, { x: MARGIN, y: 1.9, w: CONTENT_W, h: 5.0, valign: "top" });
}

function addTwoColumnSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "two-column" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };
  const colW = (CONTENT_W - 0.4) / 2;

  s.addText(stripMd(slide.title), {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: c.headingSize ?? 36, bold: c.headingBold ?? true, color: c.heading,
    align: c.headingAlign, ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  s.addShape(pptx.ShapeType.rect, {
    x: MARGIN + colW + 0.2, y: 1.8, w: 0.02, h: 5.2, fill: { color: c.border },
  });

  for (const [col, xOffset] of [
    [slide.left, 0],
    [slide.right, colW + 0.42],
  ] as const) {
    const x = MARGIN + xOffset;
    if (col.heading) {
      s.addText(stripMd(col.heading), {
        x, y: 1.8, w: colW, h: 0.7,
        fontSize: c.bodySize ?? 20, bold: true, color: c.body,
        ...(c.fontFace ? { fontFace: c.fontFace } : {}),
      });
    }
    const items = col.points.map((p) => ({
      text: stripMd(p),
      options: {
        bullet: { type: "bullet" as const },
        fontSize: c.bodySize ?? 19,
        color: c.body,
        breakLine: true,
        paraSpaceAfter: 6,
        align: c.bodyAlign,
        ...(c.fontFace ? { fontFace: c.fontFace } : {}),
      },
    }));
    s.addText(items, { x, y: col.heading ? 2.6 : 1.9, w: colW, h: 4.5, valign: "top" });
  }
}

function addThreeColumnSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "three-column" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };
  const colW = (CONTENT_W - 0.4) / 3;

  s.addText(stripMd(slide.title), {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: c.headingSize ?? 36, bold: c.headingBold ?? true, color: c.heading,
    align: c.headingAlign, ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  slide.columns.forEach((col, i) => {
    const x = MARGIN + i * (colW + 0.2);
    s.addText(stripMd(col.heading), {
      x, y: 1.8, w: colW, h: 0.7,
      fontSize: c.bodySize ?? 20, bold: true, color: c.body,
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
    s.addShape(pptx.ShapeType.rect, {
      x, y: 2.55, w: colW, h: 0.02, fill: { color: c.border },
    });
    s.addText(stripMd(col.body), {
      x, y: 2.7, w: colW, h: 4.4,
      fontSize: c.bodySize ? c.bodySize - 3 : 17,
      color: c.muted, valign: "top", wrap: true,
      align: c.bodyAlign,
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
  });
}

function addCardsSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "cards" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };

  s.addText(stripMd(slide.title), {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: c.headingSize ?? 36, bold: c.headingBold ?? true, color: c.heading,
    align: c.headingAlign, ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  const count = slide.cards.length;
  const cols = count <= 3 ? count : Math.ceil(count / 2);
  const rows = Math.ceil(count / cols);
  const cardW = (CONTENT_W - (cols - 1) * 0.25) / cols;
  const cardH = (5.2 - (rows - 1) * 0.25) / rows;
  const startY = 1.9;

  slide.cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cardW + 0.25);
    const y = startY + row * (cardH + 0.25);

    s.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cardW, h: cardH,
      fill: { color: c.cardBg },
      line: { color: c.border, width: 1 },
      rectRadius: 0.12,
    });

    let textY = y + 0.2;
    if (card.icon) {
      s.addText(card.icon, { x: x + 0.2, y: textY, w: 0.6, h: 0.5, fontSize: 20 });
      textY += 0.55;
    }
    s.addText(stripMd(card.title), {
      x: x + 0.2, y: textY, w: cardW - 0.4, h: 0.5,
      fontSize: c.bodySize ?? 17, bold: true, color: c.body,
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
    s.addText(stripMd(card.description), {
      x: x + 0.2, y: textY + 0.55, w: cardW - 0.4, h: cardH - (card.icon ? 1.5 : 0.95),
      fontSize: c.bodySize ? c.bodySize - 3 : 14, color: c.muted, wrap: true, valign: "top",
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
  });
}

function addStatsSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "stats" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };

  s.addText(stripMd(slide.title), {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: c.headingSize ?? 36, bold: c.headingBold ?? true, color: c.heading,
    align: c.headingAlign, ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  const count = slide.stats.length;
  const boxW = (CONTENT_W - (count - 1) * 0.4) / count;

  slide.stats.forEach((stat, i) => {
    const x = MARGIN + i * (boxW + 0.4);
    s.addShape(pptx.ShapeType.roundRect, {
      x, y: 2.0, w: boxW, h: 3.8,
      fill: { color: c.cardBg },
      line: { color: c.border, width: 1 },
      rectRadius: 0.15,
    });
    s.addText(stripMd(stat.value), {
      x, y: 2.6, w: boxW, h: 1.6,
      fontSize: c.headingSize ?? 52, bold: c.headingBold ?? true,
      color: c.heading, align: "center",
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
    s.addText(stripMd(stat.label), {
      x: x + 0.2, y: 4.3, w: boxW - 0.4, h: 1.2,
      fontSize: c.bodySize ?? 16, color: c.muted, align: "center", wrap: true,
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
  });
}

function addQuoteSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "quote" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };

  s.addText("\u201C", {
    x: MARGIN, y: 0.5, w: 1.2, h: 1.5,
    fontSize: 96, color: c.muted, bold: true,
    ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  s.addText(stripMd(slide.quote), {
    x: MARGIN, y: 1.6, w: CONTENT_W, h: 4.0,
    fontSize: c.bodySize ?? 28, color: c.body, italic: true,
    align: "center", wrap: true, valign: "middle",
    ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  if (slide.author) {
    s.addText(`\u2014 ${stripMd(slide.author)}`, {
      x: MARGIN, y: 5.9, w: CONTENT_W, h: 0.6,
      fontSize: c.bodySize ? c.bodySize - 10 : 18, color: c.muted, align: "center",
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
  }
}

async function addImageSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "image" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };

  s.addText(stripMd(slide.title), {
    x: MARGIN, y: 0.4, w: CONTENT_W, h: 0.9,
    fontSize: c.headingSize ?? 30, bold: c.headingBold ?? true, color: c.heading,
    align: c.headingAlign, ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });

  try {
    const res = await fetch(slide.imageUrl);
    const mimeType = res.headers.get("content-type") ?? "image/png";
    const ext = mimeType.includes("svg")
      ? "svg"
      : mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? "jpg"
      : "png";
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const imgH = slide.caption ? 5.0 : 5.6;
    s.addImage({ data: `${mimeType};base64,${base64}`, x: MARGIN, y: 1.5, w: CONTENT_W, h: imgH, sizing: { type: "contain", w: CONTENT_W, h: imgH } });
  } catch {
    s.addText("[Image could not be loaded]", {
      x: MARGIN, y: 3.0, w: CONTENT_W, h: 1.0,
      fontSize: 18, color: c.muted, align: "center",
    });
  }

  if (slide.caption) {
    s.addText(stripMd(slide.caption), {
      x: MARGIN, y: 6.7, w: CONTENT_W, h: 0.5,
      fontSize: c.bodySize ? c.bodySize - 8 : 14, color: c.muted, align: "center",
      ...(c.fontFace ? { fontFace: c.fontFace } : {}),
    });
  }
}

function addEndSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "end" }>) {
  const s = pptx.addSlide();
  const c = resolveColors(slide.theme, slide.typography);
  s.background = { color: c.bg };

  s.addShape(pptx.ShapeType.rect, {
    x: W / 2 - 0.5, y: 3.0, w: 1.0, h: 0.04, fill: { color: c.muted },
  });
  s.addText(stripMd(slide.title), {
    x: MARGIN, y: 3.15, w: CONTENT_W, h: 1.4,
    fontSize: c.headingSize ?? 52, bold: c.headingBold ?? true, color: c.heading,
    align: c.headingAlign ?? "center",
    ...(c.fontFace ? { fontFace: c.fontFace } : {}),
  });
  s.addShape(pptx.ShapeType.rect, {
    x: W / 2 - 0.5, y: 4.6, w: 1.0, h: 0.04, fill: { color: c.muted },
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

async function buildPptx(slides: Slide[]): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33" × 7.5"
  pptx.title = "AutoSlides Export";

  for (const slide of slides) {
    switch (slide.type) {
      case "title":        addTitleSlide(pptx, slide);       break;
      case "content":      addContentSlide(pptx, slide);     break;
      case "two-column":   addTwoColumnSlide(pptx, slide);   break;
      case "three-column": addThreeColumnSlide(pptx, slide); break;
      case "cards":        addCardsSlide(pptx, slide);       break;
      case "stats":        addStatsSlide(pptx, slide);       break;
      case "quote":        addQuoteSlide(pptx, slide);       break;
      case "image":        await addImageSlide(pptx, slide); break;
      case "end":          addEndSlide(pptx, slide);         break;
    }
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

export async function GET(request: Request) {
  const allSlides = DEFAULT_SLIDES;

  const { searchParams } = new URL(request.url);
  const pageParam = searchParams.get("page");

  // page=0 or missing → export all slides
  // page=N (1-based) → export that single slide
  let slides: Slide[];
  let filename: string;

  if (pageParam !== null && pageParam !== "0") {
    const page = Number(pageParam);
    if (!Number.isInteger(page) || page < 1 || page > allSlides.length) {
      return NextResponse.json(
        { error: `page must be 0 (all) or 1–${allSlides.length}` },
        { status: 400 }
      );
    }
    slides = [allSlides[page - 1]];
    filename = `slide-${page}.pptx`;
  } else {
    slides = allSlides;
    filename = "presentation.pptx";
  }

  const buffer = await buildPptx(slides);

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** Client sends slides from localStorage (source of truth in the browser). */
export async function POST(req: Request) {
  let body: { slides?: unknown; page?: string | number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let allSlides: Slide[];
  try {
    allSlides = SlidesSchema.parse(body?.slides);
  } catch {
    return NextResponse.json({ error: "Invalid slides" }, { status: 400 });
  }

  if (allSlides.length === 0) {
    return NextResponse.json({ error: "No slides to export" }, { status: 400 });
  }

  const pageParam =
    body.page !== undefined && body.page !== null ? String(body.page) : null;

  let slides: Slide[];
  let filename: string;

  if (pageParam !== null && pageParam !== "0" && pageParam !== "") {
    const page = Number(pageParam);
    if (!Number.isInteger(page) || page < 1 || page > allSlides.length) {
      return NextResponse.json(
        { error: `page must be 0 (all) or 1–${allSlides.length}` },
        { status: 400 }
      );
    }
    slides = [allSlides[page - 1]];
    filename = `slide-${page}.pptx`;
  } else {
    slides = allSlides;
    filename = "presentation.pptx";
  }

  const buffer = await buildPptx(slides);

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
