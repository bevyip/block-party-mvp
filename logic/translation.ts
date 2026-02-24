// ─────────────────────────────────────────────────────────
// translation.ts
// Generates a SpriteResult from an uploaded image file.
//
// Tries the Lite-Brite pipeline first (Gemini via /api/gemini proxy).
// Falls back to the canvas pipeline on error or for non-Lite-Brite images.
// ─────────────────────────────────────────────────────────

import { SpriteResult, SpriteMatrix } from "../types";
import { fileToBase64, getImageDimensions } from "../utils/imageUtils.js";
import { convertLiteBriteToSprite } from "../utils/litebrite/liteBriteConverter";
import type { LiteBriteConversionResult, PegGrid } from "../utils/litebrite/types";

// ── Color helpers (kept for canvas pipeline) ───────────────

const rgbaToHex = (r: number, g: number, b: number, a: number): string => {
  if (a < 50) return "transparent";
  const toHex = (n: number) => {
    const hex = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  if (!hex || hex === "transparent") return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
};

// ── Canvas pipeline (unchanged, for non-Lite-Brite images) ─

const removeBackgroundFloodFill = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const tolerance = 40;
  const visited = new Uint8Array(width * height);
  const queue: [number, number][] = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];

  const getIdx = (x: number, y: number) => (y * width + x) * 4;

  while (queue.length > 0) {
    const [cx, cy] = queue.pop()!;
    const cIdx = getIdx(cx, cy);
    if (visited[cy * width + cx]) continue;
    visited[cy * width + cx] = 1;

    const r = data[cIdx];
    const g = data[cIdx + 1];
    const b = data[cIdx + 2];
    data[cIdx + 3] = 0;

    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ] as [number, number][]) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (visited[ny * width + nx]) continue;
      const nIdx = getIdx(nx, ny);
      const na = data[nIdx + 3];
      if (na < 50) {
        queue.push([nx, ny]);
        continue;
      }
      const dist = Math.sqrt(
        (r - data[nIdx]) ** 2 +
          (g - data[nIdx + 1]) ** 2 +
          (b - data[nIdx + 2]) ** 2
      );
      if (dist < tolerance) queue.push([nx, ny]);
    }
  }
};

const getContentBounds = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  let minX = width, minY = height, maxX = 0, maxY = 0;
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

const smartDownsample = (
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  targetW: number,
  targetH: number
): string[][] => {
  const sourceData = ctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h).data;
  const result: string[][] = [];
  const cellW = bounds.w / targetW;
  const cellH = bounds.h / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    const row: string[] = [];
    for (let tx = 0; tx < targetW; tx++) {
      const startX = Math.floor(tx * cellW);
      const startY = Math.floor(ty * cellH);
      const endX = Math.floor((tx + 1) * cellW);
      const endY = Math.floor((ty + 1) * cellH);

      const histogram: Record<string, number> = {};
      let transparentCount = 0;
      let totalPixels = 0;

      for (let sy = startY; sy < endY; sy++) {
        for (let sx = startX; sx < endX; sx++) {
          if (sx >= bounds.w || sy >= bounds.h) continue;
          const i = (sy * bounds.w + sx) * 4;
          const a = sourceData[i + 3];
          totalPixels++;
          if (a < 128) {
            transparentCount++;
          } else {
            const hex = rgbaToHex(sourceData[i], sourceData[i + 1], sourceData[i + 2], 255);
            histogram[hex] = (histogram[hex] || 0) + 1;
          }
        }
      }

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
        row.push(maxColor);
      }
    }
    result.push(row);
  }
  return result;
};

const buildSpriteResultFromFrontGrid = (
  frontGrid: string[][],
  targetW: number,
  targetH: number
): SpriteResult => {
  const back = frontGrid.map((r) => [...r].reverse());
  const left: string[][] = frontGrid.map((r) => {
    const compressed: string[] = [];
    const ratio = 0.45;
    const newW = Math.max(1, Math.round(targetW * ratio));
    for (let x = 0; x < newW; x++) {
      const srcX = Math.floor((x / newW) * targetW);
      compressed.push(r[srcX] ?? "transparent");
    }
    const padLeft = Math.floor((targetW - newW) / 2);
    return [
      ...Array(padLeft).fill("transparent"),
      ...compressed,
      ...Array(targetW - padLeft - newW).fill("transparent"),
    ];
  });
  const right = left.map((r) => [...r].reverse());

  const matrix: SpriteMatrix = { front: frontGrid, back, left, right };
  const paletteSet = new Set<string>();
  [frontGrid, back, left, right].forEach((v) =>
    v.forEach((r) => r.forEach((c) => { if (c !== "transparent") paletteSet.add(c); }))
  );

  const ratio = targetW / targetH;
  const type: "wide_object" | "tall_object" | "square_object" =
    ratio > 1.3 ? "wide_object" : ratio < 0.75 ? "tall_object" : "square_object";

  return {
    matrix,
    type,
    dimensions: { width: targetW, height: targetH },
    palette: Array.from(paletteSet).sort(),
  };
};

const generateSpriteFromImage = (
  base64: string,
  origWidth: number,
  origHeight: number
): Promise<SpriteResult> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const procW = 300;
        const procH = 300;
        const canvas = document.createElement("canvas");
        canvas.width = procW;
        canvas.height = procH;
        const ctx = canvas.getContext("2d")!;

        const scale = Math.min(procW / origWidth, procH / origHeight);
        const drawW = Math.round(origWidth * scale);
        const drawH = Math.round(origHeight * scale);
        ctx.clearRect(0, 0, procW, procH);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, (procW - drawW) / 2, (procH - drawH) / 2, drawW, drawH);

        const imageData = ctx.getImageData(0, 0, procW, procH);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const factor = (259 * (1.25 + 255)) / (255 * (259 - 1.25));
          d[i] = factor * (d[i] - 128) + 128;
          d[i + 1] = factor * (d[i + 1] - 128) + 128;
          d[i + 2] = factor * (d[i + 2] - 128) + 128;
        }
        removeBackgroundFloodFill(d, procW, procH);
        ctx.putImageData(imageData, 0, 0);

        const bounds = getContentBounds(d, procW, procH);
        const ratio = bounds.w / bounds.h;
        let targetW = 12, targetH = 12;
        if (ratio > 1.3) { targetW = 16; targetH = 12; }
        else if (ratio < 0.75) { targetW = 8; targetH = 16; }

        const frontGrid = smartDownsample(ctx, bounds, targetW, targetH);
        resolve(buildSpriteResultFromFrontGrid(frontGrid, targetW, targetH));
      } catch (err: unknown) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = `data:image/png;base64,${base64}`;
  });
};

// ── Lite-Brite result → SpriteResult ──────────────────────

const liteBriteResultToSpriteResult = (
  result: LiteBriteConversionResult
): SpriteResult => {
  const viewToMatrix = (view: PegGrid): string[][] =>
    view.map((row) => row.map((c) => (c === null ? "transparent" : c)));

  const matrix: SpriteMatrix = {
    front: viewToMatrix(result.views.front),
    back: viewToMatrix(result.views.back),
    left: viewToMatrix(result.views.left),
    right: viewToMatrix(result.views.right),
  };

  const paletteSet = new Set<string>();
  Object.values(matrix).forEach((view) =>
    view.forEach((row) =>
      row.forEach((c) => { if (c !== "transparent") paletteSet.add(c); })
    )
  );

  const { width, height } = result.dimensions;
  const ratio = width / height;
  const type: "wide_object" | "tall_object" | "square_object" =
    ratio > 1.3 ? "wide_object" : ratio < 0.75 ? "tall_object" : "square_object";

  return {
    matrix,
    type,
    dimensions: { width, height },
    palette: Array.from(paletteSet).sort(),
  };
};

// ── Public API ─────────────────────────────────────────────

export interface GenerateSpriteFromFileResult {
  result: SpriteResult;
  lowConfidence?: boolean;
  aiGenerated?: boolean;
  aiDescription?: string;
}

/** Normalize AI description: start lowercase. */
const normalizeAiDescription = (s: string): string => {
  const t = s.trim();
  if (t.length > 0 && t[0] === t[0].toUpperCase()) {
    return t[0].toLowerCase() + t.slice(1);
  }
  return t;
};

/**
 * Main entry point.
 * Tries the Lite-Brite pipeline first (board crop → Gemini via /api/gemini → sprite).
 * Falls back to the canvas pipeline on error.
 */
export const generateSpriteFromImageFromFile = async (
  file: File
): Promise<GenerateSpriteFromFileResult> => {
  try {
    console.log("[Sprite] Trying Lite-Brite pipeline...");
    const liteBriteResult = await convertLiteBriteToSprite(file);
    const result = liteBriteResultToSpriteResult(liteBriteResult);

    console.log("[Sprite] Lite-Brite conversion successful", {
      subject: liteBriteResult.subject,
      dimensions: result.dimensions,
      colors: liteBriteResult.colors.map((c) => c.name),
    });

    return {
      result,
      aiGenerated: true,
      aiDescription: normalizeAiDescription(liteBriteResult.subject),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      "[Sprite] Lite-Brite pipeline failed, falling back to canvas pipeline:",
      msg
    );
  }

  // Canvas fallback
  console.log("[Sprite] Using canvas pipeline...");
  const base64 = await fileToBase64(file);
  const { width, height } = await getImageDimensions(file);
  const result = await generateSpriteFromImage(base64, width, height);
  console.log("[Sprite] Canvas pipeline complete", { dimensions: result.dimensions });
  return { result };
};
