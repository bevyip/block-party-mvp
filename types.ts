export interface SpriteMatrix {
  front: string[][];
  back: string[][];
  left: string[][];
  right: string[][];
}

// Sprite generation types
export interface SpriteResult {
  matrix: SpriteMatrix;
  type: "humanoid" | "object" | "wide_object" | "tall_object" | "square_object";
  dimensions: {
    width: number;
    height: number;
  };
  palette: string[];
}

export enum ProcessingStatus {
  IDLE = "IDLE",
  PROCESSING = "PROCESSING",
  COMPLETE = "COMPLETE",
  ERROR = "ERROR",
}

/** localStorage key for saved custom creations (views only). */
export const CREATIONS_STORAGE_KEY = "block-party-creations";

/** Max saved creations to avoid localStorage and memory bloat (OOM). */
export const MAX_SAVED_CREATIONS = 50;
