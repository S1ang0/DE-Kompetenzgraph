// Shared semester glyphs so the graph nodes and the UI (legend / filter / badge)
// use the EXACT same shapes: snowflake = winter, sun = summer, circle = both.

export function starPath(n, R, k) {
  const ri = R * k;
  let s = "";
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 === 0 ? R : ri;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    s += (i ? "L" : "M") + (Math.cos(a) * r).toFixed(1) + "," + (Math.sin(a) * r).toFixed(1);
  }
  return s + "Z";
}

export const circlePath = (r) => `M${-r},0A${r},${r} 0 1,0 ${r},0A${r},${r} 0 1,0 ${-r},0Z`;

// graph node glyph (r = node radius; stars extend a bit beyond r for visual weight)
export function nodeGlyphD(semester, r) {
  if (semester === "winter") return starPath(6, r * 1.8, 0.34);   // snowflake
  if (semester === "summer") return starPath(8, r * 1.5, 0.62);   // sun
  return circlePath(r * 1.35);                                     // both / unknown (bigger, solid)
}

// fixed-size UI glyph (same shapes, normalised so all three read at a similar size)
export function uiGlyphD(semester, R = 11) {
  if (semester === "winter") return starPath(6, R, 0.34);
  if (semester === "summer") return starPath(8, R, 0.62);
  return circlePath(R * 0.7);
}
