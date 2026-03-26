import type { Tile } from "./mapData";
import { MAP_COLS, MAP_ROWS, TILE_SIZE } from "./mapData";

export type CardinalFacing = "up" | "down" | "left" | "right";

/** All water-family tile types (including names reserved for future tiles). */
const WATER_TYPES = new Set<string>([
  "water",
  "water_top",
  "water_bottom",
  "water_left",
  "water_right",
  "water_lily",
  "water_lily1",
  "water_lily2",
  "water_shrub",
  "water_shrub1",
  "water_shrub2",
  "pond",
]);

export function canMoveTo(
  grid: Tile[][],
  pixelX: number,
  pixelY: number,
): boolean {
  const col = Math.floor(pixelX / TILE_SIZE);
  const row = Math.floor(pixelY / TILE_SIZE);
  if (col < 0 || col >= MAP_COLS) return false;
  if (row < 0 || row >= MAP_ROWS) return false;
  const tile = grid[row]![col]!;
  if (WATER_TYPES.has(tile.type)) {
    /** Bridge cells use `water` + walkable; all other water-family tiles stay blocked. */
    if (tile.walkable && tile.type === "water") return true;
    return false;
  }
  return tile.walkable;
}

/** Slightly smaller than half a tile — tighter obstacle / water checks. */
const SPRITE_BB_HALF = TILE_SIZE * 0.175;

/** Center + four corners; trees use trunk band only when `collisionOffsetY` is set. */
export function canSpriteMoveTo(
  grid: Tile[][],
  centerX: number,
  centerY: number,
): boolean {
  const r = SPRITE_BB_HALF;

  function checkPoint(px: number, py: number): boolean {
    const col = Math.floor(px / TILE_SIZE);
    const row = Math.floor(py / TILE_SIZE);
    if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) {
      return false;
    }
    const tile = grid[row]![col]!;

    if (WATER_TYPES.has(tile.type)) {
      if (tile.walkable && tile.type === "water") return true;
      return false;
    }

    if (tile.collisionOffsetY != null) {
      const tileTopY = row * TILE_SIZE;
      const zoneStartY = tileTopY + tile.collisionOffsetY * TILE_SIZE;
      const zoneEndY =
        zoneStartY + (tile.collisionHeight ?? 0.35) * TILE_SIZE;
      if (py < zoneStartY) return true;
      if (py >= zoneStartY && py <= zoneEndY) return false;
      return true;
    }

    return tile.walkable;
  }

  if (!checkPoint(centerX, centerY)) return false;
  if (!checkPoint(centerX - r, centerY - r)) return false;
  if (!checkPoint(centerX + r, centerY - r)) return false;
  if (!checkPoint(centerX - r, centerY + r)) return false;
  if (!checkPoint(centerX + r, centerY + r)) return false;
  return true;
}

export function getTileAt(
  grid: Tile[][],
  pixelX: number,
  pixelY: number,
): Tile | null {
  const col = Math.floor(pixelX / TILE_SIZE);
  const row = Math.floor(pixelY / TILE_SIZE);
  if (col < 0 || col >= MAP_COLS) return null;
  if (row < 0 || row >= MAP_ROWS) return null;
  return grid[row]![col]!;
}

export function getTriggerAt(
  grid: Tile[][],
  pixelX: number,
  pixelY: number,
): string | null {
  const tile = getTileAt(grid, pixelX, pixelY);
  return tile?.trigger ?? null;
}

function isWalkableLandNextToWater(tile: Tile): boolean {
  if (WATER_TYPES.has(tile.type)) {
    if (tile.type === "water" && tile.walkable) return false;
    return false;
  }
  return tile.walkable;
}

/**
 * True when the sprite stands on walkable land (not bridge, not in water) and
 * a cardinal neighbor tile is any water-family type (river, pond, bank, etc.).
 */
export function isLandAdjacentToWater(
  grid: Tile[][],
  centerX: number,
  centerY: number,
): boolean {
  const tile = getTileAt(grid, centerX, centerY);
  if (!tile || !isWalkableLandNextToWater(tile)) return false;

  const col = Math.floor(centerX / TILE_SIZE);
  const row = Math.floor(centerY / TILE_SIZE);
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const;
  for (const [dc, dr] of dirs) {
    const c = col + dc;
    const r = row + dr;
    if (c < 0 || r < 0 || c >= MAP_COLS || r >= MAP_ROWS) continue;
    const t = grid[r]![c]!;
    if (WATER_TYPES.has(t.type)) return true;
  }
  return false;
}

/** First cardinal neighbor that is water; used to face the character toward it. */
export function findDirectionTowardAdjacentWater(
  grid: Tile[][],
  centerX: number,
  centerY: number,
): CardinalFacing | null {
  const col = Math.floor(centerX / TILE_SIZE);
  const row = Math.floor(centerY / TILE_SIZE);
  const checks: Array<{ dir: CardinalFacing; c: number; r: number }> = [
    { dir: "up", c: col, r: row - 1 },
    { dir: "down", c: col, r: row + 1 },
    { dir: "left", c: col - 1, r: row },
    { dir: "right", c: col + 1, r: row },
  ];
  for (const { dir, c, r } of checks) {
    if (c < 0 || r < 0 || c >= MAP_COLS || r >= MAP_ROWS) continue;
    const t = grid[r]![c]!;
    if (WATER_TYPES.has(t.type)) return dir;
  }
  return null;
}
