import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { SlidesSchema, type Slide } from "@/schemas/slideSchema";
import rawSlides from "@/data/slides.json";

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

// ── Slide renderers ───────────────────────────────────────────────────────────

function addTitleSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "title" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };

  s.addText(slide.title, {
    x: MARGIN, y: 2.5, w: CONTENT_W, h: 1.6,
    fontSize: 48, bold: true, color: c.text, align: "center",
  });

  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: MARGIN, y: 4.3, w: CONTENT_W, h: 0.8,
      fontSize: 24, color: c.muted, align: "center",
    });
  }
}

function addContentSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "content" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };

  s.addText(slide.title, {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: 36, bold: true, color: c.text,
  });

  // Horizontal rule
  s.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: 1.65, w: CONTENT_W, h: 0.02, fill: { color: c.border },
  });

  const bulletItems = slide.points.map((p) => ({
    text: p,
    options: { bullet: { type: "bullet" as const }, fontSize: 22, color: c.text, breakLine: true, paraSpaceAfter: 8 },
  }));

  s.addText(bulletItems, {
    x: MARGIN, y: 1.9, w: CONTENT_W, h: 5.0,
    valign: "top",
  });
}

function addTwoColumnSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "two-column" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };
  const colW = (CONTENT_W - 0.4) / 2;

  s.addText(slide.title, {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: 36, bold: true, color: c.text,
  });

  // Vertical divider
  s.addShape(pptx.ShapeType.rect, {
    x: MARGIN + colW + 0.2, y: 1.8, w: 0.02, h: 5.2, fill: { color: c.border },
  });

  for (const [col, xOffset] of [
    [slide.left, 0],
    [slide.right, colW + 0.42],
  ] as const) {
    const x = MARGIN + xOffset;
    if (col.heading) {
      s.addText(col.heading, {
        x, y: 1.8, w: colW, h: 0.7,
        fontSize: 20, bold: true, color: c.text,
      });
    }
    const items = col.points.map((p) => ({
      text: p,
      options: { bullet: { type: "bullet" as const }, fontSize: 19, color: c.text, breakLine: true, paraSpaceAfter: 6 },
    }));
    s.addText(items, { x, y: col.heading ? 2.6 : 1.9, w: colW, h: 4.5, valign: "top" });
  }
}

function addThreeColumnSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "three-column" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };
  const colW = (CONTENT_W - 0.4) / 3;

  s.addText(slide.title, {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: 36, bold: true, color: c.text,
  });

  slide.columns.forEach((col, i) => {
    const x = MARGIN + i * (colW + 0.2);
    s.addText(col.heading, {
      x, y: 1.8, w: colW, h: 0.7,
      fontSize: 20, bold: true, color: c.text,
    });
    s.addShape(pptx.ShapeType.rect, {
      x, y: 2.55, w: colW, h: 0.02, fill: { color: c.border },
    });
    s.addText(col.body, {
      x, y: 2.7, w: colW, h: 4.4,
      fontSize: 17, color: c.muted, valign: "top", wrap: true,
    });
  });
}

function addCardsSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "cards" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };

  s.addText(slide.title, {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: 36, bold: true, color: c.text,
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
    s.addText(card.title, {
      x: x + 0.2, y: textY, w: cardW - 0.4, h: 0.5,
      fontSize: 17, bold: true, color: c.text,
    });
    s.addText(card.description, {
      x: x + 0.2, y: textY + 0.55, w: cardW - 0.4, h: cardH - (card.icon ? 1.5 : 0.95),
      fontSize: 14, color: c.muted, wrap: true, valign: "top",
    });
  });
}

function addStatsSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "stats" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };

  s.addText(slide.title, {
    x: MARGIN, y: 0.5, w: CONTENT_W, h: 1.0,
    fontSize: 36, bold: true, color: c.text,
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
    s.addText(stat.value, {
      x, y: 2.6, w: boxW, h: 1.6,
      fontSize: 52, bold: true, color: c.text, align: "center",
    });
    s.addText(stat.label, {
      x: x + 0.2, y: 4.3, w: boxW - 0.4, h: 1.2,
      fontSize: 16, color: c.muted, align: "center", wrap: true,
    });
  });
}

function addQuoteSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "quote" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };

  s.addText("\u201C", {
    x: MARGIN, y: 0.5, w: 1.2, h: 1.5,
    fontSize: 96, color: c.muted, bold: true,
  });

  s.addText(slide.quote, {
    x: MARGIN, y: 1.6, w: CONTENT_W, h: 4.0,
    fontSize: 28, color: c.text, italic: true, align: "center", wrap: true, valign: "middle",
  });

  if (slide.author) {
    s.addText(`\u2014 ${slide.author}`, {
      x: MARGIN, y: 5.9, w: CONTENT_W, h: 0.6,
      fontSize: 18, color: c.muted, align: "center",
    });
  }
}

async function addImageSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "image" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };

  s.addText(slide.title, {
    x: MARGIN, y: 0.4, w: CONTENT_W, h: 0.9,
    fontSize: 30, bold: true, color: c.text,
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
    s.addText(slide.caption, {
      x: MARGIN, y: 6.7, w: CONTENT_W, h: 0.5,
      fontSize: 14, color: c.muted, align: "center",
    });
  }
}

function addEndSlide(pptx: PptxGenJS, slide: Extract<Slide, { type: "end" }>) {
  const s = pptx.addSlide();
  const c = colors(slide.theme);
  s.background = { color: c.bg };

  s.addShape(pptx.ShapeType.rect, {
    x: W / 2 - 0.5, y: 3.0, w: 1.0, h: 0.04, fill: { color: c.muted },
  });
  s.addText(slide.title, {
    x: MARGIN, y: 3.15, w: CONTENT_W, h: 1.4,
    fontSize: 52, bold: true, color: c.text, align: "center",
  });
  s.addShape(pptx.ShapeType.rect, {
    x: W / 2 - 0.5, y: 4.6, w: 1.0, h: 0.04, fill: { color: c.muted },
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  let slides: Slide[];
  try {
    slides = SlidesSchema.parse(rawSlides);
  } catch (err) {
    return NextResponse.json({ error: "Invalid slides.json" }, { status: 500 });
  }

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

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": 'attachment; filename="presentation.pptx"',
    },
  });
}
