export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export enum EntityType {
  TREE = 'TREE',
  ROCK = 'ROCK',
  FLOWER = 'FLOWER',
  RIVER_SEGMENT = 'RIVER_SEGMENT',
  BRIDGE = 'BRIDGE',
  GRASS_PATCH = 'GRASS_PATCH',
}

export interface Obstacle {
  id: string;
  type: EntityType;
  bounds: Rect; // The collision box
  renderBounds: Rect; // The drawing area (can be larger than collision, e.g., tree top)
  variant: number; // For visual variety
  // Only relevant when type is FLOWER
  flowerStage?: 1 | 2 | 3;
  flowerGrowthTimer?: number; // timestamp (Date.now()) when this flower next advances
  // Only relevant when type is TREE — multiple apples per tree
  apples?: TreeApple[];
}

export interface TreeApple {
  state: "hanging" | "falling" | "onGround";
  timer?: number; // timestamp for next state transition
  x: number;
  y: number;
  vY: number;
  targetY: number;
  needsPositioning?: boolean;
}

export interface SpriteMatrix {
  front: string[][];
  back: string[][];
  left: string[][];
  right: string[][];
}

export interface Sprite {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string; // Shirt color (for default sprites)
  hairColor: string;
  pantsColor: string;
  skinTone: string;
  interactionCooldown: number;
  bubble?: {
    text: string;
    life: number; // Frames remaining
  };
  facing: 'left' | 'right' | 'front';
  bobOffset: number; // For walking animation
  
  // State fields
  state: 'idle' | 'moving';
  stateTimer: number; // How long to remain in current state

  speechBubble?: string;
  speechBubbleTimer?: number;
  // Custom sprite data (from uploaded images)
  isCustom?: boolean;
  customSprite?: {
    matrix: SpriteMatrix;
    dimensions: {
      width: number;
      height: number;
    };
  };
}

export interface Fish {
  id: number;
  x: number;
  y: number;
  color: string;
  speed: number;
  direction: 1 | -1; // 1 = down, -1 = up
  facingRight: boolean; // Orientation
  wiggleOffset: number;
  riverOffset: number; // Offset from river center to vary position
}

export interface GameState {
  sprites: Sprite[];
  obstacles: Obstacle[];
  fish: Fish[];
}

// Sprite generation types
export interface SpriteResult {
  matrix: SpriteMatrix;
  type: 'humanoid' | 'object' | 'wide_object' | 'tall_object' | 'square_object';
  dimensions: {
    width: number;
    height: number;
  };
  palette: string[];
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}

/** localStorage key for saved custom creations (views only). */
export const CREATIONS_STORAGE_KEY = 'block-party-creations';

/** Max saved creations to avoid localStorage and memory bloat (OOM). */
export const MAX_SAVED_CREATIONS = 50;

export interface ProcessingState {
  status: ProcessingStatus;
  error?: string;
}

