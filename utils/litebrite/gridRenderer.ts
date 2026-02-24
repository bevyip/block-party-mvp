// ─────────────────────────────────────────────────────────
// gridRenderer.ts
// Converts a Gemini character grid → PegGrid → rendered PNG sprite.
// Handles scaling to fit LITEBRITE_SPRITE_SIZE with transparent background.
// ─────────────────────────────────────────────────────────

import type { PegGrid, GridAnalysis } from "./types";
import { LITEBRITE_SPRITE_BASE, SCALE } from "./constants";

// ── Character grid → PegGrid ───────────────────────────────

/**
 * Converts the raw string[] grid from Gemini into a 2D PegGrid
 * (null = transparent, hex string = colored peg).
 */
export const charGridToPegGrid = (gridAnalysis: GridAnalysis): PegGrid => {
  const { grid, colorMap } = gridAnalysis;
  return grid.map((row) =>
    row.split("").map((ch) => {
      if (ch === "." || !colorMap[ch]) return null;
      return colorMap[ch];
    })
  );
};

// ── Content bounds ─────────────────────────────────────────

const getContentBounds = (
  grid: PegGrid
): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null => {
  let minRow = grid.length,
    maxRow = -1,
    minCol = (grid[0]?.length ?? 0),
    maxCol = -1;

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < (grid[y]?.length ?? 0); x++) {
      if (grid[y][x] !== null) {
        if (y < minRow) minRow = y;
        if (y > maxRow) maxRow = y;
        if (x < minCol) minCol = x;
        if (x > maxCol) maxCol = x;
      }
    }
  }

  if (maxRow === -1) return null;
  return { minRow, maxRow, minCol, maxCol };
};

/**
 * Returns the pixel bounds of actual content within a rendered sprite.
 * Used by the game engine to position shadows and speech bubbles correctly.
 * Values are in RENDERED pixels (already multiplied by SCALE).
 */
export const getRenderedContentBounds = (
  grid: PegGrid
): { top: number; bottom: number; left: number; right: number; width: number; height: number } => {
  let minRow = grid.length,
    maxRow = -1;
  let minCol = grid[0]?.length ?? 0,
    maxCol = -1;

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < (grid[y]?.length ?? 0); x++) {
      if (grid[y][x] !== null) {
        if (y < minRow) minRow = y;
        if (y > maxRow) maxRow = y;
        if (x < minCol) minCol = x;
        if (x > maxCol) maxCol = x;
      }
    }
  }

  if (maxRow === -1) {
    const fullH = grid.length * SCALE;
    const fullW = (grid[0]?.length ?? 0) * SCALE;
    return { top: 0, bottom: fullH, left: 0, right: fullW, width: fullW, height: fullH };
  }

  return {
    top: minRow * SCALE,
    bottom: (maxRow + 1) * SCALE,
    left: minCol * SCALE,
    right: (maxCol + 1) * SCALE,
    width: (maxCol - minCol + 1) * SCALE,
    height: (maxRow - minRow + 1) * SCALE,
  };
};

// ── Crop to content ────────────────────────────────────────

const cropGrid = (grid: PegGrid): PegGrid => {
  const bounds = getContentBounds(grid);
  if (!bounds) return grid;
  const { minRow, maxRow, minCol, maxCol } = bounds;
  return grid
    .slice(minRow, maxRow + 1)
    .map((row) => row.slice(minCol, maxCol + 1));
};

// ── Scale grid to target dimensions ───────────────────────

/**
 * Scales a PegGrid using nearest-neighbor sampling.
 * Used both to upscale (small peg grid → larger sprite base)
 * and to ensure the grid fits within LITEBRITE_SPRITE_BASE dimensions.
 */
const scaleGrid = (grid: PegGrid, targetW: number, targetH: number): PegGrid => {
  const srcH = grid.length;
  const srcW = grid[0]?.length ?? 0;

  const result: PegGrid = [];
  for (let y = 0; y < targetH; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < targetW; x++) {
      const srcY = Math.floor((y / targetH) * srcH);
      const srcX = Math.floor((x / targetW) * srcW);
      row.push(grid[srcY]?.[srcX] ?? null);
    }
    result.push(row);
  }
  return result;
};

// ── Center grid in a blank canvas ─────────────────────────

const centerInCanvas = (
  grid: PegGrid,
  canvasW: number,
  canvasH: number
): PegGrid => {
  const gridH = grid.length;
  const gridW = grid[0]?.length ?? 0;

  const offsetY = Math.floor((canvasH - gridH) / 2);
  const offsetX = Math.floor((canvasW - gridW) / 2);

  const canvas: PegGrid = Array.from({ length: canvasH }, () =>
    Array(canvasW).fill(null)
  );

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const ty = y + offsetY;
      const tx = x + offsetX;
      if (ty >= 0 && ty < canvasH && tx >= 0 && tx < canvasW) {
        canvas[ty][tx] = grid[y][x];
      }
    }
  }

  return canvas;
};

// ── Main: scale to fit LITEBRITE_SPRITE_BASE ──────────────

export const scalePegGridToSprite = (raw: PegGrid): PegGrid => {
  const cropped = cropGrid(raw);
  const srcH = cropped.length;
  const srcW = cropped[0]?.length ?? 0;

  if (srcH === 0 || srcW === 0) {
    return Array.from({ length: LITEBRITE_SPRITE_BASE.h }, () =>
      Array(LITEBRITE_SPRITE_BASE.w).fill(null)
    );
  }

  const availW = LITEBRITE_SPRITE_BASE.w - 2;
  const availH = LITEBRITE_SPRITE_BASE.h - 2;

  const scaleX = availW / srcW;
  const scaleY = availH / srcH;
  const scale = Math.min(scaleX, scaleY);

  const scaledW = Math.round(srcW * scale);
  const scaledH = Math.round(srcH * scale);

  console.log(
    `[GridRenderer] Peg grid ${srcH}×${srcW} → scaled ${scaledH}×${scaledW} → centered in ${LITEBRITE_SPRITE_BASE.h}×${LITEBRITE_SPRITE_BASE.w}`
  );

  const scaled = scaleGrid(cropped, scaledW, scaledH);
  return centerInCanvas(scaled, LITEBRITE_SPRITE_BASE.w, LITEBRITE_SPRITE_BASE.h);
};

/**
 * Scales a PegGrid to match a specific target height in base pixels.
 * Width is derived from aspect ratio — does not independently fill canvas.
 * Used to ensure side views match the front view height exactly.
 */
export const scalePegGridToMatchHeight = (
  raw: PegGrid,
  targetContentHeight: number,
  canvasHeight: number
): PegGrid => {
  const cropped = cropGrid(raw);
  const srcH = cropped.length;
  const srcW = cropped[0]?.length ?? 0;

  if (srcH === 0 || srcW === 0) {
    return Array.from({ length: canvasHeight }, () =>
      Array(LITEBRITE_SPRITE_BASE.w).fill(null)
    );
  }

  const scale = targetContentHeight / srcH;
  const scaledH = Math.round(srcH * scale);
  const scaledW = Math.max(2, Math.round(srcW * scale));

  console.log(
    `[GridRenderer] Side ${srcH}×${srcW} → scaled ${scaledH}×${scaledW} → centered in ${canvasHeight}×${LITEBRITE_SPRITE_BASE.w}`
  );

  const scaled = scaleGrid(cropped, scaledW, scaledH);
  return centerInCanvas(scaled, LITEBRITE_SPRITE_BASE.w, canvasHeight);
};
