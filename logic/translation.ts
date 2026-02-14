import { SpriteResult, SpriteMatrix } from "../types";
import OptimizedLiteBriteConverter from "../utils/conversion/optimized_sparse_converter.js";
import GeminiSpriteConverter from "../utils/conversion/gemini_sprite_converter.js";
import { fileToBase64, getImageDimensions } from "../utils/imageUtils.js";

/** Gemini API key from env (Vite exposes VITE_*). Undefined if not set. */
const getGeminiApiKey = (): string | undefined => {
  const env = (typeof import.meta !== "undefined" && (import.meta as { env?: { VITE_GEMINI_API_KEY?: string } }).env) ?? {};
  const key = env.VITE_GEMINI_API_KEY;
  return typeof key === "string" ? key.trim() : undefined;
};

// --- Color Helpers ---

const rgbaToHex = (r: number, g: number, b: number, a: number): string => {
  if (a < 50) return "transparent"; // Alpha threshold
  const toHex = (n: number) => {
    const hex = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  if (!hex || hex === "transparent" || hex.startsWith("#00000000")) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
};

const colorDistance = (
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number }
) => {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
      Math.pow(c1.g - c2.g, 2) +
      Math.pow(c1.b - c2.b, 2)
  );
};


// --- Processing Pipeline Steps ---

/**
 * 1. Robust Background Removal via Flood Fill
 * Starts from corners. If corners are transparent or similar in color, floods inwards.
 */
const removeBackgroundFloodFill = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const tolerance = 40; // Tolerance for background color variation (e.g. compression artifacts)
  const visited = new Uint8Array(width * height);
  const queue: [number, number][] = [];

  // Identify start points (corners)
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];

  corners.forEach(([x, y]) => {
    const idx = (y * width + x) * 4;
    // If it's already transparent, it's a valid start.
    // If it's opaque, we treat the corner color as the "key" to remove.
    queue.push([x, y]);
  });

  const getIdx = (x: number, y: number) => (y * width + x) * 4;

  while (queue.length > 0) {
    const [cx, cy] = queue.pop()!;
    const cIdx = getIdx(cx, cy);

    if (visited[cy * width + cx]) continue;
    visited[cy * width + cx] = 1;

    // Get current pixel color
    const r = data[cIdx];
    const g = data[cIdx + 1];
    const b = data[cIdx + 2];
    const a = data[cIdx + 3];

    // Mark as transparent
    data[cIdx + 3] = 0;

    // Check neighbors
    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (visited[ny * width + nx]) continue;

        const nIdx = getIdx(nx, ny);
        const nr = data[nIdx];
        const ng = data[nIdx + 1];
        const nb = data[nIdx + 2];
        const na = data[nIdx + 3];

        // If neighbor is already transparent, continue flooding
        if (na < 50) {
          queue.push([nx, ny]);
          continue;
        }

        // If neighbor is similar to the current pixel (which was background), remove it too
        // Note: We compare to the *current* pixel being removed to handle gradients
        const dist = Math.sqrt((r - nr) ** 2 + (g - ng) ** 2 + (b - nb) ** 2);

        if (dist < tolerance) {
          queue.push([nx, ny]);
        }
      }
    }
  }
};

/**
 * 2. Auto-Crop to Silhouette
 * Finds the bounding box of non-transparent pixels to maximize resolution usage.
 */
const getContentBounds = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  let minX = width,
    minY = height,
    maxX = 0,
    maxY = 0;
  let hasContent = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 50) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        hasContent = true;
      }
    }
  }

  if (!hasContent) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

/**
 * 3. Edge-Weighted Smart Downsampling
 * Biases sampling towards edges to preserve silhouette definition.
 */
const smartDownsample = (
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  targetW: number,
  targetH: number
): string[][] => {
  const sourceData = ctx.getImageData(
    bounds.x,
    bounds.y,
    bounds.w,
    bounds.h
  ).data;
  const result: string[][] = [];

  const cellW = bounds.w / targetW;
  const cellH = bounds.h / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    const row: string[] = [];
    for (let tx = 0; tx < targetW; tx++) {
      // Define source block
      const startX = Math.floor(tx * cellW);
      const startY = Math.floor(ty * cellH);
      const endX = Math.floor((tx + 1) * cellW);
      const endY = Math.floor((ty + 1) * cellH);

      const histogram: Record<string, number> = {};
      let transparentCount = 0;
      let totalPixels = 0;
      let totalWeight = 0;

      for (let sy = startY; sy < endY; sy++) {
        for (let sx = startX; sx < endX; sx++) {
          if (sx >= bounds.w || sy >= bounds.h) continue;

          const i = (sy * bounds.w + sx) * 4;
          const a = sourceData[i + 3];

          if (a < 128) {
            transparentCount++;
            totalPixels++;
            totalWeight++;
          } else {
            const hex = rgbaToHex(
              sourceData[i],
              sourceData[i + 1],
              sourceData[i + 2],
              255
            );

            // EDGE AWARENESS:
            // If pixel is on the boundary of the sample cell, weigh it higher.
            // This prioritizes outline definition over interior texture.
            const isEdge =
              sx === startX ||
              sx === endX - 1 ||
              sy === startY ||
              sy === endY - 1;

            // Vertical semantic bias (top-heavy importance)
            // Pixels near the top (leaves, hats, hair, ears, stems) get extra weight
            const verticalNorm = sy / bounds.h; // 0 = top, 1 = bottom
            const topBias = verticalNorm < 0.25 ? 1.75 : 1; // boost top 25%

            const weight = (isEdge ? 2.5 : 1) * topBias;

            histogram[hex] = (histogram[hex] || 0) + weight;
            totalWeight += weight;
            totalPixels++;
          }
        }
      }

      // Decision Logic:
      // If majority is transparent, cell is transparent.
      if (transparentCount > totalPixels * 0.6) {
        row.push("transparent");
      } else {
        let maxColor = "transparent";
        let maxCount = 0;
        for (const [color, count] of Object.entries(histogram)) {
          if (count > maxCount) {
            maxCount = count;
            maxColor = color;
          }
        }
        row.push(maxColor === "transparent" ? "transparent" : maxColor);
      }
    }
    result.push(row);
  }
  return result;
};

/**
 * 4. Shape Inflation (Controlled Dilation)
 * Prevents "stick figure" collapse by thickening 1px lines if they have support.
 */
const inflateShape = (grid: string[][]) => {
  const h = grid.length;
  const w = grid[0].length;
  const out = grid.map((r) => [...r]);

  // First pass: Inflate silhouettes (heal gaps and thicken limbs)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (grid[y][x] !== "transparent") continue;

      const neighbors = [
        grid[y][x - 1],
        grid[y][x + 1],
        grid[y - 1][x],
        grid[y + 1][x],
      ].filter((c) => c && c !== "transparent");

      // If enclosed by at least 2 non-transparent neighbors, fill it.
      // This heals diagonal gaps and thickens limbs.
      if (neighbors.length >= 2) {
        out[y][x] = neighbors[0];
      }
    }
  }

  // Second pass: Inflate interior features slightly
  // This turns 1px eyes → 2px eyes, hairline smiles → readable curves
  // Still pixel-art, but much more legible
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (isInteriorFeature(grid, x, y)) {
        const color = grid[y][x];
        // Inflate in 4 directions (orthogonal only)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const ny = y + dy;
          const nx = x + dx;
          if (
            ny >= 0 &&
            ny < h &&
            nx >= 0 &&
            nx < w &&
            out[ny][nx] === "transparent"
          ) {
            out[ny][nx] = color;
          }
        }
      }
    }
  }

  return out;
};


/**
 * Check if pixel is on the edge (adjacent to transparency)
 * Used to determine if a pixel can be safely removed during cleanup
 */
const isEdgePixel = (grid: string[][], x: number, y: number): boolean => {
  const h = grid.length;
  const w = grid[0].length;

  // Check if any neighbor is transparent (edge of shape)
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];

  for (const [nx, ny] of neighbors) {
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
      return true; // Touches canvas edge
    }
    if (grid[ny][nx] === "transparent") {
      return true; // Adjacent to transparency
    }
  }

  return false; // Fully enclosed, not an edge
};

/**
 * Detect and Protect Interior Markings
 * Detects small, high-contrast regions fully enclosed by a dominant color.
 * Catches: eyes, mouths, buttons, symbols, logos, facial features
 */
const isInteriorFeature = (grid: string[][], x: number, y: number): boolean => {
  const color = grid[y][x];
  if (color === "transparent") return false;

  const neighbors = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const ny = y + dy;
      const nx = x + dx;
      if (ny < 0 || nx < 0 || ny >= grid.length || nx >= grid[0].length) {
        return false; // touches edge → silhouette
      }
      neighbors.push(grid[ny][nx]);
    }
  }

  const nonTransparent = neighbors.filter((n) => n !== "transparent");
  const sameColor = nonTransparent.filter((n) => n === color);

  return (
    nonTransparent.length >= 6 && sameColor.length <= 2 // mostly surrounded by other color
  );
};

/**
 * 6. Denoise with Thin Feature Protection
 */
const cleanupIslands = (grid: string[][]) => {
  const h = grid.length;
  const w = grid[0].length;
  const newGrid = grid.map((row) => [...row]);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = grid[y][x];
      if (color === "transparent") continue;

      // Count orthogonal neighbors
      let neighbors = 0;
      const left = x > 0 ? grid[y][x - 1] : "transparent";
      const right = x < w - 1 ? grid[y][x + 1] : "transparent";
      const up = y > 0 ? grid[y - 1][x] : "transparent";
      const down = y < h - 1 ? grid[y + 1][x] : "transparent";

      if (left !== "transparent") neighbors++;
      if (right !== "transparent") neighbors++;
      if (up !== "transparent") neighbors++;
      if (down !== "transparent") neighbors++;

      // PROTECT INTERIOR MARKINGS:
      // NEVER remove interior features (eyes, mouths, buttons, symbols, etc.)
      if (isInteriorFeature(grid, x, y)) {
        continue; // NEVER remove interior markings
      }

      // PROTECT THIN FEATURES:
      // If it's part of a vertical or horizontal line, keep it even if neighbor count is low (e.g. 2).
      // Vertical Run
      if (up === color && down === color) continue;
      // Horizontal Run
      if (left === color && right === color) continue;

      // Only remove truly lonely pixels that are on the edge
      // Interior pixels (eyes, dots, symbols, line art) should never be removed just for being small
      if (neighbors === 0 && isEdgePixel(grid, x, y)) {
        newGrid[y][x] = "transparent";
      }
    }
  }
  return newGrid;
};

/**
 * 7. Spatial Color Quantization
 * Favors colors that span larger areas (e.g. skin tone) over localized noise.
 */
const quantizeColors = (
  grid: string[][],
  maxColors: number = 6
): { grid: string[][]; palette: string[] } => {
  const colorCounts: Record<string, number> = {};
  const columnPresence: Record<string, Set<number>> = {};
  const protectedPixels: Record<string, number> = {}; // Track interior feature pixels

  // 1. Tally with Spatial Awareness and Interior Feature Detection
  grid.forEach((row, y) => {
    row.forEach((c, x) => {
      if (c !== "transparent") {
        colorCounts[c] = (colorCounts[c] || 0) + 1;

        if (!columnPresence[c]) columnPresence[c] = new Set();
        columnPresence[c].add(x);

        // Track if this pixel is a protected interior feature
        if (isInteriorFeature(grid, x, y)) {
          protectedPixels[c] = (protectedPixels[c] || 0) + 1;
        }
      }
    });
  });

  let palette = Object.keys(colorCounts);
  if (palette.length <= maxColors) return { grid, palette: palette.sort() };

  let rgbPalette = palette.map((hex) => ({ hex, ...hexToRgb(hex)! }));

  while (rgbPalette.length > maxColors) {
    let minDist = Infinity;
    let mergeIdxA = -1;
    let mergeIdxB = -1;

    // Find closest pair (with hue-distance guard)
    for (let i = 0; i < rgbPalette.length; i++) {
      for (let j = i + 1; j < rgbPalette.length; j++) {
        const colorA = rgbPalette[i];
        const colorB = rgbPalette[j];

        // Palette protection for distinct hue groups
        // Prevent merging strongly different hues (e.g. red vs green)
        const hueDistance = Math.abs(
          Math.atan2(colorA.g - colorA.b, colorA.r - colorA.b) -
            Math.atan2(colorB.g - colorB.b, colorB.r - colorB.b)
        );

        // Skip merging if hues are too different (prevents red/green merge, etc.)
        if (hueDistance > 1.2) continue;

        const d = colorDistance(colorA, colorB);
        if (d < minDist) {
          minDist = d;
          mergeIdxA = i;
          mergeIdxB = j;
        }
      }
    }

    const colorA = rgbPalette[mergeIdxA];
    const colorB = rgbPalette[mergeIdxB];

    // SPATIAL DOMINANCE BIAS + INTERIOR CONTRAST BONUS:
    // Instead of just raw pixel count, prefer the color that spans more columns.
    // This helps preserve skin tones vs clothing accessories.
    // Additionally, colors that appear in protected interior pixels get a huge bonus.
    const spanA = columnPresence[colorA.hex]?.size ?? 0;
    const spanB = columnPresence[colorB.hex]?.size ?? 0;

    // Interior contrast bonus: colors in protected interior features (eyes, mouths, etc.)
    const interiorBonusA = protectedPixels[colorA.hex] ?? 0;
    const interiorBonusB = protectedPixels[colorB.hex] ?? 0;

    // Scoring: Column Span (1000x) + Interior Bonus (2000x) + Raw Count (1x)
    // Interior features get massive priority to survive even if small
    const scoreA =
      spanA * 1000 + interiorBonusA * 2000 + colorCounts[colorA.hex];
    const scoreB =
      spanB * 1000 + interiorBonusB * 2000 + colorCounts[colorB.hex];

    const survivor = scoreA >= scoreB ? colorA : colorB;
    const victim = scoreA >= scoreB ? colorB : colorA;

    // Merge logic
    colorCounts[survivor.hex] += colorCounts[victim.hex];
    // Merge column sets
    columnPresence[victim.hex]?.forEach((col) =>
      columnPresence[survivor.hex]?.add(col)
    );

    rgbPalette = rgbPalette.filter((c) => c.hex !== victim.hex);

    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[0].length; x++) {
        if (grid[y][x] === victim.hex) {
          grid[y][x] = survivor.hex;
        }
      }
    }
  }

  return { grid, palette: rgbPalette.map((c) => c.hex).sort() };
};

/**
 * Minimum color survival rule
 * Guarantees that any color occupying a contiguous region survives in the palette.
 * Ensures palette reflects grid reality - if a color exists in the grid, it's in the palette.
 */
const enforceMinorRegionSurvival = (
  grid: string[][],
  palette: string[]
): string[] => {
  const seen = new Set<string>();
  grid.forEach((row) =>
    row.forEach((c) => {
      if (c !== "transparent") {
        seen.add(c);
      }
    })
  );

  // Ensure palette reflects grid reality - add any missing colors
  const finalPalette = Array.from(seen);
  // Sort for consistency
  return finalPalette.sort();
};

/**
 * 8. Ground Contact Enforcement
 * Ensures tall sprites don't float by extending the lowest pixel to the bottom.
 */
const reinforceGroundContact = (grid: string[][]) => {
  const h = grid.length;
  const w = grid[0].length;
  // Modifies grid in place
  for (let x = 0; x < w; x++) {
    // Find lowest opaque pixel in this column
    for (let y = h - 1; y >= 0; y--) {
      if (grid[y][x] !== "transparent") {
        // Force the bottom-most pixel of the grid to take this color
        // This anchors the feet.
        if (y < h - 1) {
          grid[h - 1][x] = grid[y][x];
          // Optional: Fill the gap?
          // grid[h - 2][x] = grid[y][x];
        }
        break; // Done with this column
      }
    }
  }
};

// --- Build final sprite from a front grid (shared by canvas pipeline and peg pipeline) ---

const buildSpriteResultFromFrontGrid = (
  frontGrid: string[][],
  targetW: number,
  targetH: number
): SpriteResult => {
  const ratio = targetW / targetH;
  let archetype: "wide_object" | "tall_object" | "square_object" = "square_object";
  let sideCompression = 0.5;

  if (ratio > 1.3) {
    archetype = "wide_object";
    sideCompression = 0.35;
  } else if (ratio < 0.75) {
    archetype = "tall_object";
    sideCompression = 0.65;
  }

  let grid = inflateShape(frontGrid);
  grid = cleanupIslands(grid);
  const { grid: finalFront, palette: quantizedPalette } = quantizeColors(grid, 6);
  const finalPalette = enforceMinorRegionSurvival(finalFront, quantizedPalette);

  if (archetype === "tall_object") {
    reinforceGroundContact(finalFront);
  }

  const backGrid = finalFront.map((row) => [...row].reverse());

  const resampleRow = (row: string[], width: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < width; i++) {
      const srcX = Math.floor(i * (row.length / width));
      out.push(row[srcX]);
    }
    return out;
  };

  const sideWidth = Math.max(4, Math.ceil(targetW * sideCompression));
  const leftGrid = finalFront.map((row) => resampleRow(row, sideWidth));
  const rightGrid = leftGrid.map((row) => [...row].reverse());

  return {
    matrix: {
      front: finalFront,
      back: backGrid,
      left: leftGrid,
      right: rightGrid,
    },
    type: archetype,
    dimensions: { width: targetW, height: targetH },
    palette: finalPalette,
  };
};

// --- Main Service ---

export const generateSpriteFromImage = async (
  base64Image: string,
  origWidth: number,
  origHeight: number
): Promise<SpriteResult> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64Image}`;

    img.onload = () => {
      try {
        const procW = 128;
        const procH = 128;
        const canvas = document.createElement("canvas");
        canvas.width = procW;
        canvas.height = procH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas context failed");

        // Maintain aspect ratio
        const scale = Math.min(procW / origWidth, procH / origHeight);
        const drawW = Math.round(origWidth * scale);
        const drawH = Math.round(origHeight * scale);
        const drawX = (procW - drawW) / 2;
        const drawY = (procH - drawH) / 2;

        ctx.clearRect(0, 0, procW, procH);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        const imageData = ctx.getImageData(0, 0, procW, procH);

        // 1. Contrast Boost
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const contrast = 1.25; // Slightly stronger contrast
          const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
          d[i] = factor * (d[i] - 128) + 128;
          d[i + 1] = factor * (d[i + 1] - 128) + 128;
          d[i + 2] = factor * (d[i + 2] - 128) + 128;
        }

        // 2. Flood Fill Background Removal
        removeBackgroundFloodFill(d, procW, procH);
        ctx.putImageData(imageData, 0, 0);

        // 3. Auto-Crop
        const bounds = getContentBounds(d, procW, procH);

        // 4. Dimensions & Archetype
        const ratio = bounds.w / bounds.h;
        let targetW = 12;
        let targetH = 12;
        let archetype: "wide_object" | "tall_object" | "square_object" =
          "square_object";
        let sideCompression = 0.5;

        if (ratio > 1.3) {
          targetW = 16;
          targetH = 12;
          archetype = "wide_object";
          sideCompression = 0.35;
        } else if (ratio < 0.75) {
          targetW = 8;
          targetH = 16;
          archetype = "tall_object";
          sideCompression = 0.65;
        } else {
          targetW = 12;
          targetH = 12;
          archetype = "square_object";
          sideCompression = 0.5;
        }

        // 5. Smart Downscaling (Edge-Weighted)
        const frontGrid = smartDownsample(ctx, bounds, targetW, targetH);
        const result = buildSpriteResultFromFrontGrid(frontGrid, targetW, targetH);
        resolve(result);
      } catch (err: any) {
        reject(err);
      }
    };
    img.onerror = () =>
      reject(new Error("Failed to load image for processing"));
  });
};

/** Minimum confidence to use peg detection result; below this we fall back to canvas pipeline */
const PEG_CONFIDENCE_THRESHOLD = 0.5;
/** Confidence below this triggers a warning to the user (retake photo) */
const PEG_CONFIDENCE_WARN = 0.7;

export interface GenerateSpriteFromFileResult {
  result: SpriteResult;
  lowConfidence?: boolean;
  /** True when back/left/right views were generated by Gemini AI */
  aiGenerated?: boolean;
  /** Short description from Gemini (e.g. object type) when AI was used */
  aiDescription?: string;
}

/**
 * Map Gemini converter output to SpriteResult (matrix with 'transparent', type, dimensions, palette).
 */
function geminiResultToSpriteResult(geminiSprite: {
  views: { front: (string | null)[][]; back: (string | null)[][]; left: (string | null)[][]; right: (string | null)[][] };
  dimensions: { width: number; height: number };
}): SpriteResult {
  const viewToMatrix = (view: (string | null)[][]): string[][] =>
    (view || []).map((row) =>
      (row || []).map((c) => (c == null || c === "" ? "transparent" : c))
    );

  const matrix: SpriteMatrix = {
    front: viewToMatrix(geminiSprite.views.front),
    back: viewToMatrix(geminiSprite.views.back),
    left: viewToMatrix(geminiSprite.views.left),
    right: viewToMatrix(geminiSprite.views.right),
  };

  const paletteSet = new Set<string>();
  [matrix.front, matrix.back, matrix.left, matrix.right].forEach((view) =>
    view.forEach((row) =>
      row.forEach((c) => {
        if (c && c !== "transparent") paletteSet.add(c);
      })
    )
  );
  const palette = Array.from(paletteSet).sort();

  const { width, height } = geminiSprite.dimensions;
  const ratio = width / height;
  let type: "wide_object" | "tall_object" | "square_object" = "square_object";
  if (ratio > 1.3) type = "wide_object";
  else if (ratio < 0.75) type = "tall_object";

  return {
    matrix,
    type,
    dimensions: { width, height },
    palette,
  };
}

/**
 * Generate sprite from an image file. When VITE_GEMINI_API_KEY is set, uses
 * Gemini AI to analyze the image and generate back/left/right views. Otherwise
 * tries Lite Brite peg detection (OpenCV) + enhanced converter, then falls back
 * to the standard canvas pipeline (contrast, background removal, crop, downsample).
 */
export const generateSpriteFromImageFromFile = async (
  file: File
): Promise<GenerateSpriteFromFileResult> => {
  const geminiKey = getGeminiApiKey();
  if (geminiKey) {
    console.log("[Sprite] Using Gemini AI for conversion (API key set)");
    try {
      const converter = new GeminiSpriteConverter({
        pixelDensity: "high",
      });
      converter.setApiKey(geminiKey);
      const geminiSprite = await converter.convertToSprite(file);
      const result = geminiResultToSpriteResult(geminiSprite);
      const aiGenerated = (geminiSprite.metadata?.aiGenerated?.length ?? 0) > 0;
      console.log("[Sprite] Gemini conversion successful", {
        objectType: geminiSprite.objectType,
        dimensions: result.dimensions,
        aiViews: geminiSprite.metadata?.aiGenerated,
      });
      return {
        result,
        lowConfidence: (geminiSprite.metadata?.confidence ?? 1) < PEG_CONFIDENCE_WARN,
        aiGenerated,
        aiDescription: aiGenerated
          ? [geminiSprite.objectType, geminiSprite.description].filter(Boolean).join(" – ")
          : undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[Sprite] Gemini conversion failed, falling back to peg/canvas pipeline:", msg);
      if (msg.includes("No pegs detected")) {
        console.warn("[Sprite] Tip: Peg detection found no colored pegs (filter may be strict, or image may not be a Lite Brite photo). Trying peg path then canvas.");
      }
    }
  } else {
    console.log("[Sprite] No Gemini API key – using peg detection + enhanced converter or canvas pipeline");
  }

  console.log("[Sprite] Using peg/canvas pipeline (optimized sparse converter)...");
  try {
    const converter = new OptimizedLiteBriteConverter({
      useAdaptiveDensity: true,
    });
    const sprite = await converter.convertToSprite(file);

    const { dimensions, views, metadata } = sprite;
    const hasPegs = (metadata.originalPegCount ?? 0) > 0;
    const confidenceOk = (metadata.confidence ?? 0) >= PEG_CONFIDENCE_THRESHOLD;

    if (!hasPegs && (metadata.originalPegCount ?? 0) === 0) {
      console.log("[Sprite] Peg path returned 0 pegs – using canvas pipeline (image preprocessing).");
    }
    if (hasPegs && confidenceOk && views?.front?.length) {
      const viewToMatrix = (view: (string | null)[][]): string[][] =>
        (view || []).map((row) =>
          (row || []).map((c) => (c == null || c === "" ? "transparent" : c))
        );

      const matrix: SpriteMatrix = {
        front: viewToMatrix(views.front),
        back: viewToMatrix(views.back),
        left: viewToMatrix(views.left),
        right: viewToMatrix(views.right),
      };

      const paletteSet = new Set<string>();
      [matrix.front, matrix.back, matrix.left, matrix.right].forEach(
        (view) =>
          view.forEach((row) =>
            row.forEach((c) => {
              if (c && c !== "transparent") paletteSet.add(c);
            })
          )
      );
      const palette = Array.from(paletteSet).sort();

      const archetypeToType = (
        a: string
      ): "wide_object" | "tall_object" | "square_object" => {
        if (a === "wide") return "wide_object";
        if (a === "tall") return "tall_object";
        return "square_object";
      };

      const result: SpriteResult = {
        matrix,
        type: archetypeToType(dimensions.archetype ?? "square"),
        dimensions: { width: dimensions.width, height: dimensions.height },
        palette,
      };

      console.log("[Sprite] Optimized sparse converter success", {
        dimensions: result.dimensions,
        pegs: metadata.originalPegCount,
        pixelToPegRatio: metadata.pixelToPegRatio?.toFixed(1),
      });
      return {
        result,
        lowConfidence: (metadata.confidence ?? 0) < PEG_CONFIDENCE_WARN,
      };
    }
  } catch (e) {
    console.log("[Sprite] Peg path failed (OpenCV/pegs), using canvas pipeline");
  }

  console.log("[Sprite] Using canvas pipeline (image preprocessing)...");
  const base64 = await fileToBase64(file);
  const { width, height } = await getImageDimensions(file);
  const result = await generateSpriteFromImage(base64, width, height);
  console.log("[Sprite] Canvas pipeline success", { dimensions: result.dimensions });
  return { result };
};

