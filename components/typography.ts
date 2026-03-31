import type React from "react";
import type { Typography } from "@/schemas/slideSchema";

const weightMap: Record<string, string> = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

/**
 * Converts a slide's `typography` object into CSS style objects for each
 * semantic role. Spread these onto your DOM elements:
 *
 *   const t = typo(typography);
 *   <div style={t.root}>
 *     <h2 style={t.heading}>…</h2>
 *     <p style={t.body}>…</p>
 *     <span style={t.muted}>…</span>
 *   </div>
 */
export function typo(t: Typography): {
  root: React.CSSProperties;
  heading: React.CSSProperties;
  body: React.CSSProperties;
  muted: React.CSSProperties;
  accent: React.CSSProperties;
} {
  return {
    root: {
      ...(t?.fontFamily ? { fontFamily: t.fontFamily } : {}),
    },
    heading: {
      ...(t?.headingColor ? { color: t.headingColor } : {}),
      ...(t?.headingSize ? { fontSize: `${t.headingSize}px` } : {}),
      ...(t?.headingWeight ? { fontWeight: weightMap[t.headingWeight] } : {}),
      ...(t?.headingAlign ? { textAlign: t.headingAlign } : {}),
    },
    body: {
      ...(t?.bodyColor ? { color: t.bodyColor } : {}),
      ...(t?.bodySize ? { fontSize: `${t.bodySize}px` } : {}),
      ...(t?.bodyAlign ? { textAlign: t.bodyAlign } : {}),
      ...(t?.lineHeight ? { lineHeight: t.lineHeight } : {}),
    },
    muted: {
      ...(t?.mutedColor ? { color: t.mutedColor } : {}),
    },
    accent: {
      ...(t?.accentColor ? { borderColor: t.accentColor } : {}),
    },
  };
}
