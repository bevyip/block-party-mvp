/** Top-down map constants and static layout data. */

export const TILE_SIZE = 192;
export const MAP_COLS = 16;
export const MAP_ROWS = 10;

export const MAP_WIDTH = MAP_COLS * TILE_SIZE;
export const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;

export type TileType =
  | "grass"
  | "water"
  | "water_top"
  | "water_lily"
  | "water_lily1"
  | "water_lily2"
  | "water_shrub"
  | "water_shrub1"
  | "water_shrub2"
  | "pond"
  | "bridge"
  | "house_body"
  | "house_entrance"
  | "tree_large"
  | "tree_small"
  | "rock"
  | "decoration";

export type Tile = {
  type: TileType;
  walkable: boolean;
  asset?: string;
  objectAsset?: string;
  trigger?: string;
  /** Pixel offset from tile top-left anchor (objects); set at generation time. */
  offsetX?: number;
  offsetY?: number;
  /** Per-object size multiplier (~0.85–1.15). */
  scale?: number;
  /** Y offset from tile top (0–1) where collision zone starts (e.g. trees: trunk base). */
  collisionOffsetY?: number;
  /** Collision zone height as fraction of tile (e.g. 0.35 = bottom 35%). */
  collisionHeight?: number;
};

/** Default walkability per tile type (grid tiles still set `.walkable` explicitly). */
export const TILE_WALKABLE: Record<TileType, boolean> = {
  grass: true,
  water: false,
  water_top: false,
  water_lily: false,
  water_lily1: false,
  water_lily2: false,
  water_shrub: false,
  water_shrub1: false,
  water_shrub2: false,
  pond: false,
  bridge: false,
  house_body: false,
  house_entrance: true,
  tree_large: false,
  tree_small: false,
  rock: false,
  decoration: true,
};

/** River left column per row (two tiles wide: col and col+1). */
export const RIVER_PATH: readonly number[] = [
  5, 5, 6, 6, 7, 7, 8, 8, 7, 7,
];

export const BRIDGE_ROW = 5;

/** Bridge plank overlay (water stays underneath). */
export const BRIDGE_OVERLAY = {
  row: BRIDGE_ROW,
  col: RIVER_PATH[BRIDGE_ROW]!,
  widthTiles: 2,
  heightTiles: 1,
} as const;

/** House 2×2 footprint top-left (cols 2–3, rows 1–2). */
export const HOUSE_COL = 2;
export const HOUSE_ROW = 1;
export const HOUSE_W = 2;
export const HOUSE_H = 2;

/** Entrance trigger tile. */
export const HOUSE_ENTRANCE_COL = 2;
export const HOUSE_ENTRANCE_ROW = 3;

export const SPAWN_POINT = {
  x: RIVER_PATH[BRIDGE_ROW]! * TILE_SIZE + TILE_SIZE,
  y: BRIDGE_ROW * TILE_SIZE + TILE_SIZE / 2,
} as const;

/** Asset roots (served from /public). */
export const ASSETS = {
  grass1: "/assets/environment/ground/grass1.png",
  grass2: "/assets/environment/ground/grass2.png",
  water: "/assets/environment/water/water.png",
  water_top: "/assets/environment/water/water_top.png",
  water_lily: "/assets/environment/water/water_lily.png",
  water_lily1: "/assets/environment/water/water_lily1.png",
  water_lily2: "/assets/environment/water/water_lily2.png",
  water_shrub: "/assets/environment/water/water_shrub.png",
  water_shrub1: "/assets/environment/water/water_shrub1.png",
  water_shrub2: "/assets/environment/water/water_shrub2.png",
  pond: "/assets/environment/water/pond.png",
  /** bridge2.png not in repo; use bridge.png */
  bridge: "/assets/environment/structures/bridge.png",
  house_close: "/assets/environment/structures/house_close.png",
  house_open: "/assets/environment/structures/house_open.png",
  green_t1: "/assets/environment/trees/green_t1.png",
  green_t2: "/assets/environment/trees/green_t2.png",
  green_t3: "/assets/environment/trees/green_t3.png",
  red_t1: "/assets/environment/trees/red_t1.png",
  red_t2: "/assets/environment/trees/red_t2.png",
  red_t3: "/assets/environment/trees/red_t3.png",
  yellow_t1: "/assets/environment/trees/yellow_t1.png",
  yellow_t2: "/assets/environment/trees/yellow_t2.png",
  yellow_t3: "/assets/environment/trees/yellow_t3.png",
  apple: "/assets/environment/decorations/apple.png",
  rock1: "/assets/environment/decorations/rock1.png",
  rock2: "/assets/environment/decorations/rock2.png",
  rock3: "/assets/environment/decorations/rock3.png",
} as const;

/** River water visuals that can crossfade (excludes bank `water_top` and `pond`). */
export const WATER_SWAP_VARIANT_ASSETS: readonly string[] = [
  ASSETS.water,
  ASSETS.water_lily,
  ASSETS.water_lily1,
  ASSETS.water_lily2,
  ASSETS.water_shrub,
  ASSETS.water_shrub1,
  ASSETS.water_shrub2,
];

const WATER_SWAP_URL_SET = new Set(WATER_SWAP_VARIANT_ASSETS);

/** True for river water tiles that should animate between variants. */
export function isSwappableRiverWaterTile(tile: Tile): boolean {
  if (tile.type === "water_top" || tile.type === "pond") return false;
  const a = tile.asset;
  if (!a || !WATER_SWAP_URL_SET.has(a)) return false;
  return (
    tile.type === "water" ||
    tile.type === "water_lily" ||
    tile.type === "water_lily1" ||
    tile.type === "water_lily2" ||
    tile.type === "water_shrub" ||
    tile.type === "water_shrub1" ||
    tile.type === "water_shrub2"
  );
}
