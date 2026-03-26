import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  PALETTE,
  SPRITE_SIZE,
  SPRITE_COUNT,
  SCALE,
} from "../constants";
import {
  LITEBRITE_DISPLAY_SCALE,
  SCALE as PEG_SCALE,
} from "../utils/litebrite/constants";
import {
  GameState,
  Sprite,
  Obstacle,
  EntityType,
  Rect,
  Fish,
  SpriteResult,
  CREATIONS_STORAGE_KEY,
  MAX_SAVED_CREATIONS,
} from "../types";
import {
  playBlip,
  playChirp,
  playSpawn,
  isMapAmbientAudioSuppressed,
} from "../utils/audio.js";

const playEatingSound = () => {
  if (isMapAmbientAudioSuppressed()) return;
  const audio = new Audio("/sounds/eating.mp3");
  audio.volume = 0.1;
  audio.play().catch(() => {});
};

// Import Renderers
import { drawSprite } from "./renderers/SpriteRenderer";
import { drawCustomSprite } from "./renderers/CustomSpriteRenderer";
import { drawTree } from "./renderers/TreeRenderer";
import { drawRock } from "./renderers/RockRenderer";
import { drawFlower } from "./renderers/FlowerRenderer";
import { drawRiver } from "./renderers/RiverRenderer";
import { drawBridge } from "./renderers/BridgeRenderer";
import { drawFish } from "./renderers/FishRenderer";
import { drawSpeechBubble } from "./renderers/SpeechBubbleRenderer";

// --- Utility Functions ---

const s = (val: number) => Math.floor(val * SCALE);

const getRandomEmoji = () => {
  // Unicode emoji ranges - Filtered to exclude B&W symbols/dingbats
  const emojiRanges = [
    [0x1f600, 0x1f64f], // Emoticons (faces)
    [0x1f300, 0x1f3ff], // Nature, weather, activities
    [0x1f400, 0x1f4ff], // Animals and objects
    [0x1f680, 0x1f6ff], // Transport and map
    // [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  ];

  // Pick a random range
  const range = emojiRanges[Math.floor(Math.random() * emojiRanges.length)];

  // Pick a random code point within that range
  const codePoint =
    Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];

  // Convert to emoji
  return String.fromCodePoint(codePoint);
};

const AABB = (r1: Rect, r2: Rect) => {
  return (
    r1.x < r2.x + r2.width &&
    r1.x + r1.width > r2.x &&
    r1.y < r2.y + r2.height &&
    r1.y + r1.height > r2.y
  );
};

const distSq = (x1: number, y1: number, x2: number, y2: number) => {
  return (x1 - x2) ** 2 + (y1 - y2) ** 2;
};

/** Minimum center-to-center distance from other sprites when spawning (avoid instant soft-collision deadlock). */
const SPAWN_CLEARANCE = 18 * SCALE;

/** Center point of a sprite (for distance checks). */
const getSpriteCenter = (s: Sprite): { x: number; y: number } => {
  const w =
    s.isCustom && s.customSprite
      ? s.customSprite.dimensions.width * SCALE
      : SPRITE_SIZE.w;
  const h =
    s.isCustom && s.customSprite
      ? s.customSprite.dimensions.height * SCALE
      : SPRITE_SIZE.h;
  return { x: s.x + w / 2, y: s.y + h / 2 };
};

/** Content height of a custom sprite for Y-sort (based on non-transparent rows in front view). */
const getCustomSpriteContentHeight = (s: Sprite): number => {
  if (!s.customSprite) return SPRITE_SIZE.h;
  const view = s.customSprite.matrix.front;
  if (!view || view.length === 0) return SPRITE_SIZE.h;
  let maxRow = -1;
  let minRow = view.length;
  for (let y = 0; y < view.length; y++) {
    for (let x = 0; x < (view[y]?.length ?? 0); x++) {
      if (view[y][x] !== "transparent") {
        if (y > maxRow) maxRow = y;
        if (y < minRow) minRow = y;
      }
    }
  }
  if (maxRow === -1) return SPRITE_SIZE.h;
  return (maxRow - minRow + 1) * PEG_SCALE * LITEBRITE_DISPLAY_SCALE;
};

/** Y offset from sprite origin to the bottom of drawn content (for bridge snap so feet land on deck). */
const getCustomSpriteContentBottomOffset = (s: Sprite): number => {
  if (!s.customSprite) return SPRITE_SIZE.h;
  const view = s.customSprite.matrix[s.facing] ?? s.customSprite.matrix.front;
  if (!view || view.length === 0)
    return s.customSprite.dimensions.height * SCALE * LITEBRITE_DISPLAY_SCALE;
  let maxRow = -1;
  for (let y = 0; y < view.length; y++) {
    for (let x = 0; x < (view[y]?.length ?? 0); x++) {
      if (view[y][x] !== "transparent" && y > maxRow) maxRow = y;
    }
  }
  if (maxRow === -1)
    return s.customSprite.dimensions.height * SCALE * LITEBRITE_DISPLAY_SCALE;
  return (maxRow + 1) * PEG_SCALE * LITEBRITE_DISPLAY_SCALE;
};

/** Shadow under a sprite (used for custom sprites with content bounds). */
const drawShadow = (
  ctx: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  width: number,
) => {
  const shadowW = Math.max(4, Math.floor(width * 0.75));
  const shadowH = Math.max(2, Math.floor(SCALE * 0.9));
  const shadowX = Math.floor(centerX - shadowW / 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(shadowX, Math.floor(y), shadowW, shadowH);
};

const FLOWER_SCALE = 1.5;
const FLOWER_RENDER_W = s(6) * FLOWER_SCALE;
const FLOWER_RENDER_H = s(6) * FLOWER_SCALE;

/** Find a valid position for a flower respawn (no overlap with river, bridge, trees, rocks). */
const findValidFlowerSpawnPosition = (
  state: GameState,
): { renderBounds: Rect } => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = Math.random() * (GAME_WIDTH - FLOWER_RENDER_W);
    const y = Math.random() * (GAME_HEIGHT - FLOWER_RENDER_H);
    const renderBounds: Rect = {
      x,
      y,
      width: FLOWER_RENDER_W,
      height: FLOWER_RENDER_H,
    };
    const overlaps = state.obstacles.some((o) => {
      if (o.type === EntityType.FLOWER || o.type === EntityType.GRASS_PATCH)
        return false;
      return AABB(renderBounds, o.bounds);
    });
    if (!overlaps) return { renderBounds };
  }
  return {
    renderBounds: {
      x: GAME_WIDTH / 2 - FLOWER_RENDER_W / 2,
      y: GAME_HEIGHT / 2 - FLOWER_RENDER_H / 2,
      width: FLOWER_RENDER_W,
      height: FLOWER_RENDER_H,
    },
  };
};

/** Bridge curve params (must match BridgeRenderer). Used to snap sprite Y to the deck. */
type BridgeCurve = {
  bridgeStart: number;
  bridgeEnd: number;
  bridgeWidth: number;
  drawY: number;
  maxLift: number;
};

const getBridgeDeckY = (x: number, curve: BridgeCurve): number => {
  if (curve.bridgeWidth <= 0) return curve.drawY;
  const t = Math.max(
    0,
    Math.min(1, (x - curve.bridgeStart) / curve.bridgeWidth),
  );
  const parabola = 1 - Math.pow(2 * t - 1, 2);
  const lift = Math.floor(curve.maxLift * parabola);
  return curve.drawY - lift;
};

export interface GameCanvasRef {
  addCustomSprite: (spriteResult: SpriteResult) => Promise<void>;
}

interface GameCanvasProps {}

export const GameCanvas = forwardRef<GameCanvasRef, GameCanvasProps>(
  (_, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameStateRef = useRef<GameState>({
      sprites: [],
      obstacles: [],
      fish: [],
    });
    const requestRef = useRef<number>(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [, setGameSlice] = useState<{
      obstacles: Obstacle[];
      sprites: Sprite[];
    }>({ obstacles: [], sprites: [] });
    const bridgeCenterRef = useRef<{ x: number; y: number } | null>(null);
    const bridgeYRef = useRef<number>(GAME_HEIGHT / 2);
    const bridgeSegmentsRef = useRef<Obstacle[]>([]);
    const bridgeCurveRef = useRef<BridgeCurve | null>(null);
    const nextSpriteIdRef = useRef<number>(SPRITE_COUNT);

    // Internal: spawn one custom sprite (used by ref and by saved-creations loader)
    const spawnCustomSpriteInternal = useCallback(
      (spriteResult: SpriteResult) => {
        const state = gameStateRef.current;
        const bridgeCenter = bridgeCenterRef.current;
        if (!bridgeCenter) return;

        const spriteHeight = spriteResult.dimensions.height * SCALE;
        const spriteWidth = spriteResult.dimensions.width * SCALE;
        const halfH = (spriteResult.dimensions.height * SCALE) / 2;
        // For the "Add to Party" experience: drop in from above, then idle-facing-front for ~10s.
        // (Game logic uses frame-based timers; assume ~60fps.)
        const spawnDelay = 60 * 10;

        const customSprite: Sprite = {
          id: nextSpriteIdRef.current++,
          x: bridgeCenter.x - spriteWidth / 2,
          y: bridgeCenter.y - spriteHeight / 2,
          vx: 0,
          vy: 0,
          color: "#888",
          hairColor: "#888",
          pantsColor: "#888",
          skinTone: "#888",
          interactionCooldown: Math.random() * 200,
          facing: "front",
          bobOffset: Math.random() * Math.PI * 2,
          state: "idle",
          stateTimer: spawnDelay,
          isCustom: true,
          customSprite: {
            matrix: spriteResult.matrix,
            dimensions: spriteResult.dimensions,
          },
        };

        const isPositionValid = (spriteX: number, spriteY: number): boolean => {
          const box = {
            x: spriteX,
            y: spriteY + halfH,
            width: spriteWidth,
            height: halfH,
          };
          const onBridge = bridgeSegmentsRef.current.some((b) =>
            AABB(box, b.bounds),
          );
          const obstacleHit = state.obstacles.some((o) => {
            if (
              o.type === EntityType.FLOWER ||
              o.type === EntityType.GRASS_PATCH ||
              o.type === EntityType.BRIDGE
            )
              return false;
            if (onBridge && o.type === EntityType.RIVER_SEGMENT) return false;
            return AABB(box, o.bounds);
          });
          if (obstacleHit) return false;
          const newCenter = {
            x: spriteX + spriteWidth / 2,
            y: spriteY + spriteHeight / 2,
          };
          const tooCloseToOther = state.sprites.some((other) => {
            const oc = getSpriteCenter(other);
            return (
              distSq(newCenter.x, newCenter.y, oc.x, oc.y) <
              SPAWN_CLEARANCE * SPAWN_CLEARANCE
            );
          });
          return !tooCloseToOther;
        };

        const baseX = bridgeCenter.x - spriteWidth / 2;
        const baseY = bridgeCenter.y - spriteHeight / 2;
        const xOffsets = [
          0,
          -s(80),
          s(80),
          -s(60),
          s(60),
          -s(40),
          s(40),
          -s(20),
          s(20),
        ];
        let placed = false;
        for (const dx of xOffsets) {
          const tryX = baseX + dx;
          if (isPositionValid(tryX, baseY)) {
            customSprite.x = tryX;
            customSprite.y = baseY;
            state.sprites.push(customSprite);
            placed = true;
            break;
          }
        }
        if (!placed) {
          state.sprites.push(customSprite);
        }

        playSpawn();

        const landingY = customSprite.y;
        const startY = -spriteHeight;
        customSprite.y = startY;
        (customSprite as any)._spawnDrop = {
          startY,
          endY: landingY,
          startTime: performance.now(),
          durationMs: 1000,
        };
      },
      [],
    );

    // Spawn a saved creation at a random valid position, dropping in from above
    const spawnCustomSpriteAtRandomPosition = useCallback(
      (spriteResult: SpriteResult) => {
        const state = gameStateRef.current;
        const spriteHeight = spriteResult.dimensions.height * SCALE;
        const spriteWidth = spriteResult.dimensions.width * SCALE;
        let sx = 0;
        let sy = 0;
        let validPos = false;
        let attempts = 0;
        while (!validPos && attempts < 100) {
          sx = Math.random() * (GAME_WIDTH - spriteWidth - s(20)) + s(10);
          sy = Math.random() * (GAME_HEIGHT - spriteHeight - s(20)) + s(10);
          const spriteBox = {
            x: sx,
            y: sy + spriteHeight / 2,
            width: spriteWidth,
            height: spriteHeight / 2,
          };
          const collision = state.obstacles.some((o) => {
            if (
              o.type === EntityType.FLOWER ||
              o.type === EntityType.GRASS_PATCH ||
              o.type === EntityType.BRIDGE
            )
              return false;
            return AABB(spriteBox, o.bounds);
          });
          if (!collision) validPos = true;
          attempts++;
        }
        if (!validPos) {
          sx = Math.random() * (GAME_WIDTH - spriteWidth);
          sy = Math.random() * (GAME_HEIGHT - spriteHeight);
        }
        const landingY = sy;
        const startY = -spriteHeight;
        const customSprite: Sprite = {
          id: nextSpriteIdRef.current++,
          x: sx,
          y: startY,
          vx: 0,
          vy: 0,
          color: "#888",
          hairColor: "#888",
          pantsColor: "#888",
          skinTone: "#888",
          interactionCooldown: Math.random() * 200,
          facing: "front",
          bobOffset: Math.random() * Math.PI * 2,
          state: "idle",
          stateTimer: 60 * (3 + Math.random() * 5),
          isCustom: true,
          customSprite: {
            matrix: spriteResult.matrix,
            dimensions: spriteResult.dimensions,
          },
        };
        (customSprite as any)._spawnDrop = {
          startY,
          endY: landingY,
          startTime: performance.now(),
          durationMs: 1000,
        };
        state.sprites.push(customSprite);
        playSpawn();
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        addCustomSprite: async (spriteResult: SpriteResult) => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          spawnCustomSpriteInternal(spriteResult);
          await new Promise((resolve) => setTimeout(resolve, 300));
        },
      }),
      [spawnCustomSpriteInternal],
    );

    const savedSpawnTimeoutsRef = useRef<number[]>([]);

    // Initialization
    const initGame = useCallback(() => {
      const obstacles: Obstacle[] = [];

      // Helper to check if a rect collides with any existing hard obstacle (for generation)
      const isColliding = (rect: Rect) => {
        return obstacles.some((o) => {
          if (o.type === EntityType.FLOWER || o.type === EntityType.GRASS_PATCH)
            return false;
          return AABB(rect, o.bounds);
        });
      };

      // 1. Generate River (S-curve)
      const riverPoints = [];

      // EXTENDED RANGE: Generate points from -2 to 12 (t from -0.2 to 1.2)
      for (let i = -2; i <= 12; i++) {
        const t = i / 10;
        // Curve across the map
        const x =
          GAME_WIDTH * 0.2 +
          t * GAME_WIDTH * 0.6 +
          Math.sin(t * Math.PI * 2) * s(40);
        const y = t * GAME_HEIGHT;
        riverPoints.push({ x, y });
      }

      // Connect points with segments
      for (let i = 0; i < riverPoints.length - 1; i++) {
        const p1 = riverPoints[i];
        const p2 = riverPoints[i + 1];
        const steps = 12;
        for (let j = 0; j < steps; j++) {
          const t = j / steps;
          const rx = p1.x + (p2.x - p1.x) * t;
          const ry = p1.y + (p2.y - p1.y) * t;
          obstacles.push({
            id: `river-${i}-${j}`,
            type: EntityType.RIVER_SEGMENT,
            bounds: { x: rx - s(14), y: ry, width: s(28), height: s(28) },
            renderBounds: { x: rx - s(14), y: ry, width: s(28), height: s(28) },
            variant: 0,
          });
        }
      }

      // 2. Add Bridge
      const bridgeY = GAME_HEIGHT / 2;
      const riverSegments = obstacles.filter(
        (o) => o.type === EntityType.RIVER_SEGMENT,
      );
      const bridgeSegments = riverSegments.filter(
        (o) => Math.abs(o.bounds.y - bridgeY) < s(11),
      );
      bridgeSegments.forEach((b) => (b.type = EntityType.BRIDGE));

      // Narrow walkable height so sprites must be on the deck to count as on bridge
      const BRIDGE_WALKABLE_HEIGHT = s(12);
      bridgeSegments.forEach((b) => {
        const centerY = b.bounds.y + b.bounds.height / 2;
        b.bounds.height = BRIDGE_WALKABLE_HEIGHT;
        b.bounds.y = centerY - BRIDGE_WALKABLE_HEIGHT / 2;
      });

      // Store bridge info for movement logic
      bridgeYRef.current = bridgeY;
      bridgeSegmentsRef.current = bridgeSegments;

      // Store bridge curve (same math as BridgeRenderer) for Y-snap so sprites stand on the arch
      if (bridgeSegments.length > 0) {
        const minX = Math.min(...bridgeSegments.map((b) => b.renderBounds.x));
        const maxX = Math.max(
          ...bridgeSegments.map((b) => b.renderBounds.x + b.renderBounds.width),
        );
        const minY = Math.min(...bridgeSegments.map((b) => b.renderBounds.y));
        const maxY = Math.max(
          ...bridgeSegments.map(
            (b) => b.renderBounds.y + b.renderBounds.height,
          ),
        );
        const bridgeStart = minX - s(12);
        const bridgeEnd = maxX + s(12);
        const bridgeWidth = bridgeEnd - bridgeStart;
        const centerY = (minY + maxY) / 2;
        const fixedHeight = s(22);
        const drawY = centerY - fixedHeight / 2;
        const maxLift = s(8);
        bridgeCurveRef.current = {
          bridgeStart,
          bridgeEnd,
          bridgeWidth,
          drawY,
          maxLift,
        };
      } else {
        bridgeCurveRef.current = null;
      }

      // Store bridge center for custom sprite spawning
      // Set as constant true center - calculated once during initialization
      const bridgeCenterX = GAME_WIDTH / 2; // True center of the map
      bridgeCenterRef.current = { x: bridgeCenterX, y: bridgeY };

      // 3. Grass Patches (Visual Texture)
      for (let i = 0; i < 12; i++) {
        const cx = Math.random() * GAME_WIDTH;
        const cy = Math.random() * GAME_HEIGHT;
        const subPatches = 3 + Math.floor(Math.random() * 3);
        for (let j = 0; j < subPatches; j++) {
          obstacles.push({
            id: `grass-${i}-${j}`,
            type: EntityType.GRASS_PATCH,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            renderBounds: {
              x: cx + (Math.random() - 0.5) * s(40),
              y: cy + (Math.random() - 0.5) * s(30),
              width: s(10 + Math.random() * 20),
              height: s(10 + Math.random() * 15),
            },
            variant: 0,
          });
        }
      }

      // 4. Tree Formations (1.3x visual scale for trees/rocks)
      const TREE_ROCK_SCALE = 1.3;
      const treeW = s(24) * TREE_ROCK_SCALE;
      const treeH = s(32) * TREE_ROCK_SCALE;
      const treeCollisionH = s(8) * TREE_ROCK_SCALE;
      const treeCollisionW = s(12) * TREE_ROCK_SCALE;

      const addTree = (tx: number, ty: number) => {
        const bounds = {
          x: tx + (treeW - treeCollisionW) / 2,
          y: ty + treeH - treeCollisionH - s(2),
          width: treeCollisionW,
          height: treeCollisionH,
        };

        if (!isColliding(bounds)) {
          obstacles.push({
            id: `tree-${Math.random()}`,
            type: EntityType.TREE,
            bounds,
            renderBounds: { x: tx, y: ty, width: treeW, height: treeH },
            variant: Math.floor(Math.random() * 3),
            apples: [],
          });
        }
      };

      // Formation 1: Gentle Curve (Top Left)
      const curveStart = { x: s(40), y: s(40) };
      for (let i = 0; i < 6; i++) {
        addTree(
          curveStart.x + i * s(20) + Math.sin(i * 0.5) * s(10),
          curveStart.y + i * s(15) + (Math.random() - 0.5) * s(5),
        );
      }

      // Formation 2: Corner (Top Right)
      const corner = { x: GAME_WIDTH - s(80), y: s(50) };
      addTree(corner.x, corner.y);
      addTree(corner.x - s(20), corner.y + s(5));
      addTree(corner.x + s(5), corner.y + s(20));
      addTree(corner.x - s(15), corner.y + s(25));

      // Formation 3: Diagonal Line (Bottom Left)
      const diag = { x: s(60), y: GAME_HEIGHT - s(100) };
      for (let i = 0; i < 5; i++) {
        addTree(
          diag.x + i * s(18) + (Math.random() - 0.5) * s(4),
          diag.y + i * s(12) + (Math.random() - 0.5) * s(4),
        );
      }

      // Formation 4: Cluster (Bottom Right)
      const cluster = { x: GAME_WIDTH - s(100), y: GAME_HEIGHT - s(80) };
      addTree(cluster.x, cluster.y);
      addTree(cluster.x + s(20), cluster.y);
      addTree(cluster.x + s(10), cluster.y + s(15));

      // Standalone random trees
      for (let i = 0; i < 4; i++) {
        addTree(
          Math.random() * (GAME_WIDTH - treeW),
          Math.random() * (GAME_HEIGHT - treeH),
        );
      }

      // 5. Rocks (1.3x visual scale)
      const rockW = s(16) * TREE_ROCK_SCALE;
      const rockH = s(12) * TREE_ROCK_SCALE;
      for (let i = 0; i < 8; i++) {
        let placed = false;
        let attempts = 0;
        while (!placed && attempts < 20) {
          const x = Math.random() * (GAME_WIDTH - rockW);
          const y = Math.random() * (GAME_HEIGHT - rockH);
          const bounds = {
            x: x,
            y: y + s(4) * TREE_ROCK_SCALE,
            width: rockW,
            height: rockH - s(4) * TREE_ROCK_SCALE,
          };

          if (!isColliding(bounds)) {
            obstacles.push({
              id: `rock-${i}`,
              type: EntityType.ROCK,
              bounds,
              renderBounds: { x, y, width: rockW, height: rockH },
              variant: Math.floor(Math.random() * 3),
            });
            placed = true;
          }
          attempts++;
        }
      }

      // 6. Flowers (No collision, 1.5x visual scale)
      for (let i = 0; i < 20; i++) {
        obstacles.push({
          id: `flower-${i}`,
          type: EntityType.FLOWER,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          renderBounds: {
            x: Math.random() * GAME_WIDTH,
            y: Math.random() * GAME_HEIGHT,
            width: FLOWER_RENDER_W,
            height: FLOWER_RENDER_H,
          },
          variant: 0,
          flowerStage: (() => {
            const r = Math.random();
            if (r < 0.22) return 1 as const;
            if (r < 0.88) return 2 as const;
            return 3 as const;
          })(),
          flowerGrowthTimer: Date.now() + 60000 + Math.random() * 60000,
        });
      }

      // 7. Sprites (5 initial sprites)
      const sprites: Sprite[] = [];
      const shirtColors = [
        "#e74c3c",
        "#3498db",
        "#f1c40f",
        "#9b59b6",
        "#e67e22",
        "#1abc9c",
        "#bdc3c7",
        "#34495e",
      ];
      const hairColors = [
        "#f1c40f",
        "#8e44ad",
        "#d35400",
        "#2c3e50",
        "#7f8c8d",
        "#5d4037",
        "#e5c07b",
      ];
      const pantsColors = [
        "#2c3e50",
        "#3e2723",
        "#273c75",
        "#353b48",
        "#40739e",
      ];
      const skinTones = ["#ffccaa", "#f1c27d", "#e0ac69", "#8d5524", "#c68642"];

      for (let i = 0; i < SPRITE_COUNT; i++) {
        let validPos = false;
        let sx = 0,
          sy = 0;
        let attempts = 0;

        while (!validPos && attempts < 100) {
          sx = Math.random() * (GAME_WIDTH - s(20)) + s(10);
          sy = Math.random() * (GAME_HEIGHT - s(20)) + s(10);
          const spriteBox = {
            x: sx,
            y: sy + SPRITE_SIZE.h / 2,
            width: SPRITE_SIZE.w,
            height: SPRITE_SIZE.h / 2,
          };

          const collision = obstacles.some((o) => {
            if (
              o.type === EntityType.FLOWER ||
              o.type === EntityType.GRASS_PATCH ||
              o.type === EntityType.BRIDGE
            )
              return false;
            return AABB(spriteBox, o.bounds);
          });

          if (!collision) validPos = true;
          attempts++;
        }

        if (validPos) {
          sprites.push({
            id: i,
            x: sx,
            y: sy,
            vx: 0,
            vy: 0,
            color: shirtColors[Math.floor(Math.random() * shirtColors.length)],
            hairColor:
              hairColors[Math.floor(Math.random() * hairColors.length)],
            pantsColor:
              pantsColors[Math.floor(Math.random() * pantsColors.length)],
            skinTone: skinTones[Math.floor(Math.random() * skinTones.length)],
            interactionCooldown: Math.random() * 200,
            facing: "front",
            bobOffset: Math.random() * Math.PI * 2,
            state: "idle",
            stateTimer: 60 * (3 + Math.random() * 5),
          });
        }
      }

      // 8. Fish
      const fish: Fish[] = [];
      const fishColors = [
        "#ff8c00",
        "#ffd700",
        "#ff4444",
        "#ff69b4",
        "#00d4ff",
      ];
      const fishCount = 1 + Math.floor(Math.random() * 4);

      for (let i = 0; i < fishCount; i++) {
        fish.push({
          id: i,
          x: 0,
          y: Math.random() * GAME_HEIGHT,
          color: fishColors[Math.floor(Math.random() * fishColors.length)],
          speed: 0.05 + Math.random() * 0.1,
          direction: Math.random() > 0.5 ? 1 : -1,
          facingRight: Math.random() > 0.5,
          wiggleOffset: Math.random() * Math.PI * 2,
          riverOffset: (Math.random() - 0.5) * s(10),
        });
      }

      // 5 apples total across all trees — place on randomly chosen trees
      const treeIndices = obstacles
        .map((ob, i) => (ob.type === EntityType.TREE ? i : -1))
        .filter((i) => i >= 0);
      const now = Date.now();
      for (let k = 0; k < 5; k++) {
        const idx = treeIndices[Math.floor(Math.random() * treeIndices.length)];
        const tree = obstacles[idx];
        if (tree.type !== EntityType.TREE) continue;
        tree.apples = tree.apples ?? [];
        tree.apples.push({
          state: "hanging" as const,
          timer: now + 60000 + Math.random() * 240000,
          x: 0,
          y: 0,
          vY: 0,
          targetY: 0,
          needsPositioning: true,
        });
      }

      gameStateRef.current = { sprites, obstacles, fish };
    }, []);

    // Update Loop
    const update = useCallback(() => {
      const state = gameStateRef.current;
      const MOVEMENT_SPEED = 0.25 * SCALE;

      // --- Update Fish ---
      state.fish.forEach((fish) => {
        fish.y += fish.speed * fish.direction * SCALE;

        const buffer = s(12);
        if (fish.direction === 1 && fish.y > GAME_HEIGHT + buffer) {
          fish.y = -buffer;
        } else if (fish.direction === -1 && fish.y < -buffer) {
          fish.y = GAME_HEIGHT + buffer;
        }

        const t = fish.y / GAME_HEIGHT;
        const riverCenterX =
          GAME_WIDTH * 0.2 +
          t * GAME_WIDTH * 0.6 +
          Math.sin(t * Math.PI * 2) * s(40);

        fish.x = riverCenterX + fish.riverOffset;
        fish.wiggleOffset += 0.03;
      });

      state.sprites.forEach((sprite) => {
        // --- Drop-from-sky spawn animation (custom sprites only) ---
        const spawnDrop = (sprite as any)._spawnDrop as
          | {
              startY: number;
              endY: number;
              startTime: number;
              durationMs: number;
            }
          | undefined;
        if (spawnDrop) {
          sprite.facing = "front"; // Face camera while falling
          const elapsed = performance.now() - spawnDrop.startTime;
          const t = Math.min(1, elapsed / spawnDrop.durationMs);
          const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
          sprite.y =
            spawnDrop.startY +
            (spawnDrop.endY - spawnDrop.startY) * easeOutCubic(t);
          if (t >= 1) {
            sprite.y = spawnDrop.endY;
            delete (sprite as any)._spawnDrop;
          } else {
            return; // Still falling — skip movement/collision/bridge snap this frame
          }
        }

        // --- State Machine ---
        if (sprite.state === "idle") {
          sprite.vx = 0;
          sprite.vy = 0;
          sprite.facing = "front";
          sprite.bobOffset += 0.05;

          sprite.stateTimer--;
          if (sprite.stateTimer <= 0) {
            sprite.state = "moving";
            sprite.stateTimer = 60 * (1 + Math.random() * 3);

            // Check if this is a newly spawned custom sprite with a pending direction
            const pendingDirection = (sprite as any)._spawnDirection;
            const pendingSpeed = (sprite as any)._spawnSpeed;

            if (pendingDirection && pendingSpeed) {
              // Use the stored spawn direction for newly spawned custom sprites
              sprite.vx =
                pendingDirection === "right" ? pendingSpeed : -pendingSpeed;
              sprite.vy = 0;
              sprite.facing = pendingDirection;
              // Clear the pending direction
              delete (sprite as any)._spawnDirection;
              delete (sprite as any)._spawnSpeed;
            } else {
              // Normal movement logic for other sprites
              // Check if sprite is near or on the bridge
              const spriteCenterY =
                sprite.y +
                (sprite.isCustom && sprite.customSprite
                  ? (sprite.customSprite.dimensions.height * SCALE) / 2
                  : SPRITE_SIZE.h / 2);
              const distanceFromBridge = Math.abs(
                spriteCenterY - bridgeYRef.current,
              );
              const isNearBridge = distanceFromBridge < s(40); // Within 40 pixels of bridge center

              // Check if sprite is actually on a bridge segment
              const spriteW =
                sprite.isCustom && sprite.customSprite
                  ? sprite.customSprite.dimensions.width * SCALE
                  : SPRITE_SIZE.w;
              const spriteH =
                sprite.isCustom && sprite.customSprite
                  ? sprite.customSprite.dimensions.height * SCALE
                  : SPRITE_SIZE.h;
              const spriteBox: Rect = {
                x: sprite.x,
                y: sprite.y + spriteH / 2,
                width: spriteW,
                height: spriteH / 2,
              };
              const isOnBridge = bridgeSegmentsRef.current.some((bridge) => {
                return AABB(spriteBox, bridge.bounds);
              });

              const rand = Math.random();

              // If on bridge, strongly favor horizontal movement (80% horizontal, 20% vertical)
              if (isOnBridge) {
                if (rand < 0.4) {
                  sprite.vx = MOVEMENT_SPEED;
                  sprite.vy = 0;
                  sprite.facing = "right";
                } else if (rand < 0.8) {
                  sprite.vx = -MOVEMENT_SPEED;
                  sprite.vy = 0;
                  sprite.facing = "left";
                } else if (rand < 0.9) {
                  sprite.vx = 0;
                  sprite.vy = MOVEMENT_SPEED;
                  sprite.facing = "front";
                } else {
                  sprite.vx = 0;
                  sprite.vy = -MOVEMENT_SPEED;
                  sprite.facing = "front";
                }
              }
              // If near bridge, favor horizontal movement (60% horizontal, 40% vertical)
              else if (isNearBridge) {
                if (rand < 0.3) {
                  sprite.vx = MOVEMENT_SPEED;
                  sprite.vy = 0;
                  sprite.facing = "right";
                } else if (rand < 0.6) {
                  sprite.vx = -MOVEMENT_SPEED;
                  sprite.vy = 0;
                  sprite.facing = "left";
                } else if (rand < 0.8) {
                  sprite.vx = 0;
                  sprite.vy = MOVEMENT_SPEED;
                  sprite.facing = "front";
                } else {
                  sprite.vx = 0;
                  sprite.vy = -MOVEMENT_SPEED;
                  sprite.facing = "front";
                }
              }
              // Normal movement distribution (25% each direction)
              else {
                if (rand < 0.25) {
                  sprite.vx = MOVEMENT_SPEED;
                  sprite.vy = 0;
                  sprite.facing = "right";
                } else if (rand < 0.5) {
                  sprite.vx = -MOVEMENT_SPEED;
                  sprite.vy = 0;
                  sprite.facing = "left";
                } else if (rand < 0.75) {
                  sprite.vx = 0;
                  sprite.vy = MOVEMENT_SPEED;
                  sprite.facing = "front";
                } else {
                  sprite.vx = 0;
                  sprite.vy = -MOVEMENT_SPEED;
                  sprite.facing = "front";
                }
              }
            }
          }
        } else if (sprite.state === "moving") {
          sprite.bobOffset += 0.15;
          sprite.stateTimer--;
          if (sprite.stateTimer <= 0) {
            sprite.state = "idle";
            sprite.stateTimer = 60 * (3 + Math.random() * 5);
          }
        }

        // --- Movement & Collision ---
        if (sprite.state === "moving") {
          let nextX = sprite.x + sprite.vx;
          let nextY = sprite.y + sprite.vy;
          let hit = false;

          // Get sprite dimensions (custom or default)
          const spriteW =
            sprite.isCustom && sprite.customSprite
              ? sprite.customSprite.dimensions.width * SCALE
              : SPRITE_SIZE.w;
          const spriteH =
            sprite.isCustom && sprite.customSprite
              ? sprite.customSprite.dimensions.height * SCALE
              : SPRITE_SIZE.h;

          // 1. Screen Bounds
          if (
            nextX < 0 ||
            nextX > GAME_WIDTH - spriteW ||
            nextY < 0 ||
            nextY > GAME_HEIGHT - spriteH
          ) {
            hit = true;
          }

          // 2. Obstacles
          if (!hit) {
            const spriteBox: Rect = {
              x: nextX,
              y: nextY + spriteH / 2,
              width: spriteW,
              height: spriteH / 2,
            };

            // Check if sprite is currently on a bridge
            const currentSpriteBox: Rect = {
              x: sprite.x,
              y: sprite.y + spriteH / 2,
              width: spriteW,
              height: spriteH / 2,
            };
            const isOnBridge = bridgeSegmentsRef.current.some((bridge) => {
              return AABB(currentSpriteBox, bridge.bounds);
            });

            // Check if sprite will be on bridge at next position
            const willBeOnBridge = bridgeSegmentsRef.current.some((bridge) => {
              return AABB(spriteBox, bridge.bounds);
            });

            // Check if sprite is moving horizontally
            const isMovingHorizontally = sprite.vx !== 0 && sprite.vy === 0;

            // Allow horizontal movement over water only when feet actually overlap the bridge
            // (not just "near" bridge Y), so sprites don't appear to walk on water above the deck
            const canCrossWater =
              (isOnBridge || willBeOnBridge) && isMovingHorizontally;

            for (const obs of state.obstacles) {
              // Always skip decorative elements
              if (
                obs.type === EntityType.FLOWER ||
                obs.type === EntityType.GRASS_PATCH ||
                obs.type === EntityType.BRIDGE
              )
                continue;

              // If sprite is on bridge or entering bridge and moving horizontally, allow crossing even over water
              // This ensures bridge crossing takes precedence over water collision
              if (canCrossWater && obs.type === EntityType.RIVER_SEGMENT) {
                continue; // Skip water collision when crossing bridge horizontally
              }

              // Normal collision check (trees, rocks, water when not on bridge)
              if (AABB(spriteBox, obs.bounds)) {
                hit = true;
                break;
              }
            }
          }

          // 3. Other Sprites (Soft collision)
          let collisionOther: Sprite | null = null;
          if (!hit) {
            for (const other of state.sprites) {
              if (other.id === sprite.id) continue;

              // Check collision with other sprite's current position
              const otherCurrentDist = distSq(nextX, nextY, other.x, other.y);

              // If other sprite is also moving, check its next position to avoid deadlock
              let otherNextX = other.x;
              let otherNextY = other.y;
              if (other.state === "moving") {
                otherNextX = other.x + other.vx;
                otherNextY = other.y + other.vy;
              }
              const otherNextDist = distSq(
                nextX,
                nextY,
                otherNextX,
                otherNextY,
              );

              // Use the minimum distance (either current or next position)
              // This prevents deadlock when both sprites are moving
              const minDist = Math.min(otherCurrentDist, otherNextDist);

              if (minDist < (10 * SCALE) ** 2) {
                // Only block if other sprite is idle or moving towards us
                // If both are moving and would pass each other, allow movement
                if (other.state === "moving") {
                  // Check if sprites are moving in opposite directions (would pass each other)
                  const dx = nextX - otherNextX;
                  const dy = nextY - otherNextY;
                  const dotProduct =
                    sprite.vx * (otherNextX - other.x) +
                    sprite.vy * (otherNextY - other.y);

                  // If moving towards each other and would overlap, block
                  // Otherwise allow (they're moving away or in same direction)
                  if (dotProduct < 0 && minDist < (8 * SCALE) ** 2) {
                    hit = true;
                    collisionOther = other;
                  }
                  // If moving away from each other, don't block
                } else {
                  // Other sprite is idle, block movement
                  hit = true;
                  collisionOther = other;
                }

                if (hit && sprite.interactionCooldown <= 0) {
                  sprite.interactionCooldown = 180;
                  if (Math.random() < 0.3) {
                    const icon = getRandomEmoji();
                    sprite.bubble = { text: icon, life: 240 };
                    playChirp();
                  }
                }
                if (hit) break;
              }
            }
          }

          if (hit) {
            sprite.state = "idle";
            sprite.stateTimer = 60 * (2 + Math.random() * 3);
            sprite.vx = 0;
            sprite.vy = 0;
            sprite.facing = "front";

            // Nudge apart when blocked by another sprite so they don't stay stuck face-to-face
            if (collisionOther) {
              const otherW =
                collisionOther.isCustom && collisionOther.customSprite
                  ? collisionOther.customSprite.dimensions.width * SCALE
                  : SPRITE_SIZE.w;
              const otherH =
                collisionOther.isCustom && collisionOther.customSprite
                  ? collisionOther.customSprite.dimensions.height * SCALE
                  : SPRITE_SIZE.h;
              const myCx = sprite.x + spriteW / 2;
              const myCy = sprite.y + spriteH / 2;
              const otherCx = collisionOther.x + otherW / 2;
              const otherCy = collisionOther.y + otherH / 2;
              let dx = myCx - otherCx;
              let dy = myCy - otherCy;
              const d = Math.sqrt(dx * dx + dy * dy) || 1;
              const nudge = 6 * SCALE;
              dx = (dx / d) * nudge;
              dy = (dy / d) * nudge;
              sprite.x = Math.max(
                0,
                Math.min(GAME_WIDTH - spriteW, sprite.x + dx),
              );
              sprite.y = Math.max(
                0,
                Math.min(GAME_HEIGHT - spriteH, sprite.y + dy),
              );
            }

            if (sprite.interactionCooldown <= 0) {
              sprite.interactionCooldown = 180;
              if (Math.random() < 0.2) {
                const icon = getRandomEmoji();
                sprite.bubble = { text: icon, life: 240 };
                playBlip(0.8);
              }
            }
          } else {
            sprite.x = nextX;
            sprite.y = nextY;
          }
        }

        // Snap sprite Y to bridge curve when on bridge (so they stand on the arch, not above/below it)
        const snapW =
          sprite.isCustom && sprite.customSprite
            ? sprite.customSprite.dimensions.width *
              SCALE *
              LITEBRITE_DISPLAY_SCALE
            : SPRITE_SIZE.w;
        const snapH =
          sprite.isCustom && sprite.customSprite
            ? sprite.customSprite.dimensions.height *
              SCALE *
              LITEBRITE_DISPLAY_SCALE
            : SPRITE_SIZE.h;
        const feetBox: Rect = {
          x: sprite.x,
          y: sprite.y + snapH / 2,
          width: snapW,
          height: snapH / 2,
        };
        const onBridge = bridgeSegmentsRef.current.some((b) =>
          AABB(feetBox, b.bounds),
        );
        if (onBridge && bridgeCurveRef.current) {
          const deckY = getBridgeDeckY(
            sprite.x + snapW / 2,
            bridgeCurveRef.current,
          );
          // Use content bottom for custom sprites so visible feet align with deck (not full grid bottom)
          const feetOffset =
            sprite.isCustom && sprite.customSprite
              ? getCustomSpriteContentBottomOffset(sprite)
              : snapH;
          sprite.y = deckY - feetOffset;
        }

        if (sprite.interactionCooldown > 0) sprite.interactionCooldown--;
        if (sprite.bubble) {
          sprite.bubble.life--;
          if (sprite.bubble.life <= 0) sprite.bubble = undefined;
        }
        if (
          sprite.speechBubbleTimer != null &&
          Date.now() > sprite.speechBubbleTimer
        ) {
          delete (sprite as Partial<Sprite>).speechBubble;
          delete (sprite as Partial<Sprite>).speechBubbleTimer;
        }
      });
    }, []);

    // Render Loop
    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.imageSmoothingEnabled = false;

      const state = gameStateRef.current;
      const customBubbleAnchors: Record<number, { x: number; y: number }> = {};

      // Clear
      ctx.fillStyle = PALETTE.GRASS_BASE;
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      // Static Grass Patches (Base noise)
      ctx.fillStyle = PALETTE.GRASS_DARK;
      const grassStep = s(20);
      for (let x = 0; x < GAME_WIDTH; x += grassStep) {
        for (let y = 0; y < GAME_HEIGHT; y += grassStep) {
          if (Math.sin(x / SCALE) + Math.cos(y / SCALE) > 0.5) {
            ctx.fillRect(x + s(5), y + s(5), s(4), s(2));
          }
        }
      }

      // Render large grass patches (Visual only)
      state.obstacles
        .filter((o) => o.type === EntityType.GRASS_PATCH)
        .forEach((p) => {
          ctx.fillStyle = PALETTE.GRASS_DARK;
          ctx.fillRect(
            p.renderBounds.x,
            p.renderBounds.y,
            p.renderBounds.width,
            p.renderBounds.height,
          );
        });

      // 1. Draw River (Background Water) - Only draw actual river segments, not bridge segments
      const riverSegments = state.obstacles.filter(
        (o) => o.type === EntityType.RIVER_SEGMENT,
      );
      drawRiver(ctx, riverSegments);

      // 2. Draw Fish (Now between River floor and Bridge)
      state.fish.forEach((fish) => drawFish(ctx, fish));

      // 3. Draw Bridges (Over Fish)
      const bridgeSegments = state.obstacles.filter(
        (o) => o.type === EntityType.BRIDGE,
      );
      drawBridge(ctx, bridgeSegments);

      // Sort renderables by Y (Sprites, Trees, Rocks)
      const renderList = [
        ...state.sprites.map((s) => {
          const spriteH =
            s.isCustom && s.customSprite
              ? getCustomSpriteContentHeight(s)
              : SPRITE_SIZE.h;
          return { type: "sprite", y: s.y + spriteH, obj: s };
        }),
        ...state.obstacles
          .filter(
            (o) =>
              o.type !== EntityType.RIVER_SEGMENT &&
              o.type !== EntityType.BRIDGE &&
              o.type !== EntityType.GRASS_PATCH,
          )
          .map((o) => ({
            type: "obstacle",
            y: o.bounds.y + o.bounds.height,
            obj: o,
          })),
      ];

      renderList.sort((a, b) => a.y - b.y);

      renderList.forEach((item) => {
        if (item.type === "obstacle") {
          const o = item.obj as Obstacle;
          if (o.type === EntityType.TREE) drawTree(ctx, o);
          else if (o.type === EntityType.ROCK) drawRock(ctx, o);
          else if (o.type === EntityType.FLOWER) drawFlower(ctx, o);
        } else {
          const spr = item.obj as Sprite;
          if (spr.isCustom) {
            const contentBounds = drawCustomSprite(ctx, spr);
            if (contentBounds) {
              const shadowY =
                spr.y + contentBounds.contentY + contentBounds.contentHeight;
              const shadowCenterX =
                spr.x + contentBounds.contentX + contentBounds.contentWidth / 2;
              drawShadow(
                ctx,
                shadowCenterX,
                shadowY,
                contentBounds.contentWidth,
              );
              // Anchor bubble above content top (same offset as default sprites: 12*SCALE)
              const bubbleAboveContent = 12 * SCALE;
              customBubbleAnchors[spr.id] = {
                x:
                  spr.x +
                  contentBounds.contentX +
                  contentBounds.contentWidth / 2,
                y: spr.y + contentBounds.contentY - bubbleAboveContent,
              };
            }
          } else {
            drawSprite(ctx, spr);
          }
        }
      });

      // Draw Bubbles
      state.sprites.forEach((sprite) => {
        if (sprite.bubble || sprite.speechBubble) {
          const anchor = sprite.isCustom
            ? customBubbleAnchors[sprite.id]
            : undefined;
          drawSpeechBubble(ctx, sprite, anchor);
        }
      });
    }, []);

    const tick = useCallback(() => {
      update();
      draw();
      requestRef.current = requestAnimationFrame(tick);
    }, [update, draw]);

    useEffect(() => {
      initGame();
      // Read saved creations and schedule spawns before showing the map so nothing blocks after paint
      savedSpawnTimeoutsRef.current = [];
      try {
        const raw = localStorage.getItem(CREATIONS_STORAGE_KEY);
        if (raw) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = null;
          }
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Cap how many we load to avoid OOM when storage was from before the cap
            const list = parsed.slice(-MAX_SAVED_CREATIONS) as SpriteResult[];
            const baseDelayMs = 600; // wait a little after map appears, then float in
            list.forEach((sr: SpriteResult, i: number) => {
              const delay = baseDelayMs + i * 400 + Math.random() * 300;
              const id = window.setTimeout(
                () => spawnCustomSpriteAtRandomPosition(sr),
                delay,
              );
              savedSpawnTimeoutsRef.current.push(id);
            });
          }
        }
      } catch {
        // ignore
      }
      setIsPlaying(true);
      requestRef.current = requestAnimationFrame(tick);
      return () => {
        savedSpawnTimeoutsRef.current.forEach((id) => clearTimeout(id));
        savedSpawnTimeoutsRef.current = [];
        cancelAnimationFrame(requestRef.current);
      };
    }, [initGame, tick, spawnCustomSpriteAtRandomPosition]);

    // Flower growth: every 5s advance stage or respawn stage-3 flowers
    useEffect(() => {
      const interval = setInterval(() => {
        const now = Date.now();
        const state = gameStateRef.current;
        let changed = false;
        const updatedObstacles = state.obstacles.map((o) => {
          if (o.type !== EntityType.FLOWER) return o;
          if (o.flowerGrowthTimer == null || now < o.flowerGrowthTimer)
            return o;

          changed = true;

          if (o.flowerStage === 3) {
            const newPos = findValidFlowerSpawnPosition(state);
            return {
              ...o,
              ...newPos,
              flowerStage: 1 as const,
              flowerGrowthTimer: Date.now() + 60000 + Math.random() * 60000,
            };
          }

          return {
            ...o,
            flowerStage: ((o.flowerStage ?? 1) + 1) as 1 | 2 | 3,
            flowerGrowthTimer: Date.now() + 60000 + Math.random() * 60000,
          };
        });

        if (changed) {
          state.obstacles = updatedObstacles;
        }
      }, 5000);

      return () => clearInterval(interval);
    }, []);

    // Apple lifecycle: 5 apples per tree, staggered hang → fall → onGround; replace landed with new hanging; pickup unchanged.
    useEffect(() => {
      const interval = setInterval(() => {
        setGameSlice((prev) => {
          const now = Date.now();
          const source = gameStateRef.current;
          if (source.obstacles.length === 0) return prev;

          const updatedObstacles = source.obstacles.map((o) => {
            if (o.type !== EntityType.TREE) return o;

            const cx = o.renderBounds.x + o.renderBounds.width / 2;
            const canopyY = o.renderBounds.y + o.renderBounds.height * 0.35;
            const canopyR = o.renderBounds.width * 0.35;
            const groundY = o.renderBounds.y + o.renderBounds.height;

            const updatedApples = (o.apples ?? []).map((apple) => {
              if (apple.needsPositioning) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * canopyR * 0.7;
                return {
                  ...apple,
                  x: cx + Math.cos(angle) * dist,
                  y: canopyY + Math.sin(angle) * dist * 0.5,
                  targetY: groundY,
                  needsPositioning: false,
                };
              }

              if (apple.state === "hanging") {
                if (apple.timer != null && now < apple.timer) return apple;
                return {
                  ...apple,
                  state: "falling" as const,
                  timer: undefined,
                  vY: 0.5,
                };
              }

              if (apple.state === "falling") {
                const newVY = apple.vY + 0.4;
                const newY = apple.y + newVY;
                if (newY >= apple.targetY) {
                  return {
                    ...apple,
                    state: "onGround" as const,
                    y: apple.targetY,
                    vY: 0,
                  };
                }
                return { ...apple, y: newY, vY: newVY };
              }

              return apple;
            });

            return { ...o, apples: updatedApples };
          });

          // Maintain 5 hanging apples total across all trees — add replacements to random trees
          const treeIndices = updatedObstacles
            .map((ob, i) => (ob.type === EntityType.TREE ? i : -1))
            .filter((i) => i >= 0);
          const totalHanging = updatedObstacles
            .flatMap((ob) =>
              ob.type === EntityType.TREE ? (ob.apples ?? []) : [],
            )
            .filter((a) => a.state === "hanging").length;
          let obstaclesWithReplacements = updatedObstacles;
          const makeAppleForTree = (tree: Obstacle) => {
            const cx = tree.renderBounds.x + tree.renderBounds.width / 2;
            const canopyY =
              tree.renderBounds.y + tree.renderBounds.height * 0.35;
            const canopyR = tree.renderBounds.width * 0.35;
            const groundY = tree.renderBounds.y + tree.renderBounds.height;
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * canopyR * 0.7;
            return {
              state: "hanging" as const,
              timer: now + 240000 + Math.random() * 60000,
              x: cx + Math.cos(angle) * dist,
              y: canopyY + Math.sin(angle) * dist * 0.5,
              vY: 0,
              targetY: groundY,
              needsPositioning: false,
            };
          };
          for (let k = 0; k < 5 - totalHanging; k++) {
            if (treeIndices.length === 0) break;
            const treeIdx =
              treeIndices[Math.floor(Math.random() * treeIndices.length)];
            const tree = obstaclesWithReplacements[treeIdx];
            if (tree.type !== EntityType.TREE) continue;
            const newA = makeAppleForTree(tree);
            obstaclesWithReplacements = obstaclesWithReplacements.map(
              (ob, i) =>
                i === treeIdx && ob.type === EntityType.TREE
                  ? { ...ob, apples: [...(ob.apples ?? []), newA] }
                  : ob,
            );
          }

          const PICKUP_RADIUS = SCALE * 14;
          let finalObstacles = obstaclesWithReplacements;
          let finalSprites = source.sprites;

          obstaclesWithReplacements.forEach((ob) => {
            if (ob.type !== EntityType.TREE || !ob.apples?.length) return;
            ob.apples.forEach((apple) => {
              if (apple.state !== "onGround") return;
              const nearbySprite = finalSprites.find((s) => {
                const sw =
                  s.isCustom && s.customSprite
                    ? s.customSprite.dimensions.width * SCALE
                    : SPRITE_SIZE.w;
                const sh =
                  s.isCustom && s.customSprite
                    ? s.customSprite.dimensions.height * SCALE
                    : SPRITE_SIZE.h;
                const dist = Math.sqrt(
                  Math.pow(s.x + sw / 2 - apple.x, 2) +
                    Math.pow(s.y + sh - apple.y, 2),
                );
                return dist < PICKUP_RADIUS;
              });
              if (nearbySprite) {
                playEatingSound();
                finalSprites = finalSprites.map((spr) =>
                  spr.id === nearbySprite.id
                    ? {
                        ...spr,
                        speechBubble: "🍎",
                        speechBubbleTimer: now + 2500,
                      }
                    : spr,
                );
                finalObstacles = finalObstacles.map((t) =>
                  t.id === ob.id && t.type === EntityType.TREE
                    ? { ...t, apples: t.apples!.filter((a) => a !== apple) }
                    : t,
                );
              }
            });
          });

          gameStateRef.current.obstacles = finalObstacles;
          gameStateRef.current.sprites = finalSprites;

          return { ...prev, obstacles: finalObstacles, sprites: finalSprites };
        });
      }, 100);

      return () => clearInterval(interval);
    }, []);

    return (
      <div className="relative w-full h-full bg-black overflow-hidden">
        {/* Vignette Overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background:
              "radial-gradient(circle, rgba(0,0,0,0) 60%, rgba(0,0,0,0.4) 100%)",
          }}
        ></div>

        <canvas
          ref={canvasRef}
          width={GAME_WIDTH}
          height={GAME_HEIGHT}
          className="w-full h-full block"
          style={{ imageRendering: "pixelated" }}
        />

        {/* Start Overlay: world + saved data ready before map is shown */}
        {!isPlaying && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60 z-20">
            <div
              className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin"
              aria-hidden
            />
            <p className="text-white font-mono text-lg">
              Initializing World...
            </p>
          </div>
        )}
      </div>
    );
  },
);

GameCanvas.displayName = "GameCanvas";

export default GameCanvas;
