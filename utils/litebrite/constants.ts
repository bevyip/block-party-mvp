export const SCALE = 3;

export const LITEBRITE_SPRITE_BASE = {
  w: 24,
  h: 40,
} as const;

// Standard sprite rendered height — matches new SPRITE_SIZE.h (16 * SCALE * 1.5)
const STANDARD_SPRITE_RENDERED_H = 16 * SCALE * 1.5;
export const LITEBRITE_DISPLAY_SCALE =
  STANDARD_SPRITE_RENDERED_H / (LITEBRITE_SPRITE_BASE.h * SCALE);

/**
 * Canonical Lite-Brite peg palette.
 * Hex values are chosen to contrast well against the game's green grass
 * environment (GRASS_BASE: #63c74d, GRASS_DARK: #50aa3f).
 * Gemini only identifies which color names are present — it never defines hex.
 * All hex values come exclusively from this table.
 */
export const LITEBRITE_PALETTE: Record<string, { hex: string; names: string[] }> = {
  P: {
    hex: '#ff5ecb',
    names: ['pink', 'hot pink', 'magenta', 'rose', 'coral', 'salmon'],
  },
  R: {
    hex: '#e81c2a',
    names: ['red', 'crimson', 'scarlet', 'dark red'],
  },
  B: {
    hex: '#1a6fff',
    names: ['blue', 'dark blue', 'navy', 'cobalt'],
  },
  G: {
    hex: '#0a7d32',
    names: ['green', 'dark green', 'lime', 'emerald'],
  },
  Y: {
    hex: '#ffe600',
    names: ['yellow', 'gold', 'amber'],
  },
  W: {
    hex: '#f0f0f0',
    names: ['white', 'light', 'bright'],
  },
  O: {
    hex: '#ff8c00',
    names: ['orange', 'tangerine'],
  },
};

/**
 * Resolves a Gemini color name string to a canonical palette code.
 * Exact match (primary name) is tried first so e.g. "pink" never resolves to "red".
 * Returns null if no match found.
 */
export const resolveColorCode = (colorName: string): string | null => {
  const normalized = colorName.toLowerCase().trim();

  // Exact match first
  for (const [code, entry] of Object.entries(LITEBRITE_PALETTE)) {
    if (entry.names[0] === normalized) return code;
  }
  // Then partial match
  for (const [code, entry] of Object.entries(LITEBRITE_PALETTE)) {
    if (entry.names.some(n => normalized.includes(n) || n.includes(normalized))) {
      return code;
    }
  }
  return null;
};
