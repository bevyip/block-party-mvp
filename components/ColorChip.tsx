import React from "react";
import { resolvePegSwatchHex } from "../lib/pegSwatchColors";

/** Color swatch + label for peg / palette display (pipeline + side panel). */
export function ColorChip({ color }: { color: string }) {
  const hex = resolvePegSwatchHex(color);
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
