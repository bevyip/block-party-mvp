import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { DoorPhase } from "../../lib/houseState";
import {
  ASSETS,
  BRIDGE_OVERLAY,
  HOUSE_COL,
  HOUSE_ROW,
  MAP_COLS,
  MAP_HEIGHT,
  MAP_ROWS,
  MAP_WIDTH,
  TILE_SIZE,
  WATER_SWAP_VARIANT_ASSETS,
  isSwappableRiverWaterTile,
  type Tile,
} from "../../lib/mapData";
import {
  CELL_HEIGHT,
  CELL_WIDTH,
  GENERATED_SHEET_DIMENSIONS,
  getSpriteFrameRect,
  getSpriteSheetPath,
  type Sprite,
  type SpriteAnimState,
} from "../../lib/spriteSystem";

export type MapCanvasHandle = {
  draw: (sprites: Sprite[], doorPhase: DoorPhase, dtMs: number) => void;
};

function housePhaseUsesOpenImage(phase: DoorPhase): boolean {
  return (
    phase === "opening" ||
    phase === "open" ||
    phase === "opening_out" ||
    phase === "open_out"
  );
}

type MapCanvasProps = {
  grid: Tile[][];
  imageCache: Record<string, HTMLImageElement>;
};

const WATERISH = new Set<string>([
  "water",
  "water_top",
  "water_lily",
  "water_lily1",
  "water_lily2",
  "water_shrub",
  "water_shrub1",
  "water_shrub2",
  "pond",
]);

const SPRITE_DISPLAY_SIZE = TILE_SIZE * 0.72;

type MapImageSource = HTMLImageElement | HTMLCanvasElement;

function extractGeneratedSpriteStateFromUrl(
  url: string,
): SpriteAnimState | null {
  const m = url.match(
    /^\/generated-sprites\/[^/]+\/(idle|walk|run|sit|emote)\.png$/,
  );
  return m ? (m[1] as SpriteAnimState) : null;
}

function normalizeGeneratedSpriteSheet(
  img: HTMLImageElement,
  state: SpriteAnimState,
): MapImageSource {
  const expected = GENERATED_SHEET_DIMENSIONS[state];
  if (!expected) return img;
  if (img.naturalWidth === expected.w && img.naturalHeight === expected.h) {
    return img;
  }
  const canvas = document.createElement("canvas");
  canvas.width = expected.w;
  canvas.height = expected.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return img;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, expected.w, expected.h);
  return canvas;
}

function buildDrawImageCache(
  imageCache: Record<string, HTMLImageElement>,
): Record<string, MapImageSource> {
  const out: Record<string, MapImageSource> = {};
  for (const [url, img] of Object.entries(imageCache)) {
    const state = extractGeneratedSpriteStateFromUrl(url);
    if (state && img.complete && img.naturalWidth > 0) {
      out[url] = normalizeGeneratedSpriteSheet(img, state);
    } else {
      out[url] = img;
    }
  }
  return out;
}

function isDrawableMapImage(src: MapImageSource | null | undefined): boolean {
  if (!src) return false;
  if (src instanceof HTMLCanvasElement) return true;
  return src.complete && src.naturalWidth > 0;
}

const TREE_LARGE_BASE = TILE_SIZE * 1.4;
const TREE_SMALL_BASE = TILE_SIZE * 0.55;
const ROCK_BASE = TILE_SIZE * 0.4;
const APPLE_LAYER_SIZE = TILE_SIZE * 0.18;
const HOUSE_DRAW_W = TILE_SIZE * 2.8;
const HOUSE_DRAW_H = TILE_SIZE * 2.8;

function drawGrassBase(
  ctx: CanvasRenderingContext2D,
  grid: Tile[][],
  cache: Record<string, MapImageSource>,
) {
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const cell = grid[r]![c]!;
      if (WATERISH.has(cell.type)) continue;

      const g =
        cell.type === "grass" || cell.type === "house_entrance"
          ? cell.asset
          : (c + r) % 2 === 0
            ? ASSETS.grass1
            : ASSETS.grass2;
      const img = g ? cache[g] : null;
      const x = c * TILE_SIZE;
      const y = r * TILE_SIZE;
      if (isDrawableMapImage(img)) {
        ctx.drawImage(img, x, y, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = (c + r) % 2 === 0 ? "#2d4a2d" : "#264026";
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

type RiverWaterAnim = {
  fromUrl: string;
  toUrl: string | null;
  fadeT: number;
  stableUntil: number;
};

const RIVER_WATER_FADE_MS = 1800;
const RIVER_WATER_STABLE_MIN_MS = 5200;
const RIVER_WATER_STABLE_MAX_MS = 14000;
const RIVER_WATER_FIRST_SWAP_STAGGER_MS = 8000;

function pickOtherWaterVariant(current: string): string {
  const others = WATER_SWAP_VARIANT_ASSETS.filter((u) => u !== current);
  if (others.length === 0) return current;
  return others[Math.floor(Math.random() * others.length)]!;
}

function updateRiverWaterAnims(
  map: Map<string, RiverWaterAnim>,
  grid: Tile[][],
  now: number,
  dtMs: number,
) {
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const cell = grid[r]![c]!;
      if (!isSwappableRiverWaterTile(cell) || !cell.asset) continue;
      const key = `${c},${r}`;
      let st = map.get(key);
      if (!st) {
        st = {
          fromUrl: cell.asset,
          toUrl: null,
          fadeT: 0,
          stableUntil:
            now +
            Math.random() * RIVER_WATER_FIRST_SWAP_STAGGER_MS +
            RIVER_WATER_STABLE_MIN_MS * 0.4,
        };
        map.set(key, st);
      }
      if (!st.toUrl) {
        if (now >= st.stableUntil) {
          st.toUrl = pickOtherWaterVariant(st.fromUrl);
          st.fadeT = 0;
        }
      } else {
        st.fadeT += dtMs / RIVER_WATER_FADE_MS;
        if (st.fadeT >= 1) {
          st.fromUrl = st.toUrl;
          st.toUrl = null;
          st.fadeT = 0;
          st.stableUntil =
            now +
            RIVER_WATER_STABLE_MIN_MS +
            Math.random() *
              (RIVER_WATER_STABLE_MAX_MS - RIVER_WATER_STABLE_MIN_MS);
        }
      }
    }
  }
}

function drawWaterLayer(
  ctx: CanvasRenderingContext2D,
  grid: Tile[][],
  cache: Record<string, MapImageSource>,
  riverAnim: Map<string, RiverWaterAnim>,
) {
  const prevAlpha = ctx.globalAlpha;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const cell = grid[r]![c]!;
      if (!WATERISH.has(cell.type) || !cell.asset) continue;
      const x = c * TILE_SIZE;
      const y = r * TILE_SIZE;

      if (isSwappableRiverWaterTile(cell)) {
        const st = riverAnim.get(`${c},${r}`);
        const fromUrl = st?.fromUrl ?? cell.asset;
        const imgFrom = cache[fromUrl];
        if (!isDrawableMapImage(imgFrom)) continue;
        if (!st?.toUrl) {
          ctx.globalAlpha = 1;
          ctx.drawImage(imgFrom, x, y, TILE_SIZE, TILE_SIZE);
        } else {
          const t = Math.min(1, st.fadeT);
          ctx.globalAlpha = 1 - t;
          ctx.drawImage(imgFrom, x, y, TILE_SIZE, TILE_SIZE);
          const imgTo = cache[st.toUrl];
          if (isDrawableMapImage(imgTo)) {
            ctx.globalAlpha = t;
            ctx.drawImage(imgTo, x, y, TILE_SIZE, TILE_SIZE);
          }
          ctx.globalAlpha = 1;
        }
      } else {
        const img = cache[cell.asset];
        if (!isDrawableMapImage(img)) continue;
        ctx.drawImage(img, x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }
  ctx.globalAlpha = prevAlpha;
}

function drawBridgeOverlay(
  ctx: CanvasRenderingContext2D,
  cache: Record<string, HTMLImageElement>,
) {
  const img = cache[ASSETS.bridge];
  if (!isDrawableMapImage(img)) return;
  const bx = BRIDGE_OVERLAY.col * TILE_SIZE;
  const by = BRIDGE_OVERLAY.row * TILE_SIZE;
  ctx.drawImage(
    img,
    0,
    0,
    img.width,
    img.height,
    bx,
    by,
    TILE_SIZE * BRIDGE_OVERLAY.widthTiles,
    TILE_SIZE * BRIDGE_OVERLAY.heightTiles,
  );
}

/** Ground-level apples only — drawn before y-sort so sprites always occlude them. */
function drawAppleGroundPass(
  ctx: CanvasRenderingContext2D,
  grid: Tile[][],
  cache: Record<string, MapImageSource>,
) {
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const tile = grid[row]![col]!;
      if (tile.objectAsset !== ASSETS.apple || !tile.walkable) continue;
      const img = cache[tile.objectAsset];
      if (!isDrawableMapImage(img)) continue;

      const appleSize = APPLE_LAYER_SIZE * (tile.scale ?? 1);
      const tileCenterX = col * TILE_SIZE + TILE_SIZE / 2;
      const tileCenterY = row * TILE_SIZE + TILE_SIZE / 2;
      const ax = tileCenterX + (tile.offsetX ?? 0) - appleSize / 2;
      const ay = tileCenterY + (tile.offsetY ?? 0) - appleSize / 2;
      ctx.drawImage(
        img,
        0,
        0,
        img.width,
        img.height,
        ax,
        ay,
        appleSize,
        appleSize,
      );
    }
  }
}

type RenderItem = { y: number; draw: () => void };

/** Trees, rocks, house, sprites (+ bubble per sprite) — y-sort for depth. */
function drawYSortedWorld(
  ctx: CanvasRenderingContext2D,
  grid: Tile[][],
  cache: Record<string, MapImageSource>,
  sprites: Sprite[],
  doorPhase: DoorPhase,
) {
  const items: RenderItem[] = [];
  const D = SPRITE_DISPLAY_SIZE;

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const cell = grid[r]![c]!;
      if (
        cell.type !== "tree_large" &&
        cell.type !== "tree_small" &&
        cell.type !== "rock"
      ) {
        continue;
      }
      if (!cell.asset) continue;
      const img = cache[cell.asset];
      if (!isDrawableMapImage(img)) continue;

      const base =
        cell.type === "tree_large"
          ? TREE_LARGE_BASE
          : cell.type === "tree_small"
            ? TREE_SMALL_BASE
            : ROCK_BASE;
      const sc = cell.scale ?? 1;
      const displaySize = base * sc;
      const baseX = c * TILE_SIZE + TILE_SIZE / 2 + (cell.offsetX ?? 0);
      const baseY = r * TILE_SIZE + TILE_SIZE / 2 + (cell.offsetY ?? 0);
      const left = baseX - displaySize / 2;
      const top = baseY - displaySize / 2;
      const sortY = r * TILE_SIZE + (cell.collisionOffsetY ?? 0.5) * TILE_SIZE;

      items.push({
        y: sortY,
        draw: () => {
          ctx.drawImage(
            img,
            0,
            0,
            img.width,
            img.height,
            left,
            top,
            displaySize,
            displaySize,
          );
        },
      });
    }
  }

  for (const s of sprites) {
    if (s.insideHouse) continue;
    const path = getSpriteSheetPath(s, s.state);
    const img = cache[path];
    if (!isDrawableMapImage(img)) continue;
    items.push({
      y: s.y,
      draw: () => {
        const { sx, sy } = getSpriteFrameRect(s);
        const dx = s.x - D / 2;
        const dy = s.y - D / 2;
        ctx.drawImage(img, sx, sy, CELL_WIDTH, CELL_HEIGHT, dx, dy, D, D);
      },
    });
    items.push({
      y: s.y + 0.02,
      draw: () => {
        drawMapSpeechBubble(ctx, s);
      },
    });
  }

  const houseKey = housePhaseUsesOpenImage(doorPhase)
    ? ASSETS.house_open
    : ASSETS.house_close;
  const houseImg = cache[houseKey];
  if (isDrawableMapImage(houseImg)) {
    const hx = HOUSE_COL * TILE_SIZE;
    const hy = HOUSE_ROW * TILE_SIZE;
    items.push({
      y: HOUSE_ROW * TILE_SIZE + TILE_SIZE * 1.5,
      draw: () => {
        ctx.drawImage(
          houseImg,
          0,
          0,
          houseImg.width,
          houseImg.height,
          hx,
          hy,
          HOUSE_DRAW_W,
          HOUSE_DRAW_H,
        );
      },
    });
  }

  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
}

/** Rounded rect + triangular tail; size scales with sprite footprint. */
function drawMapSpeechBubble(ctx: CanvasRenderingContext2D, s: Sprite) {
  const text = s.bubble?.text;
  if (text == null) return;

  const displaySize = SPRITE_DISPLAY_SIZE;
  /** Slightly wider than tall; scales with sprite footprint. */
  const bubbleSize = displaySize * 0.54;
  const bw = bubbleSize;
  const bh = bubbleSize * 0.9;
  const tailHeight = bh * 0.35;
  /** Clearance above sprite — lower = bubble sits closer to the character. */
  const by = s.y - displaySize * 0.52 - bh - tailHeight;
  const bx = s.x - bw / 2;

  const tailWidth = bw * 0.25;
  const tailCenter = bx + bw * 0.5;
  const r = Math.max(4, Math.min(bw * 0.1, bh * 0.12, bw / 2 - 1, bh / 2 - 1));

  const right = bx + bw;
  const bottom = by + bh;

  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(right - r, by);
  ctx.arcTo(right, by, right, by + r, r);
  ctx.lineTo(right, bottom - r);
  ctx.arcTo(right, bottom, right - r, bottom, r);
  ctx.lineTo(tailCenter + tailWidth / 2, bottom);
  ctx.lineTo(tailCenter, bottom + tailHeight);
  ctx.lineTo(tailCenter - tailWidth / 2, bottom);
  ctx.lineTo(bx + r, bottom);
  ctx.arcTo(bx, bottom, bx, bottom - r, r);
  ctx.lineTo(bx, by + r);
  ctx.arcTo(bx, by, bx + r, by, r);
  ctx.closePath();

  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(2, Math.min(5, bubbleSize * 0.055));
  ctx.stroke();

  ctx.fillStyle = "#000000";
  ctx.font = `${Math.max(13, Math.floor(bubbleSize * 0.42))}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + bw / 2, by + bh * 0.5);
}

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(
  function MapCanvas({ grid, imageCache }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const riverWaterAnimRef = useRef<Map<string, RiverWaterAnim>>(new Map());

    const drawCache = useMemo(
      () => buildDrawImageCache(imageCache),
      [imageCache],
    );

    useEffect(() => {
      riverWaterAnimRef.current = new Map();
    }, [grid]);

    useImperativeHandle(
      ref,
      () => ({
        draw(sprites: Sprite[], doorPhase: DoorPhase, dtMs: number) {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const now = performance.now();
          updateRiverWaterAnims(riverWaterAnimRef.current, grid, now, dtMs);
          ctx.imageSmoothingEnabled = false;
          drawGrassBase(ctx, grid, drawCache);
          drawWaterLayer(ctx, grid, drawCache, riverWaterAnimRef.current);
          drawBridgeOverlay(ctx, drawCache);
          drawAppleGroundPass(ctx, grid, drawCache);
          drawYSortedWorld(ctx, grid, drawCache, sprites, doorPhase);
        },
      }),
      [grid, drawCache],
    );

    return (
      <canvas
        ref={canvasRef}
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        className="block max-w-none"
        style={{ imageRendering: "pixelated" }}
      />
    );
  },
);

export default MapCanvas;
