import { z } from "zod";

// Shared field
const theme = z.enum(["light", "dark"]).default("dark");

// ── Slide schemas ────────────────────────────────────────────────────────────

export const TitleSlideSchema = z.object({
  type: z.literal("title"),
  title: z.string(),
  subtitle: z.string().optional(),
  theme,
});

export const ContentSlideSchema = z.object({
  type: z.literal("content"),
  title: z.string(),
  points: z.array(z.string()).min(1),
  theme,
});

export const EndSlideSchema = z.object({
  type: z.literal("end"),
  title: z.string(),
  theme,
});

export const ImageSlideSchema = z.object({
  type: z.literal("image"),
  title: z.string(),
  imageUrl: z.string(),
  caption: z.string().optional(),
  theme,
});

const columnSchema = z.object({
  heading: z.string().optional(),
  points: z.array(z.string()).min(1),
});

export const TwoColumnSlideSchema = z.object({
  type: z.literal("two-column"),
  title: z.string(),
  left: columnSchema,
  right: columnSchema,
  theme,
});

export const ThreeColumnSlideSchema = z.object({
  type: z.literal("three-column"),
  title: z.string(),
  columns: z
    .array(z.object({ heading: z.string(), body: z.string() }))
    .length(3),
  theme,
});

export const CardsSlideSchema = z.object({
  type: z.literal("cards"),
  title: z.string(),
  cards: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        icon: z.string().optional(),
      })
    )
    .min(2)
    .max(6),
  theme,
});

export const QuoteSlideSchema = z.object({
  type: z.literal("quote"),
  quote: z.string(),
  author: z.string().optional(),
  theme,
});

export const StatsSlideSchema = z.object({
  type: z.literal("stats"),
  title: z.string(),
  stats: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .min(2)
    .max(4),
  theme,
});

// ── Discriminated union ──────────────────────────────────────────────────────

export const SlideSchema = z.discriminatedUnion("type", [
  TitleSlideSchema,
  ContentSlideSchema,
  EndSlideSchema,
  ImageSlideSchema,
  TwoColumnSlideSchema,
  ThreeColumnSlideSchema,
  CardsSlideSchema,
  QuoteSlideSchema,
  StatsSlideSchema,
]);

export const SlidesSchema = z.array(SlideSchema).min(1);

// ── Inferred types ───────────────────────────────────────────────────────────

export type TitleSlide = z.infer<typeof TitleSlideSchema>;
export type ContentSlide = z.infer<typeof ContentSlideSchema>;
export type EndSlide = z.infer<typeof EndSlideSchema>;
export type ImageSlide = z.infer<typeof ImageSlideSchema>;
export type TwoColumnSlide = z.infer<typeof TwoColumnSlideSchema>;
export type ThreeColumnSlide = z.infer<typeof ThreeColumnSlideSchema>;
export type CardsSlide = z.infer<typeof CardsSlideSchema>;
export type QuoteSlide = z.infer<typeof QuoteSlideSchema>;
export type StatsSlide = z.infer<typeof StatsSlideSchema>;
export type Slide = z.infer<typeof SlideSchema>;
