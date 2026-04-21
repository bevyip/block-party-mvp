/**
 * Lite Brite peg labels from interpretation (`peg_colors_used`) and hex literals.
 * Keep in sync with pipeline `uniqueColors` / `ColorChip` display.
 */
const PEG_HEX: Record<string, string> = {
  pink: "#ff5ecb",
  red: "#e81c2a",
  blue: "#1a6fff",
  green: "#0a7d32",
  yellow: "#ffe600",
  white: "#f0f0f0",
  orange: "#ff8c00",
  "#ff5ecb": "#ff5ecb",
  "#e81c2a": "#e81c2a",
  "#1a6fff": "#1a6fff",
  "#0a7d32": "#0a7d32",
  "#ffe600": "#ffe600",
  "#f0f0f0": "#f0f0f0",
  "#ff8c00": "#ff8c00",
};

/** Resolve a peg color name or `#rrggbb` string to a 6-digit hex, or null if unknown. */
export function resolvePegSwatchHex(raw: string): string | null {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  const key = s.toLowerCase();
  if (PEG_HEX[key]) return PEG_HEX[key];
  return null;
}
