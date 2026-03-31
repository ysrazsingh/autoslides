/**
 * RichText — renders inline markdown-style formatting within a string.
 *
 * Supported markers:
 *   **bold**       → <strong>
 *   _italic_       → <em>
 *   __underline__  → <u>
 *   `code`         → <code> (monospace, subtle background)
 *
 * When no markers are present the string is returned as-is (no extra DOM nodes).
 */

import React from "react";

type Seg =
  | { t: "text"; s: string }
  | { t: "bold"; s: string }
  | { t: "italic"; s: string }
  | { t: "underline"; s: string }
  | { t: "code"; s: string };

// Order: __ before _ so double-underscore is matched first
const RE = /\*\*(.+?)\*\*|__(.+?)__|_(.+?)_|`(.+?)`/g;

function parse(input: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(input)) !== null) {
    if (m.index > last) out.push({ t: "text", s: input.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "bold", s: m[1] });
    else if (m[2] !== undefined) out.push({ t: "underline", s: m[2] });
    else if (m[3] !== undefined) out.push({ t: "italic", s: m[3] });
    else if (m[4] !== undefined) out.push({ t: "code", s: m[4] });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ t: "text", s: input.slice(last) });
  return out;
}

export default function RichText({ children }: { children: string }) {
  const segs = parse(children);
  // Fast path: no markers
  if (segs.length === 1 && segs[0].t === "text") return <>{children}</>;
  return (
    <>
      {segs.map((seg, i) => {
        switch (seg.t) {
          case "bold":
            return <strong key={i}>{seg.s}</strong>;
          case "italic":
            return <em key={i}>{seg.s}</em>;
          case "underline":
            return <u key={i}>{seg.s}</u>;
          case "code":
            return (
              <code
                key={i}
                className="font-mono bg-current/10 rounded px-1 py-0.5 text-[0.85em] not-italic"
              >
                {seg.s}
              </code>
            );
          default:
            return <React.Fragment key={i}>{seg.s}</React.Fragment>;
        }
      })}
    </>
  );
}
