import {
  HOUSE_ENTRANCE_COL,
  HOUSE_ENTRANCE_ROW,
  TILE_SIZE,
} from "./mapData";

type SpriteLike = { x: number; y: number; insideHouse: boolean };

export type DoorPhase =
  | "closed"
  | "opening"
  | "open"
  | "closing_in"
  | "inside"
  | "opening_out"
  | "open_out"
  | "closing_out";

export type HouseState = {
  phase: DoorPhase;
  phaseTimer: number;
};

export const DOOR_PHASE_DURATION: Record<DoorPhase, number> = {
  closed: 0,
  opening: 800,
  /** Initial timer when entering `open` (map page keeps door open until enter/leave, no decay). */
  open: 0,
  closing_in: 800,
  inside: 0,
  opening_out: 800,
  open_out: 600,
  closing_out: 800,
};

export function updateHouseState(
  hs: HouseState,
  sprites: SpriteLike[],
  dt: number,
): HouseState {
  const entranceCx = HOUSE_ENTRANCE_COL * TILE_SIZE + TILE_SIZE / 2;
  const entranceCy = HOUSE_ENTRANCE_ROW * TILE_SIZE + TILE_SIZE / 2;
  const spriteNearDoor = sprites.some(
    (s) =>
      !s.insideHouse &&
      Math.hypot(s.x - entranceCx, s.y - entranceCy) < TILE_SIZE * 1.06,
  );
  const spriteInsideHouse = sprites.some((s) => s.insideHouse);

  const tick = (t: number) => t - dt;

  switch (hs.phase) {
    case "closed":
      if (spriteNearDoor) {
        return {
          phase: "opening",
          phaseTimer: DOOR_PHASE_DURATION.opening,
        };
      }
      return hs;

    case "opening": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return { phase: "open", phaseTimer: DOOR_PHASE_DURATION.open };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "open": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return {
          phase: "closing_in",
          phaseTimer: DOOR_PHASE_DURATION.closing_in,
        };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "closing_in": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return { phase: "inside", phaseTimer: 0 };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "inside":
      if (!spriteInsideHouse) {
        return {
          phase: "opening_out",
          phaseTimer: DOOR_PHASE_DURATION.opening_out,
        };
      }
      return hs;

    case "opening_out": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return { phase: "open_out", phaseTimer: DOOR_PHASE_DURATION.open_out };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "open_out": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return {
          phase: "closing_out",
          phaseTimer: DOOR_PHASE_DURATION.closing_out,
        };
      }
      return { ...hs, phaseTimer: nt };
    }

    case "closing_out": {
      const nt = tick(hs.phaseTimer);
      if (nt <= 0) {
        return { phase: "closed", phaseTimer: 0 };
      }
      return { ...hs, phaseTimer: nt };
    }

    default:
      return hs;
  }
}
