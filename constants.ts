/** Left tools panel: MapPage on `/` and `/admin` (not on standalone `/map`). */
export const SIDE_PANEL_EXPAND_W = 44;
export const PANEL_WIDTH_MS = 360;
export const PANEL_WIDTH_EASING = "cubic-bezier(0.32, 0.72, 0.22, 1)";
export const PANEL_CONTENT_FADE_MS = 220;

/** Particle splay duration on the map (then hold blank canvas until overlay completes). */
export const ADD_TO_PARTY_SPLAY_MS = 2650;
/**
 * Map add-to-party: after three chambers fill, wait this long before broadcasting
 * `add_to_party_splay` so the Roman rings can rest before the particle burst.
 */
export const ADD_TO_PARTY_PREFACE_MS = 1200;
/** Map `/` + SidePanel: opacity ease-in for the fullscreen Add-to-Party layer (MapPage wrapper). */
export const ADD_TO_PARTY_OVERLAY_ENTRANCE_MS = 520;

// Internal resolution (Retro style, scaled up for crispness)
export const SCALE = 3;
export const GAME_WIDTH = 480 * SCALE; // 1440
export const GAME_HEIGHT = 270 * SCALE; // 810

export const PALETTE = {
  GRASS_BASE: '#63c74d',
  GRASS_DARK: '#50aa3f', // texturing
  RIVER: '#4da6ff',
  
  // Detailed Tree Palette - Darker & Earthier
  TREE_TRUNK_DARK: '#3e2723',
  TREE_TRUNK_DARKEST: '#1a0f0a',
  TREE_TRUNK_MID: '#5d4037',
  TREE_TRUNK_LIGHT: '#8d6e63',
  TREE_LEAVES_DARKEST: '#1a2f14',
  TREE_LEAVES_DARK: '#2d4c1e',
  TREE_LEAVES_MID: '#48752c',
  TREE_LEAVES_LIGHT: '#6da046',
  
  // Rock Palette
  ROCK_SHADOW: '#3a3a3a',
  ROCK_BASE: '#7a7a7a',
  ROCK_HIGHLIGHT: '#a0a0a0',
  ROCK_HIGHLIGHT_BRIGHT: '#b8b8b8',
  
  FLOWER_PETAL: '#ff0044',
  FLOWER_CENTER: '#ffff00',
};

// Updated size: 8x16 pixels (classic ratio), scaled 1.5x for world objects
export const SPRITE_SIZE = { w: 8 * SCALE * 1.5, h: 16 * SCALE * 1.5 };
export const SPRITE_COUNT = 10; // Start with 10 sprites
