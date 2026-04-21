import {
  canSpriteMoveTo,
  findDirectionTowardAdjacentWater,
  isLandAdjacentToWater,
} from "./collision";
import {
  ASSETS,
  HOUSE_COL,
  HOUSE_H,
  HOUSE_ROW,
  HOUSE_W,
  MAP_COLS,
  MAP_HEIGHT,
  MAP_ROWS,
  MAP_WIDTH,
  TILE_SIZE,
  WATER_SWAP_VARIANT_ASSETS,
  type Tile,
} from "./mapData";
import { playBlip, playChirp, playEatingSound } from "../utils/audio";
import type { CustomStateSpec, GeneratedSpriteEntry } from "./generatedSprites";
import { collectGeneratedSpriteUrls } from "./generatedSprites";

export type SpriteDirection = "down" | "left" | "right" | "up";
export type SpriteAnimState =
  | "idle"
  | "walk"
  | "run"
  | "sit"
  | "emote"
  | "custom";

export type Sprite = {
  id: string;
  folder: string;
  x: number;
  y: number;
  direction: SpriteDirection;
  state: SpriteAnimState;
  frame: number;
  frameTimer: number;
  stateTimer: number;
  insideHouse: boolean;
  /** ms remaining while invisible inside house */
  houseTimer?: number;
  /** After exiting house, ignore entrance trigger briefly */
  exitImmuneMs?: number;
  targetX?: number;
  targetY?: number;
  /** ms current walk/run target has been active without finishing (stuck valve). */
  stuckTimer?: number;
  /** Map speech bubble (emoji); life counts down in ms in updateSprites. */
  bubble?: { text: string; life: number };
  /** ms until next ambient bubble is allowed for this sprite */
  ambientCooldown?: number;
  /** Countdown to next ambient proximity / rare walk thought check */
  ambientTimer?: number;
  /** ms before this sprite can start or join a new conversation */
  conversationCooldown?: number;
  conversation?: {
    partnerId: string;
    /** ms remaining; both partners use the same initial durationMs. */
    timer: number;
    /** Original length of this chat (for progress / sanity). */
    durationMs: number;
    exchangeTimer: number;
    myTurn: boolean;
  };
  /** Locked at river/pond edge: speech bubble + no movement for remainingMs. */
  waterEdgeFishing?: {
    remainingMs: number;
    anchorX: number;
    anchorY: number;
    emoji: string;
  };
  /** ms after fishing ends before another water-edge session */
  waterEdgeCooldownMs?: number;
  availableStates?: string[];
  isGenerated?: boolean;
  gender?: "male" | "female";
  themeEmoji?: string;
  customStateName?: string;
  customSpec?: CustomStateSpec;
  /**
   * After a sprite is first added to the live map (`createGeneratedSprite`),
   * ms remaining where it stays idle and facing down; no transitions, house, or ambient specials.
   */
  mapSpawnGraceMs?: number;
};

/** Per-state PNG is 832×256; frames sit in a 64×64 grid (13 cells × 4 direction rows). */
export const SHEET_WIDTH = 832;
export const SHEET_HEIGHT = 256;
export const CELL_WIDTH = 64;
export const CELL_HEIGHT = 64;
export const DIRECTION_COUNT = 4;
export const CELLS_PER_ROW = SHEET_WIDTH / CELL_WIDTH;

export const STATE_FRAMES: Record<SpriteAnimState, number> = {
  idle: 2,
  emote: 3,
  run: 8,
  sit: 2,
  walk: 9,
  custom: 3,
};

/** Fixed states only — custom sheets use dimensions from `customSpec`. */
export type FixedGeneratedAnimState = Exclude<SpriteAnimState, "custom">;

/** Canonical full-sheet size per anim state (normalize Gemini drift to 64×64 cells). */
export const GENERATED_SHEET_DIMENSIONS: Record<
  FixedGeneratedAnimState,
  { w: number; h: number; cols: number; rows: number }
> = {
  idle: { w: 128, h: 256, cols: 2, rows: 4 },
  // Generated walk is code-assembled as 4 frames (4 cols × 4 direction rows).
  walk: { w: 256, h: 256, cols: 4, rows: 4 },
  run: { w: 512, h: 256, cols: 8, rows: 4 },
  sit: { w: 128, h: 192, cols: 2, rows: 3 },
  emote: { w: 192, h: 256, cols: 3, rows: 4 },
};

export const STATE_FPS: Record<SpriteAnimState, number> = {
  idle: 4,
  emote: 12,
  run: 16,
  sit: 4,
  walk: 12,
  custom: 8,
};

const GENERATED_WALK_FPS_MULT = 0.65;
const GENERATED_SPECIAL_FPS_MULT = 0.35;
const SPECIAL_REPEAT_CYCLES = 4;
/** From idle/walk, probability of playing generated `special` before idle/walk (must be >0.5 to beat the single alternate state). */
const GENERATED_SPECIAL_TRANSITION_P = 0.58;

/** Newly added map sprites stay idle + front-facing this long before the normal state machine runs. */
const MAP_SPAWN_IDLE_GRACE_MS = 3000;

const HOUSE_ATTRACT_RADIUS = TILE_SIZE * 1.32;
const HOUSE_ATTRACT_CHANCE = 0.5;
/** Door zone tuning (fixed house position, pixel-space checks). */
const DOOR_CENTER_X = HOUSE_COL * TILE_SIZE + TILE_SIZE * 1.5;
const DOOR_CENTER_Y = HOUSE_ROW * TILE_SIZE + TILE_SIZE * 1.8;
const DOOR_TRIGGER_RADIUS_X = TILE_SIZE * 0.52;
const DOOR_TRIGGER_RADIUS_Y = TILE_SIZE * 0.44;
const DOOR_EXIT_RADIUS = TILE_SIZE * 1.58;
/** Keep sprite centers one full tile away from map edges/corners. */
const SPRITE_SAFE_MARGIN = TILE_SIZE * 1.5;

const EMOJI_POOLS = {
  pond: ["🎣", "🐟", "🌊", "🪷", "🌿", "😌", "🐸"],
  sit: ["😌", "☀️", "🌸", "💭", "😴", "🧘", "🍃"],
  emote: ["💪", "⚡", "🎉", "🙌", "✨", "🥳", "😄"],
  run: ["💨", "🏃", "⚡", "😤"],
  house_exit: ["😴", "🏠", "☕", "🌅", "😪", "🥱", "🛌"],
  greeting: ["👋", "😄", "🙂", "✌️", "🤝", "😊", "👍"],
  response: ["😄", "😂", "🤣", "😮", "❗", "😁", "❓"],
  walking: ["💭", "🎵", "✨", "🌟", "😶", "🤔", "🎶"],
  convo_start: ["👋", "😄", "🙂", "✌️", "😊", "🤝", "😃"],
  convo_reply: ["😄", "😂", "🤣", "😮", "😲", "😁", "🥹", "😆"],
  convo_mid: ["💬", "🤔", "😮", "😲", "🫢", "😯", "🤩", "😅"],
  convo_react: ["😂", "❗", "💯", "✨", "👏", "😭", "❓", "😍"],
  convo_end: ["👋", "😊", "🤝", "✌️", "💛", "😄", "🫡"],
} as const;

const BUBBLE_LIFE_MS = 4000;

const WATER_EDGE_FISHING_MIN_MS = 60_000;
const WATER_EDGE_FISHING_MAX_MS = 120_000;
const WATER_EDGE_FISHING_EMOJIS = EMOJI_POOLS.pond;
const WATER_EDGE_COOLDOWN_MS = 45_000;
/** Per ambient tick when at edge; most visits do not trigger fishing. */
const WATER_EDGE_START_CHANCE = 0.1;

function triggerBubble(
  s: Sprite,
  pool: readonly string[],
  probability: number,
): void {
  if (s.bubble) return;
  if (Math.random() >= probability) return;
  s.bubble = {
    text: pool[Math.floor(Math.random() * pool.length)]!,
    life: BUBBLE_LIFE_MS,
  };
  // When speech bubbles appear, play a small chirp/blip.
  if (Math.random() < 0.3) playChirp();
  if (Math.random() < 0.2) playBlip(0.6);
}

function updateBubble(s: Sprite, dt: number): void {
  if (s.waterEdgeFishing && s.bubble) {
    s.bubble.text = s.waterEdgeFishing.emoji;
    s.bubble.life = s.waterEdgeFishing.remainingMs + 500;
    return;
  }
  // Generated "special" animation: always show theme emoji for the full state duration.
  if (
    s.state === "custom" &&
    s.isGenerated &&
    s.customStateName === "special" &&
    s.themeEmoji
  ) {
    s.bubble = {
      text: s.themeEmoji,
      life: (s.stateTimer ?? 0) + 500,
    };
    return;
  }
  if (s.bubble) {
    s.bubble.life -= dt;
    if (s.bubble.life <= 0) {
      s.bubble = undefined;
    }
  }
}

function maybeStartWaterEdgeFishing(s: Sprite, grid: Tile[][]): void {
  if (s.waterEdgeFishing) return;
  if ((s.waterEdgeCooldownMs ?? 0) > 0) return;
  if (s.conversation) return;
  if (s.insideHouse) return;
  if (s.state !== "idle" && s.state !== "walk" && s.state !== "run") {
    return;
  }
  if (!isLandAdjacentToWater(grid, s.x, s.y)) return;
  if (Math.random() >= WATER_EDGE_START_CHANCE) return;

  const face = findDirectionTowardAdjacentWater(grid, s.x, s.y);
  if (!face) return;

  const duration =
    WATER_EDGE_FISHING_MIN_MS +
    Math.random() * (WATER_EDGE_FISHING_MAX_MS - WATER_EDGE_FISHING_MIN_MS);

  const fishingEmoji =
    WATER_EDGE_FISHING_EMOJIS[
      Math.floor(Math.random() * WATER_EDGE_FISHING_EMOJIS.length)
    ]!;

  s.waterEdgeFishing = {
    remainingMs: duration,
    anchorX: s.x,
    anchorY: s.y,
    emoji: fishingEmoji,
  };
  s.direction = face;
  s.state = "idle";
  s.frame = 0;
  s.frameTimer = 0;
  s.stateTimer = duration;
  s.targetX = undefined;
  s.targetY = undefined;
  s.stuckTimer = 0;
  s.bubble = {
    text: fishingEmoji,
    life: duration + 500,
  };
  s.ambientCooldown = duration + 2000;
}

function runAmbientProximityChecks(
  s: Sprite,
  grid: Tile[][],
  allSprites: Sprite[],
): void {
  if (!s.bubble) {
    const tooClose = isSpriteTooClose(s, allSprites);
    if (tooClose && s.id < tooClose.id) {
      triggerBubble(s, EMOJI_POOLS.greeting, 0.4);
      triggerBubble(tooClose, EMOJI_POOLS.response, 0.3);
      if (s.bubble) s.ambientCooldown = 12000 + Math.random() * 6000;
      if (tooClose.bubble)
        tooClose.ambientCooldown = 12000 + Math.random() * 6000;
    }
  }

  if (!s.bubble && s.state === "walk") {
    triggerBubble(s, EMOJI_POOLS.walking, 0.08);
    if (s.bubble) {
      s.ambientCooldown = 15000 + Math.random() * 10000;
    }
  }
}

/**
 * Sheet row order: 0=up, 1=left, 2=down, 3=right (multiply by CELL_HEIGHT for sy).
 */
const DIRECTION_MAP: Record<SpriteDirection, number> = {
  up: 0,
  left: 1,
  down: 2,
  right: 3,
};

function getSitRow(direction: SpriteDirection): number {
  if (direction === "right") return 1;
  return DIRECTION_MAP[direction];
}

function getCustomDirectionRow(
  direction: SpriteDirection,
  spec: CustomStateSpec,
): number {
  const rows = spec.directionRows;
  if (rows === 1) return 0;
  if (rows === 2) {
    return direction === "up" ? 0 : 1;
  }
  return DIRECTION_MAP[direction];
}

function shuffleDirections(): SpriteDirection[] {
  const d: SpriteDirection[] = ["up", "down", "left", "right"];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = d[i]!;
    d[i] = d[j]!;
    d[j] = t;
  }
  return d;
}

function patrolPositionOk(grid: Tile[][], x: number, y: number): boolean {
  return canSpriteMoveTo(grid, x, y);
}

function isInDoorZone(s: Sprite): boolean {
  const dx = Math.abs(s.x - DOOR_CENTER_X);
  const dy = Math.abs(s.y - DOOR_CENTER_Y);
  return dx < DOOR_TRIGGER_RADIUS_X && dy < DOOR_TRIGGER_RADIUS_Y;
}

function isOutsideExitZone(s: Sprite): boolean {
  const dist = Math.hypot(s.x - DOOR_CENTER_X, s.y - DOOR_CENTER_Y);
  return dist > DOOR_EXIT_RADIUS;
}

function clampSpriteAxis(v: number, max: number): number {
  return Math.max(SPRITE_SAFE_MARGIN, Math.min(v, max - SPRITE_SAFE_MARGIN));
}

function shouldWalkToHouse(s: Sprite): boolean {
  if (s.waterEdgeFishing) return false;
  if (s.conversation) return false;
  if (s.insideHouse) return false;
  if (s.exitImmuneMs != null && s.exitImmuneMs > 0) return false;
  const dist = Math.hypot(s.x - DOOR_CENTER_X, s.y - DOOR_CENTER_Y);
  if (dist > HOUSE_ATTRACT_RADIUS) return false;
  if (dist < DOOR_EXIT_RADIUS) return false;
  return Math.random() < HOUSE_ATTRACT_CHANCE;
}

function isPathWalkable(
  grid: Tile[][],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  direction: SpriteDirection,
): boolean {
  if (toX < 0 || toY < 0 || toX >= MAP_WIDTH || toY >= MAP_HEIGHT) {
    return false;
  }

  const startCol = Math.floor(fromX / TILE_SIZE);
  const startRow = Math.floor(fromY / TILE_SIZE);
  const destCol = Math.floor(toX / TILE_SIZE);
  const destRow = Math.floor(toY / TILE_SIZE);

  if (
    destCol < 0 ||
    destCol >= MAP_COLS ||
    destRow < 0 ||
    destRow >= MAP_ROWS
  ) {
    return false;
  }

  const dr = destRow - startRow;
  const dc = destCol - startCol;
  if (dr !== 0 && dc !== 0) return false;
  if (dr === 0 && dc === 0) return false;

  if (direction === "up" && (dr >= 0 || dc !== 0)) return false;
  if (direction === "down" && (dr <= 0 || dc !== 0)) return false;
  if (direction === "left" && (dc >= 0 || dr !== 0)) return false;
  if (direction === "right" && (dc <= 0 || dr !== 0)) return false;

  if (!patrolPositionOk(grid, toX, toY)) return false;

  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  if (!patrolPositionOk(grid, midX, midY)) return false;

  return true;
}

/** Desired minimum distance between sprite centers. */
const SPRITE_PERSONAL_SPACE = TILE_SIZE * 0.44;
/** How strongly sprites push apart (0–1; keep low). */
const SEPARATION_STRENGTH = 0.15;

function isSpriteTooClose(s: Sprite, allSprites: Sprite[]): Sprite | null {
  for (const other of allSprites) {
    if (other.id === s.id) continue;
    if (other.insideHouse || s.insideHouse) continue;
    const dist = Math.hypot(s.x - other.x, s.y - other.y);
    if (dist < SPRITE_PERSONAL_SPACE * 0.8) {
      return other;
    }
  }
  return null;
}

function applySeparation(
  s: Sprite,
  allSprites: Sprite[],
  grid: Tile[][],
): void {
  let pushX = 0;
  let pushY = 0;

  for (const other of allSprites) {
    if (other.id === s.id) continue;
    if (other.insideHouse || s.insideHouse) continue;

    if (
      s.conversation?.partnerId === other.id ||
      other.conversation?.partnerId === s.id
    ) {
      continue;
    }

    const dx = s.x - other.x;
    const dy = s.y - other.y;
    const dist = Math.hypot(dx, dy);

    if (dist === 0) {
      // Deterministic split direction when two sprites overlap exactly.
      const seed = `${s.id}|${other.id}`;
      let h = 0;
      for (let i = 0; i < seed.length; i++) {
        h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      }
      const angle = (h % 360) * (Math.PI / 180);
      pushX += Math.cos(angle) * SPRITE_PERSONAL_SPACE * SEPARATION_STRENGTH;
      pushY += Math.sin(angle) * SPRITE_PERSONAL_SPACE * SEPARATION_STRENGTH;
      continue;
    }

    if (dist < SPRITE_PERSONAL_SPACE && dist > 0) {
      const overlap = SPRITE_PERSONAL_SPACE - dist;
      const nx = dx / dist;
      const ny = dy / dist;
      pushX += nx * overlap * SEPARATION_STRENGTH;
      pushY += ny * overlap * SEPARATION_STRENGTH;
    }
  }

  if (pushX === 0 && pushY === 0) return;

  const newX = s.x + pushX;
  const newY = s.y + pushY;

  if (
    canSpriteMoveTo(grid, newX, s.y) &&
    newX > SPRITE_SAFE_MARGIN &&
    newX < MAP_WIDTH - SPRITE_SAFE_MARGIN
  ) {
    s.x = newX;
  }

  if (
    canSpriteMoveTo(grid, s.x, newY) &&
    newY > SPRITE_SAFE_MARGIN &&
    newY < MAP_HEIGHT - SPRITE_SAFE_MARGIN
  ) {
    s.y = newY;
  }
}

function faceEachOther(a: Sprite, b: Sprite): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    a.direction = dx > 0 ? "right" : "left";
    b.direction = dx > 0 ? "left" : "right";
  } else {
    a.direction = dy > 0 ? "down" : "up";
    b.direction = dy > 0 ? "up" : "down";
  }
}

function applyConversationExitCleanup(s: Sprite, farewellChance: number): void {
  s.state = "idle";
  s.frame = 0;
  s.frameTimer = 0;
  s.stateTimer = 1000 + Math.random() * 2000;
  s.targetX = undefined;
  s.targetY = undefined;
  triggerBubble(s, EMOJI_POOLS.convo_end, farewellChance);
  s.ambientCooldown = 8000 + Math.random() * 4000;
  s.conversationCooldown = 15000 + Math.random() * 10000;
}

/** Normal time-up: clear both sides in one frame so neither stays stuck in convo logic. */
function endConversationBoth(
  a: Sprite,
  b: Sprite,
  grid: Tile[][],
  allSprites: Sprite[],
): void {
  a.conversation = undefined;
  b.conversation = undefined;
  applyConversationExitCleanup(a, 0.7);
  applyConversationExitCleanup(b, 0.7);
  startWalkApart(a, b, grid, allSprites);
}

/** Asymmetric end (broken link, partner gone, etc.); clears partner’s convo if still paired. */
function endConversation(
  s: Sprite,
  allSprites: Sprite[],
  grid: Tile[][],
): void {
  const pid = s.conversation?.partnerId;
  s.conversation = undefined;

  if (pid) {
    const p = allSprites.find((o) => o.id === pid);
    if (p && !p.insideHouse && p.conversation?.partnerId === s.id) {
      p.conversation = undefined;
      applyConversationExitCleanup(p, 0.7);
      applyConversationExitCleanup(s, 0.7);
      startWalkApart(s, p, grid, allSprites);
      return;
    }
  }

  applyConversationExitCleanup(s, 0.7);
}

function updateConversation(
  s: Sprite,
  allSprites: Sprite[],
  dt: number,
  grid: Tile[][],
): boolean {
  if (!s.conversation) return false;

  const convo = s.conversation;
  const partner = allSprites.find((o) => o.id === convo.partnerId);

  if (
    !partner ||
    partner.insideHouse ||
    !partner.conversation ||
    partner.conversation.partnerId !== s.id
  ) {
    endConversation(s, allSprites, grid);
    return true;
  }

  /** One decrement per pair per frame (avoids desync from duplicate objects). */
  if (s.id < partner.id) {
    const synced = Math.min(convo.timer, partner.conversation.timer);
    const next = synced - dt;
    convo.timer = next;
    partner.conversation.timer = next;
  }

  if (convo.timer <= 0) {
    endConversationBoth(s, partner, grid, allSprites);
    return true;
  }

  faceEachOther(s, partner);

  convo.exchangeTimer -= dt;
  if (convo.exchangeTimer <= 0) {
    if (convo.myTurn) {
      const denom = Math.max(convo.durationMs, 1);
      const progress = Math.min(1, Math.max(0, 1 - convo.timer / denom));
      let pool: readonly string[];
      if (progress < 0.15) {
        pool = EMOJI_POOLS.convo_start;
      } else if (progress > 0.85) {
        pool = EMOJI_POOLS.convo_end;
      } else if (Math.random() < 0.5) {
        pool = EMOJI_POOLS.convo_mid;
      } else {
        pool = EMOJI_POOLS.convo_react;
      }
      triggerBubble(s, pool, 1.0);
    }

    convo.exchangeTimer = 2000 + Math.random() * 3000;
    convo.myTurn = !convo.myTurn;
  }

  s.state = "idle";
  s.targetX = undefined;
  s.targetY = undefined;

  return true;
}

function tryStartConversation(s: Sprite, allSprites: Sprite[]): boolean {
  if (s.conversation) return false;
  if (s.waterEdgeFishing) return false;
  if (s.insideHouse) return false;
  if (s.state !== "idle" && s.state !== "walk") return false;
  if (s.exitImmuneMs != null && s.exitImmuneMs > 0) return false;

  for (const other of allSprites) {
    if (other.id === s.id) continue;
    if (other.insideHouse) continue;
    if (other.waterEdgeFishing) continue;
    if (other.conversation) continue;
    if (other.state !== "idle" && other.state !== "walk") continue;
    if (other.exitImmuneMs != null && other.exitImmuneMs > 0) continue;

    const dist = Math.hypot(s.x - other.x, s.y - other.y);
    if (dist >= TILE_SIZE * 1.06) continue;
    if (Math.random() > 0.35) continue;

    const duration = 30000 + Math.random() * 15000;

    s.conversation = {
      partnerId: other.id,
      timer: duration,
      durationMs: duration,
      exchangeTimer: 800 + Math.random() * 1200,
      myTurn: true,
    };
    other.conversation = {
      partnerId: s.id,
      timer: duration,
      durationMs: duration,
      exchangeTimer: 1600 + Math.random() * 1200,
      myTurn: false,
    };

    s.state = "idle";
    s.frame = 0;
    s.frameTimer = 0;
    s.targetX = undefined;
    s.targetY = undefined;
    s.stateTimer = duration + 1000;

    other.state = "idle";
    other.frame = 0;
    other.frameTimer = 0;
    other.targetX = undefined;
    other.targetY = undefined;
    other.stateTimer = duration + 1000;

    faceEachOther(s, other);
    return true;
  }
  return false;
}

function handleObstruction(sprite: Sprite): void {
  sprite.targetX = undefined;
  sprite.targetY = undefined;
  sprite.stuckTimer = 0;

  if (sprite.state === "walk" || sprite.state === "run") {
    sprite.stateTimer = Math.max(sprite.stateTimer, 500);
  }
}

function onReachedTarget(s: Sprite): void {
  s.targetX = undefined;
  s.targetY = undefined;
  s.stuckTimer = 0;
}

function isInsideHouseFootprint(col: number, row: number): boolean {
  return (
    col >= HOUSE_COL &&
    col < HOUSE_COL + HOUSE_W &&
    row >= HOUSE_ROW &&
    row < HOUSE_ROW + HOUSE_H
  );
}

function collectAppleSpawnCandidates(
  grid: Tile[][],
  eatenCol: number,
  eatenRow: number,
  minChebyshevFromEaten: number,
): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (
        minChebyshevFromEaten > 0 &&
        Math.max(Math.abs(c - eatenCol), Math.abs(r - eatenRow)) <
          minChebyshevFromEaten
      ) {
        continue;
      }

      const tile = grid[r]![c]!;
      if (!tile.walkable) continue;
      if (tile.type !== "grass") continue;
      if (tile.objectAsset) continue;
      if (tile.trigger) continue;
      if (isInsideHouseFootprint(c, r)) continue;

      const above = r > 0 ? grid[r - 1]![c]! : undefined;
      const below = r < MAP_ROWS - 1 ? grid[r + 1]![c]! : undefined;
      const left = c > 0 ? grid[r]![c - 1]! : undefined;
      const right = c < MAP_COLS - 1 ? grid[r]![c + 1]! : undefined;

      if (
        (above && !above.walkable) ||
        (below && !below.walkable) ||
        (left && !left.walkable) ||
        (right && !right.walkable)
      ) {
        continue;
      }

      out.push({ row: r, col: c });
    }
  }

  return out;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
}

function respawnApple(
  grid: Tile[][],
  eatenCol: number,
  eatenRow: number,
): void {
  /** Force respawn far away so pickups never look like "same spot" glitches. */
  const tiers = [8, 6, 4, 2] as const;

  let eligible: { row: number; col: number }[] = [];
  for (const minD of tiers) {
    eligible = collectAppleSpawnCandidates(grid, eatenCol, eatenRow, minD);
    if (eligible.length > 0) break;
  }

  if (eligible.length === 0) {
    // Last resort: anywhere valid except the eaten tile.
    eligible = collectAppleSpawnCandidates(grid, eatenCol, eatenRow, 1);
  }
  if (eligible.length === 0) return;

  // Bias toward farthest candidates so respawn is clearly at a different location.
  eligible.sort((a, b) => {
    const da = Math.max(Math.abs(a.col - eatenCol), Math.abs(a.row - eatenRow));
    const db = Math.max(Math.abs(b.col - eatenCol), Math.abs(b.row - eatenRow));
    return db - da;
  });
  const top = eligible.slice(0, Math.max(1, Math.ceil(eligible.length * 0.25)));
  shuffleInPlace(top);
  const pick = top[0]!;
  const cell = grid[pick.row]![pick.col]!;
  cell.objectAsset = ASSETS.apple;
  const range = TILE_SIZE * 0.3;
  cell.offsetX = (Math.random() - 0.5) * range;
  cell.offsetY = (Math.random() - 0.5) * range;
}

/** Sprite center must be this close to the apple draw position to collect it. */
const APPLE_PICKUP_RADIUS = TILE_SIZE * 0.48;
/** Brief pause after pickup before selecting a new behavior. */
const APPLE_PICKUP_IDLE_MS = 900;

function onApplePickup(s: Sprite): void {
  // Always show apple reaction, overriding any existing bubble text/life.
  playEatingSound();
  s.bubble = { text: "🍎", life: BUBBLE_LIFE_MS };
  // Stop movement immediately and idle briefly.
  s.state = "idle";
  s.frame = 0;
  s.frameTimer = 0;
  s.stateTimer = Math.max(s.stateTimer, APPLE_PICKUP_IDLE_MS);
  s.targetX = undefined;
  s.targetY = undefined;
  s.stuckTimer = 0;
}

function checkApplePickup(s: Sprite, grid: Tile[][]): void {
  const col = Math.floor(s.x / TILE_SIZE);
  const row = Math.floor(s.y / TILE_SIZE);

  const candidates = [
    { c: col, r: row },
    { c: col - 1, r: row },
    { c: col + 1, r: row },
    { c: col, r: row - 1 },
    { c: col, r: row + 1 },
  ];

  for (const { c, r } of candidates) {
    if (c < 0 || c >= MAP_COLS) continue;
    if (r < 0 || r >= MAP_ROWS) continue;
    const tile = grid[r]![c]!;
    if (
      !tile.objectAsset ||
      (!tile.objectAsset.includes("apple") && tile.objectAsset !== ASSETS.apple)
    ) {
      continue;
    }

    const ax = c * TILE_SIZE + TILE_SIZE / 2 + (tile.offsetX ?? 0);
    const ay = r * TILE_SIZE + TILE_SIZE / 2 + (tile.offsetY ?? 0);
    const dist = Math.hypot(s.x - ax, s.y - ay);

    if (dist <= APPLE_PICKUP_RADIUS) {
      tile.objectAsset = undefined;
      tile.offsetX = undefined;
      tile.offsetY = undefined;
      onApplePickup(s);
      respawnApple(grid, c, r);
      return;
    }
  }
}

function moveSprite(s: Sprite, deltaMs: number, grid: Tile[][]): void {
  if (s.targetX === undefined || s.targetY === undefined) return;

  const speed = s.state === "run" ? TILE_SIZE * 0.8 : TILE_SIZE * 0.4;
  const delta = speed * (deltaMs / 1000);

  if (s.direction === "left" || s.direction === "right") {
    const dx = s.targetX - s.x;
    if (Math.abs(dx) <= delta) {
      if (!canSpriteMoveTo(grid, s.targetX, s.targetY)) {
        handleObstruction(s);
        return;
      }
      s.x = s.targetX;
      s.y = s.targetY;
      onReachedTarget(s);
      checkApplePickup(s, grid);
    } else {
      const px = s.x + (s.direction === "right" ? delta : -delta);
      const py = s.y;
      if (!canSpriteMoveTo(grid, px, py)) {
        handleObstruction(s);
        return;
      }
      s.x = px;
      checkApplePickup(s, grid);
    }
  } else {
    const dy = s.targetY - s.y;
    if (Math.abs(dy) <= delta) {
      if (!canSpriteMoveTo(grid, s.targetX, s.targetY)) {
        handleObstruction(s);
        return;
      }
      s.y = s.targetY;
      s.x = s.targetX;
      onReachedTarget(s);
      checkApplePickup(s, grid);
    } else {
      const py = s.y + (s.direction === "down" ? delta : -delta);
      const px = s.x;
      if (!canSpriteMoveTo(grid, px, py)) {
        handleObstruction(s);
        return;
      }
      s.y = py;
      checkApplePickup(s, grid);
    }
  }
}

function assignWalkOrRunTarget(
  s: Sprite,
  grid: Tile[][],
  allSprites: Sprite[],
): void {
  const shuffled = shuffleDirections();
  const tileRange = 1 + Math.floor(Math.random() * 2);
  for (const dir of shuffled) {
    let fromX = s.x;
    let fromY = s.y;
    if (dir === "up" || dir === "down") {
      const col = Math.round((s.x - TILE_SIZE / 2) / TILE_SIZE);
      const c = Math.max(0, Math.min(col, MAP_COLS - 1));
      fromX = c * TILE_SIZE + TILE_SIZE / 2;
    } else {
      const row = Math.round((s.y - TILE_SIZE / 2) / TILE_SIZE);
      const r = Math.max(0, Math.min(row, MAP_ROWS - 1));
      fromY = r * TILE_SIZE + TILE_SIZE / 2;
    }

    let newX = fromX;
    let newY = fromY;
    if (dir === "up") newY = fromY - tileRange * TILE_SIZE;
    if (dir === "down") newY = fromY + tileRange * TILE_SIZE;
    if (dir === "left") newX = fromX - tileRange * TILE_SIZE;
    if (dir === "right") newX = fromX + tileRange * TILE_SIZE;

    newX = clampSpriteAxis(newX, MAP_WIDTH);
    newY = clampSpriteAxis(newY, MAP_HEIGHT);

    const targetInDoorZone =
      Math.abs(newX - DOOR_CENTER_X) < DOOR_TRIGGER_RADIUS_X &&
      Math.abs(newY - DOOR_CENTER_Y) < DOOR_TRIGGER_RADIUS_Y;
    if (targetInDoorZone) continue;

    if (isPathWalkable(grid, fromX, fromY, newX, newY, dir)) {
      const targetTooClose = allSprites.some((other) => {
        if (other.id === s.id) return false;
        if (other.insideHouse) return false;
        return (
          Math.hypot(newX - other.x, newY - other.y) < SPRITE_PERSONAL_SPACE
        );
      });
      if (targetTooClose) continue;

      s.targetX = newX;
      s.targetY = newY;
      s.direction = dir;
      s.frame = 0;
      s.frameTimer = 0;
      s.stuckTimer = 0;
      return;
    }
  }

  s.targetX = undefined;
  s.targetY = undefined;
  s.state = "idle";
  s.frame = 0;
  s.frameTimer = 0;
  s.stuckTimer = 0;
  s.stateTimer = 1000 + Math.random() * 2000;
}

/** One tile in `dir` if path + terrain OK; skips personal-space check for `ignorePersonalSpaceIds`. */
function tryAssignOneTileWalk(
  s: Sprite,
  dir: SpriteDirection,
  grid: Tile[][],
  allSprites: Sprite[],
  ignorePersonalSpaceIds: Set<string>,
): boolean {
  let fromX = s.x;
  let fromY = s.y;
  if (dir === "up" || dir === "down") {
    const col = Math.round((s.x - TILE_SIZE / 2) / TILE_SIZE);
    const c = Math.max(0, Math.min(col, MAP_COLS - 1));
    fromX = c * TILE_SIZE + TILE_SIZE / 2;
  } else {
    const row = Math.round((s.y - TILE_SIZE / 2) / TILE_SIZE);
    const r = Math.max(0, Math.min(row, MAP_ROWS - 1));
    fromY = r * TILE_SIZE + TILE_SIZE / 2;
  }

  let newX = fromX;
  let newY = fromY;
  if (dir === "up") newY = fromY - TILE_SIZE;
  if (dir === "down") newY = fromY + TILE_SIZE;
  if (dir === "left") newX = fromX - TILE_SIZE;
  if (dir === "right") newX = fromX + TILE_SIZE;

  newX = clampSpriteAxis(newX, MAP_WIDTH);
  newY = clampSpriteAxis(newY, MAP_HEIGHT);

  const targetInDoorZone =
    Math.abs(newX - DOOR_CENTER_X) < DOOR_TRIGGER_RADIUS_X &&
    Math.abs(newY - DOOR_CENTER_Y) < DOOR_TRIGGER_RADIUS_Y;
  if (targetInDoorZone) return false;

  if (!isPathWalkable(grid, fromX, fromY, newX, newY, dir)) return false;

  const targetTooClose = allSprites.some((other) => {
    if (other.id === s.id) return false;
    if (ignorePersonalSpaceIds.has(other.id)) return false;
    if (other.insideHouse) return false;
    return Math.hypot(newX - other.x, newY - other.y) < SPRITE_PERSONAL_SPACE;
  });
  if (targetTooClose) return false;

  s.state = "walk";
  s.targetX = newX;
  s.targetY = newY;
  s.direction = dir;
  s.frame = 0;
  s.frameTimer = 0;
  s.stuckTimer = 0;
  s.stateTimer = 6000 + Math.random() * 5000;
  return true;
}

/** After a chat, walk one tile each along opposite directions (away from each other). */
function startWalkApart(
  a: Sprite,
  b: Sprite,
  grid: Tile[][],
  allSprites: Sprite[],
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ignore = new Set<string>([a.id, b.id]);

  let dirA: SpriteDirection;
  let dirB: SpriteDirection;
  if (Math.abs(dx) >= Math.abs(dy)) {
    dirA = dx > 0 ? "left" : "right";
    dirB = dx > 0 ? "right" : "left";
  } else {
    dirA = dy > 0 ? "up" : "down";
    dirB = dy > 0 ? "down" : "up";
  }

  tryAssignOneTileWalk(a, dirA, grid, allSprites, ignore);
  tryAssignOneTileWalk(b, dirB, grid, allSprites, ignore);
}

const SPRITE_FOLDERS = [
  "/assets/sprites/male1",
  "/assets/sprites/male2",
  "/assets/sprites/male3",
  "/assets/sprites/male4",
  "/assets/sprites/female1",
  "/assets/sprites/female2",
  "/assets/sprites/female3",
  "/assets/sprites/female4",
] as const;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const NEXT_FROM: Record<SpriteAnimState, SpriteAnimState[]> = {
  idle: ["walk", "run", "sit", "emote"],
  walk: ["idle", "run", "sit"],
  run: ["walk", "idle"],
  sit: ["idle", "walk"],
  emote: ["idle", "walk"],
  custom: ["idle", "walk"],
};

const WEIGHTS: Partial<Record<SpriteAnimState, number>> = {
  walk: 0.4,
  idle: 0.28,
  run: 0.15,
  emote: 0.1,
  sit: 0.07,
};

function weightedNextState(
  from: SpriteAnimState,
  sprite: Sprite,
): SpriteAnimState {
  const hasGeneratedCustom = Boolean(
    sprite.isGenerated && sprite.customSpec && sprite.customStateName,
  );
  if (hasGeneratedCustom && (from === "idle" || from === "walk")) {
    const pToCustom =
      sprite.customStateName === "special"
        ? GENERATED_SPECIAL_TRANSITION_P
        : 0.35;
    if (Math.random() < pToCustom) {
      return "custom";
    }
  }
  let allowed = NEXT_FROM[from];
  if (sprite.isGenerated && sprite.availableStates) {
    // Generated sprites only have sheets for their manifest-listed states (idle/walk/custom).
    allowed = allowed.filter((s) => sprite.availableStates!.includes(s));
    if (allowed.length === 0) allowed = NEXT_FROM[from];
  }
  let total = 0;
  const pairs: { s: SpriteAnimState; w: number }[] = [];
  for (const s of allowed) {
    const w = WEIGHTS[s] ?? 0.1;
    pairs.push({ s, w });
    total += w;
  }
  let r = Math.random() * total;
  for (const { s, w } of pairs) {
    r -= w;
    if (r <= 0) return s;
  }
  return allowed[0]!;
}

function stateDuration(state: SpriteAnimState, sprite?: Sprite): number {
  switch (state) {
    case "idle":
      return randomInt(2000, 5000);
    case "walk":
      return randomInt(3000, 8000);
    case "run":
      return randomInt(1000, 3000);
    case "sit":
      return 4000 + Math.random() * 6000;
    case "emote":
      return randomInt(3000, 6000);
    case "custom": {
      const baseFps = sprite?.customSpec?.fps ?? 8;
      const frames = sprite?.customSpec?.frameCount ?? 3;
      const isGeneratedSpecial =
        sprite?.isGenerated && sprite.customStateName === "special";
      const fps = isGeneratedSpecial
        ? baseFps * GENERATED_SPECIAL_FPS_MULT
        : baseFps;
      const oneCycle = (frames / fps) * 1000;

      // "special" is expected to play exactly 3 times.
      if (isGeneratedSpecial) return oneCycle * SPECIAL_REPEAT_CYCLES;

      // Other custom animations use a small random cycle range.
      return oneCycle * (2 + Math.random() * 2);
    }
    default:
      return 2000;
  }
}

export function initSprites(
  grid: Tile[][],
  spawn: { x: number; y: number },
  generatedEntries?: GeneratedSpriteEntry[],
): Sprite[] {
  const walkableTiles: { x: number; y: number }[] = [];
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const tile = grid[row]![col]!;
      if (!tile.walkable) continue;
      if (tile.trigger) continue;
      if (col === 0 || col === MAP_COLS - 1) continue;
      if (row === 0 || row === MAP_ROWS - 1) continue;
      const cx = col * TILE_SIZE + TILE_SIZE / 2;
      const cy = row * TILE_SIZE + TILE_SIZE / 2;
      if (!canSpriteMoveTo(grid, cx, cy)) continue;
      walkableTiles.push({ x: cx, y: cy });
    }
  }

  for (let i = walkableTiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = walkableTiles[i]!;
    walkableTiles[i] = walkableTiles[j]!;
    walkableTiles[j] = t;
  }

  const chosen: { x: number; y: number }[] = [];
  const used = new Set<number>();
  const minSpacing = TILE_SIZE * 0.7;

  const defaultSprites = SPRITE_FOLDERS.map((folder, index) => {
    const id = folder.split("/").pop()!;
    let pos = {
      x: clampSpriteAxis(spawn.x, MAP_WIDTH),
      y: clampSpriteAxis(spawn.y, MAP_HEIGHT),
    };

    if (walkableTiles.length > 0) {
      let bestIdx = index % walkableTiles.length;
      let found = false;
      for (let o = 0; o < walkableTiles.length; o++) {
        const idx = (index + o) % walkableTiles.length;
        if (used.has(idx)) continue;
        const candidate = walkableTiles[idx]!;
        const tooClose = chosen.some(
          (p) => Math.hypot(candidate.x - p.x, candidate.y - p.y) < minSpacing,
        );
        if (tooClose) continue;
        bestIdx = idx;
        found = true;
        break;
      }
      if (!found && walkableTiles.length > 0) {
        // Fall back to any still-unused tile, then any tile if needed.
        for (let o = 0; o < walkableTiles.length; o++) {
          const idx = (index + o) % walkableTiles.length;
          if (!used.has(idx)) {
            bestIdx = idx;
            found = true;
            break;
          }
        }
        if (!found) bestIdx = index % walkableTiles.length;
      }
      used.add(bestIdx);
      const pick = walkableTiles[bestIdx]!;
      pos = {
        x: clampSpriteAxis(pick.x, MAP_WIDTH),
        y: clampSpriteAxis(pick.y, MAP_HEIGHT),
      };
    }
    chosen.push(pos);

    return {
      id,
      folder,
      x: pos.x,
      y: pos.y,
      direction: "down" as SpriteDirection,
      state: "idle" as SpriteAnimState,
      frame: 0,
      frameTimer: 0,
      stateTimer: 500 + Math.random() * 4000,
      insideHouse: false,
      targetX: undefined,
      targetY: undefined,
    };
  });

  const generatedSprites = (generatedEntries ?? []).map((entry) => {
    const pos = pickRandomWalkableTile(grid, chosen) ?? {
      x: spawn.x,
      y: spawn.y,
    };
    chosen.push(pos);
    return {
      id: `generated_${entry.id}`,
      folder: `/generated-sprites/${entry.id}`,
      x: pos.x,
      y: pos.y,
      direction: "down" as SpriteDirection,
      state: "walk" as SpriteAnimState,
      frame: 0,
      frameTimer: 0,
      stateTimer: 3000 + Math.random() * 2000,
      insideHouse: false,
      targetX: undefined,
      targetY: undefined,
      availableStates: entry.states,
      isGenerated: true,
      gender: entry.gender,
      themeEmoji: entry.themeEmoji,
      customStateName: entry.customStateName,
      customSpec: entry.customSpec,
    };
  });

  return [...defaultSprites, ...generatedSprites];
}

/**
 * Picks a random valid walkable tile for a new sprite,
 * avoiding edges, corners, and proximity to existing sprites.
 */
export function pickRandomWalkableTile(
  grid: Tile[][],
  existingPositions: { x: number; y: number }[],
): { x: number; y: number } | null {
  const minSpacing = TILE_SIZE * 0.7;
  const candidates: { x: number; y: number }[] = [];

  for (let row = 1; row < MAP_ROWS - 1; row++) {
    for (let col = 1; col < MAP_COLS - 1; col++) {
      const tile = grid[row]![col]!;
      if (!tile.walkable || tile.trigger) continue;
      const cx = col * TILE_SIZE + TILE_SIZE / 2;
      const cy = row * TILE_SIZE + TILE_SIZE / 2;
      if (!canSpriteMoveTo(grid, cx, cy)) continue;
      const tooClose = existingPositions.some(
        (p) => Math.hypot(cx - p.x, cy - p.y) < minSpacing,
      );
      if (!tooClose) candidates.push({ x: cx, y: cy });
    }
  }

  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
  return {
    x: clampSpriteAxis(pick.x, MAP_WIDTH),
    y: clampSpriteAxis(pick.y, MAP_HEIGHT),
  };
}

/**
 * Creates a single generated sprite object ready to push into the live sprites array.
 * Picks a random valid spawn position avoiding existing sprites.
 */
export function createGeneratedSprite(
  entry: GeneratedSpriteEntry,
  grid: Tile[][],
  existingSprites: Sprite[],
): Sprite {
  const existingPositions = existingSprites
    .filter((s) => !s.insideHouse)
    .map((s) => ({ x: s.x, y: s.y }));

  const pos = pickRandomWalkableTile(grid, existingPositions) ?? {
    x: MAP_WIDTH / 2,
    y: MAP_HEIGHT / 2,
  };

  return {
    id: `generated_${entry.id}`,
    folder: `/generated-sprites/${entry.id}`,
    x: pos.x,
    y: pos.y,
    direction: "down" as SpriteDirection,
    state: "idle" as SpriteAnimState,
    frame: 0,
    frameTimer: 0,
    stateTimer: MAP_SPAWN_IDLE_GRACE_MS,
    insideHouse: false,
    targetX: undefined,
    targetY: undefined,
    availableStates: entry.states,
    isGenerated: true,
    gender: entry.gender,
    themeEmoji: entry.themeEmoji,
    customStateName: entry.customStateName,
    customSpec: entry.customSpec,
    mapSpawnGraceMs: MAP_SPAWN_IDLE_GRACE_MS,
  };
}

export function getSpriteSheetPath(s: Sprite, state: SpriteAnimState): string {
  if (s.isGenerated && s.availableStates) {
    // Generated sprites store custom animation sheets under `customStateName`
    // (e.g. `special.png`), but the runtime animation state machine uses the
    // internal fixed state name `custom`.
    const sheetState =
      state === "custom" && s.customStateName ? s.customStateName : state;

    if (s.availableStates.includes(sheetState)) {
      return `${s.folder}/${sheetState}.png`;
    }
    const fallback =
      s.gender === "female"
        ? "/assets/sprites/female1"
        : "/assets/sprites/male1";
    // If we can't find the custom sheet, fall back to whatever fixed sheet
    // exists for the internal animation state name.
    return `${fallback}/${state}.png`;
  }
  return `${s.folder}/${state}.png`;
}

export function getSpriteFrameRect(s: Sprite): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  const nFrames =
    s.state === "custom" && s.customSpec
      ? s.customSpec.frameCount
      : // Generated walk sheets are now assembled as 4-frame cycles.
        s.isGenerated && s.state === "walk"
        ? 4
        : STATE_FRAMES[s.state];
  const frameIndex = Math.max(0, Math.min(s.frame, nFrames - 1));
  let effectiveRow: number;
  if (s.state === "custom" && s.customSpec) {
    effectiveRow = getCustomDirectionRow(s.direction, s.customSpec);
  } else if (s.state === "sit") {
    effectiveRow = getSitRow(s.direction);
  } else {
    effectiveRow = DIRECTION_MAP[s.direction];
  }
  const sx = frameIndex * CELL_WIDTH;
  const sy = effectiveRow * CELL_HEIGHT;
  return { sx, sy, sw: CELL_WIDTH, sh: CELL_HEIGHT };
}

function advanceFrame(s: Sprite, dt: number): void {
  if (s.state === "sit") {
    s.frameTimer += dt;
    const msPerFrame = 1000 / STATE_FPS.sit;
    const lastFrame = STATE_FRAMES.sit - 1;
    while (s.frameTimer >= msPerFrame) {
      s.frameTimer -= msPerFrame;
      if (s.frame < lastFrame) {
        s.frame += 1;
      }
    }
  } else {
    const nFrames =
      s.state === "custom" && s.customSpec
        ? s.customSpec.frameCount
        : // Generated walk sheets are now assembled as 4-frame cycles.
          s.isGenerated && s.state === "walk"
          ? 4
          : STATE_FRAMES[s.state];
    const fps =
      s.state === "custom" && s.customSpec
        ? s.customSpec.fps
        : STATE_FPS[s.state];

    // Slow down walk and special only for generated sprites.
    // Idle stays at its original speed (per request).
    const effectiveFps = s.isGenerated
      ? s.state === "walk"
        ? fps * GENERATED_WALK_FPS_MULT
        : s.state === "custom" && s.customStateName === "special"
          ? fps * GENERATED_SPECIAL_FPS_MULT
          : fps
      : fps;

    s.frameTimer += dt;
    const msPerFrame = 1000 / effectiveFps;
    if (s.state === "custom" && s.customSpec && !s.customSpec.looping) {
      const lastFrame = nFrames - 1;
      while (s.frameTimer >= msPerFrame) {
        s.frameTimer -= msPerFrame;
        if (s.frame < lastFrame) {
          s.frame += 1;
        }
      }
    } else {
      while (s.frameTimer >= msPerFrame) {
        s.frameTimer -= msPerFrame;
        s.frame = (s.frame + 1) % nFrames;
      }
    }
  }
}

function checkHouseEnter(s: Sprite, grid: Tile[][], allowed: boolean): boolean {
  if (s.conversation) return false;
  if (!allowed) return false;
  if (s.exitImmuneMs != null && s.exitImmuneMs > 0) return false;
  if (s.insideHouse) return false;
  if (!isInDoorZone(s)) return false;
  s.conversation = undefined;
  s.insideHouse = true;
  /** ~2–5 minutes “inside” before reappearing outside. */
  s.houseTimer = randomInt(120000, 300000);
  s.exitImmuneMs = undefined;
  s.targetX = undefined;
  s.targetY = undefined;
  s.frame = 0;
  s.frameTimer = 0;
  s.stuckTimer = 0;
  return true;
}

function transitionState(
  s: Sprite,
  grid: Tile[][],
  allSprites: Sprite[],
): void {
  if (shouldWalkToHouse(s)) {
    s.state = "walk";
    s.frame = 0;
    s.frameTimer = 0;
    s.stateTimer = 5000 + Math.random() * 3000;
    s.targetX = DOOR_CENTER_X;
    s.targetY = DOOR_CENTER_Y + TILE_SIZE * 0.3;
    s.direction = "up";
    s.stuckTimer = 0;
  } else {
    const next = weightedNextState(s.state, s);
    s.state = next;
    s.frame = 0;
    s.frameTimer = 0;
    s.stateTimer = stateDuration(next, s);
    if (next === "walk" || next === "run") {
      assignWalkOrRunTarget(s, grid, allSprites);
    }
    if ((s.ambientCooldown ?? 0) <= 0) {
      if (next === "sit") {
        triggerBubble(s, EMOJI_POOLS.sit, 0.25);
        if (s.bubble) s.ambientCooldown = 12000 + Math.random() * 8000;
      } else if (next === "emote") {
        triggerBubble(s, EMOJI_POOLS.emote, 0.4);
        if (s.bubble) s.ambientCooldown = 10000 + Math.random() * 5000;
      } else if (next === "run") {
        triggerBubble(s, EMOJI_POOLS.run, 0.2);
        if (s.bubble) s.ambientCooldown = 12000 + Math.random() * 8000;
      } else if (
        next === "custom" &&
        s.themeEmoji &&
        s.customStateName !== "special"
      ) {
        triggerBubble(s, [s.themeEmoji] as const, 0.6);
        if (s.bubble) s.ambientCooldown = 8000 + Math.random() * 5000;
      }
    }
  }
}

export function updateSprites(
  sprites: Sprite[],
  dt: number,
  grid: Tile[][],
  allSprites: Sprite[],
  doorEnterAllowed: boolean,
): void {
  for (const s of sprites) {
    if (s.insideHouse) {
      s.houseTimer = (s.houseTimer ?? 0) - dt;
      if (s.houseTimer! <= 0) {
        s.insideHouse = false;
        s.houseTimer = undefined;
        s.x = DOOR_CENTER_X;
        s.y = DOOR_CENTER_Y;
        s.exitImmuneMs = 99999;
        s.direction = "down";
        s.state = "walk";
        s.frame = 0;
        s.frameTimer = 0;
        s.stateTimer = stateDuration("walk", s);
        s.targetX = DOOR_CENTER_X;
        s.targetY = Math.min(
          DOOR_CENTER_Y + DOOR_EXIT_RADIUS * 1.2,
          MAP_HEIGHT - SPRITE_SAFE_MARGIN,
        );
        s.stuckTimer = 0;
        if ((s.ambientCooldown ?? 0) <= 0) {
          triggerBubble(s, EMOJI_POOLS.house_exit, 0.5);
        }
        s.ambientCooldown = 15000;
      }
      continue;
    }

    if ((s.ambientCooldown ?? 0) > 0) {
      s.ambientCooldown = (s.ambientCooldown ?? 0) - dt;
    }

    if ((s.conversationCooldown ?? 0) > 0) {
      s.conversationCooldown = (s.conversationCooldown ?? 0) - dt;
    }

    if ((s.waterEdgeCooldownMs ?? 0) > 0) {
      s.waterEdgeCooldownMs = (s.waterEdgeCooldownMs ?? 0) - dt;
    }

    if (s.mapSpawnGraceMs != null && s.mapSpawnGraceMs > 0) {
      s.mapSpawnGraceMs -= dt;
      s.direction = "down";
      s.state = "idle";
      s.targetX = undefined;
      s.targetY = undefined;
      s.stuckTimer = 0;
      advanceFrame(s, dt);
      applySeparation(s, allSprites, grid);
      updateBubble(s, dt);
      if (s.mapSpawnGraceMs <= 0) {
        s.mapSpawnGraceMs = undefined;
        s.stateTimer = stateDuration("idle", s);
      }
      continue;
    }

    if (s.waterEdgeFishing) {
      s.waterEdgeFishing.remainingMs -= dt;
      s.x = s.waterEdgeFishing.anchorX;
      s.y = s.waterEdgeFishing.anchorY;
      s.state = "idle";
      s.targetX = undefined;
      s.targetY = undefined;
      s.stuckTimer = 0;
      s.bubble = {
        text: s.waterEdgeFishing.emoji,
        life: s.waterEdgeFishing.remainingMs + 500,
      };

      if (s.waterEdgeFishing.remainingMs <= 0) {
        s.waterEdgeFishing = undefined;
        s.waterEdgeCooldownMs = WATER_EDGE_COOLDOWN_MS;
        s.bubble = undefined;
        s.stateTimer = 0;
      }

      advanceFrame(s, dt);
      updateBubble(s, dt);
      continue;
    }

    if (updateConversation(s, allSprites, dt, grid)) {
      advanceFrame(s, dt);
      updateBubble(s, dt);
      continue;
    }

    advanceFrame(s, dt);

    if (s.state === "walk" || s.state === "run") {
      s.stuckTimer = (s.stuckTimer ?? 0) + dt;
      if (s.stuckTimer > 5000) {
        const snapCol = Math.round((s.x - TILE_SIZE / 2) / TILE_SIZE);
        const snapRow = Math.round((s.y - TILE_SIZE / 2) / TILE_SIZE);
        const clampedCol = Math.max(1, Math.min(snapCol, MAP_COLS - 2));
        const clampedRow = Math.max(1, Math.min(snapRow, MAP_ROWS - 2));
        const snapX = clampedCol * TILE_SIZE + TILE_SIZE / 2;
        const snapY = clampedRow * TILE_SIZE + TILE_SIZE / 2;
        if (canSpriteMoveTo(grid, snapX, snapY)) {
          s.x = snapX;
          s.y = snapY;
        }
        s.stuckTimer = 0;
        handleObstruction(s);
        applySeparation(s, allSprites, grid);
        updateBubble(s, dt);
        continue;
      }
      if (s.targetX == null || s.targetY == null) {
        assignWalkOrRunTarget(s, grid, allSprites);
      }
      if (s.targetX != null && s.targetY != null) {
        moveSprite(s, dt, grid);
      }
    } else {
      s.targetX = undefined;
      s.targetY = undefined;
      s.stuckTimer = 0;
    }

    applySeparation(s, allSprites, grid);

    if (s.exitImmuneMs != null && s.exitImmuneMs > 0 && isOutsideExitZone(s)) {
      s.exitImmuneMs = 0;
    }

    if (Math.random() < 0.02) {
      tryStartConversation(s, allSprites);
    }

    if (checkHouseEnter(s, grid, doorEnterAllowed)) {
      updateBubble(s, dt);
      continue;
    }

    s.ambientTimer = (s.ambientTimer ?? 0) - dt;
    if (s.ambientTimer <= 0 && !s.insideHouse) {
      s.ambientTimer = 4000 + Math.random() * 2000;
      if ((s.ambientCooldown ?? 0) <= 0) {
        maybeStartWaterEdgeFishing(s, grid);
        if (!s.waterEdgeFishing) {
          runAmbientProximityChecks(s, grid, allSprites);
        }
      }
    }

    s.stateTimer -= dt;
    if (s.stateTimer <= 0) {
      transitionState(s, grid, allSprites);
    }

    updateBubble(s, dt);
  }
}

export function collectMapImageUrls(grid: Tile[][]): string[] {
  const set = new Set<string>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell.asset) set.add(cell.asset);
      if (cell.objectAsset) set.add(cell.objectAsset);
    }
  }
  set.add("/assets/environment/structures/house_open.png");
  set.add("/assets/environment/structures/house_close.png");
  set.add(ASSETS.bridge);
  set.add(ASSETS.water_top);
  for (const u of WATER_SWAP_VARIANT_ASSETS) set.add(u);
  return [...set];
}

/** Built-in sprite folders do not ship a `custom` sheet. */
const BUILTIN_SPRITE_ANIM_STATES: SpriteAnimState[] = [
  "idle",
  "walk",
  "run",
  "sit",
  "emote",
];

export function collectSpriteImageUrls(): string[] {
  const urls: string[] = [];
  for (const folder of SPRITE_FOLDERS) {
    for (const st of BUILTIN_SPRITE_ANIM_STATES) {
      urls.push(`${folder}/${st}.png`);
    }
  }
  return urls;
}

export function collectGeneratedSpriteImageUrls(
  entries: GeneratedSpriteEntry[],
): string[] {
  return collectGeneratedSpriteUrls(entries);
}

/**
 * Client-only: rescale a spritesheet to canonical dimensions before save.
 * No-op when already correct size or when `document`/`Image` are unavailable.
 */
export function normalizeBase64SpriteSheet(
  base64: string,
  state: SpriteAnimState,
): Promise<string> {
  if (state === "custom") {
    return Promise.resolve(base64);
  }
  const spec = GENERATED_SHEET_DIMENSIONS[state as FixedGeneratedAnimState];
  if (
    !spec ||
    typeof document === "undefined" ||
    typeof Image === "undefined"
  ) {
    return Promise.resolve(base64);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth === spec.w && img.naturalHeight === spec.h) {
        resolve(base64);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = spec.w;
      canvas.height = spec.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(base64);
        return;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, spec.w, spec.h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(base64);
    img.src = base64.startsWith("data:")
      ? base64
      : `data:image/png;base64,${base64}`;
  });
}
