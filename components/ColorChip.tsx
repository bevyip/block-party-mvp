import React from "react";

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

function resolveSwatchHex(raw: string): string | null {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  const key = s.toLowerCase();
  if (PEG_HEX[key]) return PEG_HEX[key];
  return null;
}

/** Color swatch + label for peg / palette display (pipeline + side panel). */
export function ColorChip({ color }: { color: string }) {
  const hex = resolveSwatchHex(color);
  const bg = hex ?? "#333";
  return (
    <span
      className="inline-flex items-center gap-2 rounded-md border border-neutral-600 bg-neutral-800/80 px-2 py-1 text-xs text-neutral-300"
      title={color}
    >
      <span
        className="h-5 w-5 flex-shrink-0 rounded border border-neutral-500"
        style={{ backgroundColor: bg }}
      />
      <span className="max-w-[140px] truncate font-mono">{color}</span>
    </span>
  );
}
