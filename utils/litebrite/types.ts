// ─────────────────────────────────────────────────────────
// Lite-Brite Sprite Converter – Shared Types
// ─────────────────────────────────────────────────────────

/** One color entry returned by Gemini Stage 1 */
export interface DetectedColor {
  /** Human-readable name, e.g. "red", "dark green" */
  name: string;
  /** Best-guess hex for the peg color, e.g. "#cc0000" */
  hex: string;
  /** Single uppercase letter used as a code in the character grid */
  code: string;
}

/** Output of Gemini Stage 1 – semantic understanding */
export interface SemanticAnalysis {
  /** What the creation depicts, e.g. "a flower with stem and leaf" */
  subject: string;
  /** All peg colors found on the board */
  colors: DetectedColor[];
  /** Best-guess peg grid size of the *content only* (not full 30×30 board) */
  estimatedRows: number;
  estimatedCols: number;
}

/** Output of Gemini Stage 2 – character grid */
export interface GridAnalysis {
  /**
   * Array of strings, one per row.
   * Each character is either a color code (e.g. "R", "G") or "." for empty.
   * Represents only the tight bounding box around the content.
   */
  grid: string[];
  /** Maps each code letter → hex color */
  colorMap: Record<string, string>;
}

/** Final validated peg grid – 2D array, null = transparent */
export type PegGrid = (string | null)[][];

/** The four directional views making up a sprite */
export interface SpriteViews {
  front: PegGrid;
  back: PegGrid;
  left: PegGrid;
  right: PegGrid;
}

/** Full result returned by the LiteBriteConverter orchestrator */
export interface LiteBriteConversionResult {
  views: SpriteViews;
  /** Base sprite dimensions in pixels (before SCALE multiplication) */
  dimensions: { width: number; height: number };
  /** What Gemini identified the creation as */
  subject: string;
  /** Colors detected */
  colors: DetectedColor[];
}
