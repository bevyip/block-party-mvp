import {
  ASSETS,
  BRIDGE_ROW,
  HOUSE_COL,
  HOUSE_ROW,
  HOUSE_ENTRANCE_COL,
  HOUSE_ENTRANCE_ROW,
  HOUSE_H,
  HOUSE_W,
  MAP_COLS,
  MAP_ROWS,
  RIVER_PATH,
  TILE_SIZE,
  type Tile,
  type TileType,
} from "./mapData";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length - 1)]!;
}

function chebyshev(c1: number, r1: number, c2: number, r2: number): number {
  return Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));
}

function naturalOffset(
  _col: number,
  _row: number,
  spreadFactor = 0.6,
): { offsetX: number; offsetY: number; scale: number } {
  const range = TILE_SIZE * spreadFactor;
  const offsetX = (Math.random() - 0.5) * range;
  const offsetY = (Math.random() - 0.5) * range;
  const scale = 0.85 + Math.random() * 0.3;
  return { offsetX, offsetY, scale };
}

function riverCells(): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    const c = RIVER_PATH[r]!;
    out.push([c, r], [c + 1, r]);
  }
  return out;
}

function minDistToRiver(col: number, row: number): number {
  let m = 999;
  for (const [c, r] of riverCells()) {
    m = Math.min(m, chebyshev(col, row, c, r));
  }
  return m;
}

function houseFootprint(): [number, number][] {
  const cells: [number, number][] = [];
  for (let dr = 0; dr < HOUSE_H; dr++) {
    for (let dc = 0; dc < HOUSE_W; dc++) {
      cells.push([HOUSE_COL + dc, HOUSE_ROW + dr]);
    }
  }
  return cells;
}

function minDistToHouse(col: number, row: number): number {
  let m = 999;
  for (const [c, r] of houseFootprint()) {
    m = Math.min(m, chebyshev(col, row, c, r));
  }
  return m;
}

function minDistToEdges(col: number, row: number): number {
  return Math.min(col, row, MAP_COLS - 1 - col, MAP_ROWS - 1 - row);
}

function bridgeCells(): [number, number][] {
  const c = RIVER_PATH[BRIDGE_ROW]!;
  return [
    [c, BRIDGE_ROW],
    [c + 1, BRIDGE_ROW],
  ];
}

function minDistToBridge(col: number, row: number): number {
  let m = 999;
  for (const [c, r] of bridgeCells()) {
    m = Math.min(m, chebyshev(col, row, c, r));
  }
  return m;
}

function waterVariantAsset(): string {
  const u = Math.random() * 100;
  if (u < 60) return ASSETS.water;
  const variants = [
    ASSETS.water_lily,
    ASSETS.water_lily1,
    ASSETS.water_lily2,
    ASSETS.water_shrub,
  ] as const;
  return pick([...variants]);
}

function makeGrassTile(): Tile {
  return {
    type: "grass",
    walkable: true,
    asset: Math.random() < 0.5 ? ASSETS.grass1 : ASSETS.grass2,
  };
}

/** 1 tile buffer from river, 2 from house, 1 from map edges. */
function pondOk(c: number, r: number): boolean {
  return (
    minDistToRiver(c, r) >= 2 &&
    minDistToHouse(c, r) >= 3 &&
    minDistToEdges(c, r) >= 1
  );
}

function isLeftOfRiver(col: number, row: number): boolean {
  return col < RIVER_PATH[row]!;
}

function isRightOfRiver(col: number, row: number): boolean {
  return col > RIVER_PATH[row]! + 1;
}

function pondOkTier(c: number, r: number, tier: 0 | 1 | 2): boolean {
  if (tier === 0) return pondOk(c, r);
  if (tier === 1) {
    return (
      minDistToRiver(c, r) >= 1 &&
      minDistToHouse(c, r) >= 2 &&
      minDistToEdges(c, r) >= 1
    );
  }
  return minDistToRiver(c, r) >= 1 && minDistToHouse(c, r) >= 1;
}

function collectPondSideCandidates(
  grid: Tile[][],
  side: "left" | "right",
  tier: 0 | 1 | 2,
): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (grid[r]![c]!.type !== "grass") continue;
      if (side === "left" && !isLeftOfRiver(c, r)) continue;
      if (side === "right" && !isRightOfRiver(c, r)) continue;
      if (!pondOkTier(c, r, tier)) continue;
      out.push([c, r]);
    }
  }
  return out;
}

/** One pond west and one east of the river for this row’s channel (guaranteed if any grass exists on that side). */
function pickPondSide(grid: Tile[][], side: "left" | "right"): [number, number] {
  for (const tier of [0, 1, 2] as const) {
    const cands = collectPondSideCandidates(grid, side, tier);
    if (cands.length > 0) return pick(cands);
  }
  const loose: [number, number][] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (grid[r]![c]!.type !== "grass") continue;
      if (side === "left" && !isLeftOfRiver(c, r)) continue;
      if (side === "right" && !isRightOfRiver(c, r)) continue;
      loose.push([c, r]);
    }
  }
  if (loose.length > 0) return pick(loose);
  const anyGrass: [number, number][] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (grid[r]![c]!.type === "grass") anyGrass.push([c, r]);
    }
  }
  return pick(anyGrass);
}

/**
 * River surface tiles (plain water, lily, shrub, etc.) directly under a grass tile
 * must use the bank graphic. Preserves walkable (bridge crossing stays walkable).
 */
const RIVER_SURFACE_TYPES_FOR_BANK: ReadonlySet<TileType> = new Set([
  "water",
  "water_lily",
  "water_lily1",
  "water_lily2",
  "water_shrub",
  "water_shrub1",
  "water_shrub2",
]);

function assignWaterEdges(grid: Tile[][]) {
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const tile = grid[row]![col]!;
      if (!RIVER_SURFACE_TYPES_FOR_BANK.has(tile.type)) continue;

      const above = row > 0 ? grid[row - 1]![col]! : null;
      const grassAbove = above != null && above.type === "grass";
      if (grassAbove) {
        const keepWalkable = tile.walkable;
        tile.type = "water_top";
        tile.asset = ASSETS.water_top;
        tile.walkable = keepWalkable;
      }
    }
  }
}

export function generateMap(): Tile[][] {
  const grid: Tile[][] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < MAP_COLS; c++) {
      row.push(makeGrassTile());
    }
    grid.push(row);
  }

  for (let r = 0; r < MAP_ROWS; r++) {
    const c0 = RIVER_PATH[r]!;
    for (const c of [c0, c0 + 1]) {
      const wt = waterVariantAsset();
      const t: TileType =
        wt === ASSETS.water
          ? "water"
          : wt === ASSETS.water_lily
            ? "water_lily"
            : wt === ASSETS.water_lily1
              ? "water_lily1"
              : wt === ASSETS.water_lily2
                ? "water_lily2"
                : wt === ASSETS.water_shrub
                  ? "water_shrub"
                  : "water";
      grid[r]![c] = {
        type: t,
        walkable: false,
        asset: wt,
      };
    }
  }

  const pondTile = (): Tile => ({
    type: "pond",
    walkable: false,
    asset: ASSETS.pond,
  });
  const [lc, lr] = pickPondSide(grid, "left");
  grid[lr]![lc] = pondTile();
  const [rc, rr] = pickPondSide(grid, "right");
  grid[rr]![rc] = pondTile();

  const bc = RIVER_PATH[BRIDGE_ROW]!;
  for (const c of [bc, bc + 1]) {
    grid[BRIDGE_ROW]![c] = {
      type: "water",
      walkable: true,
      asset: ASSETS.water,
    };
  }

  for (let dr = 0; dr < HOUSE_H; dr++) {
    for (let dc = 0; dc < HOUSE_W; dc++) {
      const c = HOUSE_COL + dc;
      const r = HOUSE_ROW + dr;
      grid[r]![c] = {
        type: "house_body",
        walkable: false,
        asset: ASSETS.house_close,
      };
    }
  }

  grid[HOUSE_ENTRANCE_ROW]![HOUSE_ENTRANCE_COL] = {
    type: "house_entrance",
    walkable: true,
    trigger: "enter_house",
    asset: Math.random() < 0.5 ? ASSETS.grass1 : ASSETS.grass2,
  };

  const occupied = new Set<string>();
  const mark = (c: number, r: number) => occupied.add(`${c},${r}`);
  const isOcc = (c: number, r: number) => occupied.has(`${c},${r}`);

  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const t = grid[r]![c]!;
      if (!t.walkable || t.type !== "grass") mark(c, r);
      if (
        t.type === "pond" ||
        t.type === "water" ||
        t.type === "water_top" ||
        t.type === "bridge"
      )
        mark(c, r);
    }
  }
  for (const [c, r] of houseFootprint()) mark(c, r);
  mark(HOUSE_ENTRANCE_COL, HOUSE_ENTRANCE_ROW);

  function canPlaceTreeHere(c: number, r: number): boolean {
    if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) return false;
    if (grid[r]![c]!.type !== "grass" || !grid[r]![c]!.walkable) return false;
    if (isOcc(c, r)) return false;
    if (minDistToRiver(c, r) < 2) return false;
    if (minDistToHouse(c, r) < 3) return false;
    if (minDistToBridge(c, r) < 2) return false;
    return true;
  }

  function treePlacementCandidates(): [number, number][] {
    const out: [number, number][] = [];
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (canPlaceTreeHere(c, r)) out.push([c, r]);
      }
    }
    return out;
  }

  function tryClusterSmallNearLarge(col: number, row: number) {
    const clusterAttempts = randomInt(1, 2);
    for (let i = 0; i < clusterAttempts; i++) {
      const dc = randomInt(-1, 1);
      const dr = randomInt(-1, 1);
      if (dc === 0 && dr === 0) continue;
      const nc = col + dc;
      const nr = row + dr;
      if (!canPlaceTreeHere(nc, nr)) continue;
      placeSmallTreeAt(nc, nr);
    }
  }

  function placeLargeTreeAt(
    c: number,
    r: number,
    color: "green" | "red" | "yellow",
  ) {
    const asset =
      color === "green"
        ? ASSETS.green_t1
        : color === "red"
          ? ASSETS.red_t1
          : ASSETS.yellow_t1;
    const nat = naturalOffset(c, r, 0.5);
    grid[r]![c] = {
      type: "tree_large",
      walkable: false,
      asset,
      offsetX: nat.offsetX,
      offsetY: nat.offsetY,
      scale: nat.scale,
      collisionOffsetY: 0.65,
      collisionHeight: 0.35,
    };
    mark(c, r);
    tryClusterSmallNearLarge(c, r);
  }

  function placeSmallTreeAt(c: number, r: number) {
    const color = pick(["green", "red", "yellow"] as const);
    const tier = Math.random() < 0.5 ? "t2" : "t3";
    let asset: string;
    if (color === "green")
      asset = tier === "t2" ? ASSETS.green_t2 : ASSETS.green_t3;
    else if (color === "red")
      asset = tier === "t2" ? ASSETS.red_t2 : ASSETS.red_t3;
    else asset = tier === "t2" ? ASSETS.yellow_t2 : ASSETS.yellow_t3;
    const nat = naturalOffset(c, r, 0.7);
    grid[r]![c] = {
      type: "tree_small",
      walkable: false,
      asset,
      offsetX: nat.offsetX,
      offsetY: nat.offsetY,
      scale: nat.scale,
      collisionOffsetY: 0.5,
      collisionHeight: 0.5,
    };
    mark(c, r);
  }

  /** Tight grove: anchor + 2–5 neighbors within Chebyshev distance 2. */
  function tryPlaceTreeClump(): boolean {
    const candidates = treePlacementCandidates();
    if (candidates.length === 0) return false;
    const [ac, ar] = pick(candidates);
    if (Math.random() < 0.42) {
      placeLargeTreeAt(ac, ar, pick(["green", "red", "yellow"] as const));
    } else {
      placeSmallTreeAt(ac, ar);
    }

    const offsets: [number, number][] = [];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dc === 0 && dr === 0) continue;
        if (chebyshev(0, 0, dc, dr) <= 2) offsets.push([dc, dr]);
      }
    }
    for (let i = offsets.length - 1; i > 0; i--) {
      const j = randomInt(0, i);
      [offsets[i], offsets[j]] = [offsets[j]!, offsets[i]!];
    }

    const extra = randomInt(2, 5);
    let placed = 0;
    for (const [dc, dr] of offsets) {
      if (placed >= extra) break;
      const c = ac + dc;
      const r = ar + dr;
      if (!canPlaceTreeHere(c, r)) continue;
      if (Math.random() < 0.38) {
        placeLargeTreeAt(c, r, pick(["green", "red", "yellow"] as const));
      } else {
        placeSmallTreeAt(c, r);
      }
      placed++;
    }
    return true;
  }

  function tryPlaceLargeTree(): boolean {
    const candidates = treePlacementCandidates();
    if (candidates.length === 0) return false;
    const [c, r] = pick(candidates);
    placeLargeTreeAt(c, r, pick(["green", "red", "yellow"] as const));
    return true;
  }

  const nLarge = randomInt(7, 9);
  for (let i = 0; i < nLarge; i++) tryPlaceLargeTree();

  const nClumps = randomInt(5, 8);
  for (let i = 0; i < nClumps; i++) tryPlaceTreeClump();

  function tryPlaceSmallTree(): boolean {
    const candidates = treePlacementCandidates();
    if (candidates.length === 0) return false;
    const [c, r] = pick(candidates);
    placeSmallTreeAt(c, r);
    return true;
  }

  const nSmall = randomInt(8, 10);
  for (let i = 0; i < nSmall; i++) tryPlaceSmallTree();

  function tryPlaceRock(): boolean {
    const candidates: [number, number][] = [];
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (grid[r]![c]!.type !== "grass" || !grid[r]![c]!.walkable) continue;
        if (isOcc(c, r)) continue;
        if (minDistToRiver(c, r) < 2) continue;
        candidates.push([c, r]);
      }
    }
    if (candidates.length === 0) return false;
    const [c, r] = pick(candidates);
    const asset = pick([ASSETS.rock1, ASSETS.rock2, ASSETS.rock3] as const);
    const nat = naturalOffset(c, r, 0.8);
    grid[r]![c] = {
      type: "rock",
      walkable: false,
      asset,
      offsetX: nat.offsetX,
      offsetY: nat.offsetY,
      scale: nat.scale,
    };
    mark(c, r);
    return true;
  }

  const nRocks = randomInt(5, 7);
  for (let i = 0; i < nRocks; i++) tryPlaceRock();

  const largeTreeCells: [number, number][] = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (grid[r]![c]!.type === "tree_large") largeTreeCells.push([c, r]);
    }
  }

  function nearLargeTree(c: number, r: number): boolean {
    for (const [tc, tr] of largeTreeCells) {
      if (chebyshev(c, r, tc, tr) <= 2) return true;
    }
    return false;
  }

  const nApples = randomInt(8, 10);
  let placedApple = 0;
  let appleAttempts = 0;
  while (placedApple < nApples && appleAttempts < 400) {
    appleAttempts++;
    const c = randomInt(0, MAP_COLS - 1);
    const r = randomInt(0, MAP_ROWS - 1);
    const cell = grid[r]![c]!;
    if (cell.type !== "grass" || !cell.walkable) continue;
    if (cell.objectAsset) continue;
    if (!nearLargeTree(c, r)) continue;
    const nat = naturalOffset(c, r, 0.85);
    cell.objectAsset = ASSETS.apple;
    cell.offsetX = nat.offsetX;
    cell.offsetY = nat.offsetY;
    cell.scale = nat.scale;
    placedApple++;
  }

  assignWaterEdges(grid);

  return grid;
}
