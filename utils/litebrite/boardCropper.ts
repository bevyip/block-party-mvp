// ─────────────────────────────────────────────────────────
// boardCropper.ts
// Isolates the black Lite-Brite peg board from a top-down photo.
// Returns a base64 data-URL of just the board area.
// No external dependencies – pure Canvas API.
// ─────────────────────────────────────────────────────────

/**
 * Converts a File into an HTMLImageElement, resolving once loaded.
 */
const fileToImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });

/**
 * Samples a small version of the image (for fast processing).
 * Returns ImageData for the thumbnail.
 */
const makeThumbnail = (
  img: HTMLImageElement,
  maxSize = 200
): { data: ImageData; scaleX: number; scaleY: number } => {
  const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
  const tw = Math.round(img.width * scale);
  const th = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, tw, th);

  return {
    data: ctx.getImageData(0, 0, tw, th),
    scaleX: img.width / tw,
    scaleY: img.height / th,
  };
};

/**
 * Finds the board by row/column dark density: the largest contiguous
 * rectangle where rows and columns have >40% dark pixels. No flood fill.
 * Returns bounding box in ORIGINAL image coordinates.
 */
const findBoardBounds = (
  img: HTMLImageElement
): { x: number; y: number; w: number; h: number } => {
  const { data, scaleX, scaleY } = makeThumbnail(img, 400);
  const tw = data.width;
  const th = data.height;
  const px = data.data;

  // Compute per-pixel luminance
  const luma = new Float32Array(tw * th);
  for (let i = 0; i < tw * th; i++) {
    luma[i] =
      0.299 * px[i * 4] +
      0.587 * px[i * 4 + 1] +
      0.114 * px[i * 4 + 2];
  }

  // Compute average luminance of entire image
  const avgLuma = luma.reduce((a, b) => a + b, 0) / luma.length;
  // Dark threshold: pixels darker than 65% of average are "board"
  const darkThresh = Math.min(avgLuma * 0.65, 85);

  // For each row and column, compute what fraction of pixels are dark
  const rowDarkFraction = new Float32Array(th);
  const colDarkFraction = new Float32Array(tw);

  for (let y = 0; y < th; y++) {
    let darkCount = 0;
    for (let x = 0; x < tw; x++) {
      if (luma[y * tw + x] < darkThresh) darkCount++;
    }
    rowDarkFraction[y] = darkCount / tw;
  }

  for (let x = 0; x < tw; x++) {
    let darkCount = 0;
    for (let y = 0; y < th; y++) {
      if (luma[y * tw + x] < darkThresh) darkCount++;
    }
    colDarkFraction[x] = darkCount / th;
  }

  // Find the contiguous range of rows where dark fraction > 40%
  // This finds the board's vertical extent
  const ROW_THRESH = 0.4;
  const COL_THRESH = 0.4;

  let minRow = 0, maxRow = th - 1;
  let minCol = 0, maxCol = tw - 1;

  // Find first and last row with enough dark pixels
  for (let y = 0; y < th; y++) {
    if (rowDarkFraction[y] > ROW_THRESH) { minRow = y; break; }
  }
  for (let y = th - 1; y >= 0; y--) {
    if (rowDarkFraction[y] > ROW_THRESH) { maxRow = y; break; }
  }

  // Find first and last col with enough dark pixels
  for (let x = 0; x < tw; x++) {
    if (colDarkFraction[x] > COL_THRESH) { minCol = x; break; }
  }
  for (let x = tw - 1; x >= 0; x--) {
    if (colDarkFraction[x] > COL_THRESH) { maxCol = x; break; }
  }

  // Add a generous safety margin of 3% so we never clip content
  const boardW = (maxCol - minCol) * scaleX;
  const boardH = (maxRow - minRow) * scaleY;
  const marginX = boardW * 0.03;
  const marginY = boardH * 0.03;

  return {
    x: Math.max(0, Math.round(minCol * scaleX - marginX)),
    y: Math.max(0, Math.round(minRow * scaleY - marginY)),
    w: Math.min(img.width, Math.round(boardW + marginX * 2)),
    h: Math.min(img.height, Math.round(boardH + marginY * 2)),
  };
};

/**
 * Finds the bounding box of colored (non-dark) content within the board.
 * Luminance + saturation thresholds catch both white pegs and colored pegs.
 */
const findCreationBounds = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data;

  // Conservative thresholds — better to include too much than clip content
  const LUMA_THRESHOLD = 45;
  const SATURATION_THRESHOLD = 40;

  let minX = width, maxX = 0, minY = height, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max - min;

      if (luma > LUMA_THRESHOLD || saturation > SATURATION_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) {
    console.warn("[BoardCrop] No colored content found — using full board");
    return { x: 0, y: 0, w: width, h: height };
  }

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

/**
 * Main export.
 * Pass 1: crop to board. Pass 2: crop to creation content with generous padding.
 * Returns base64 JPEG for the Gemini API.
 */
export const cropBoard = async (file: File): Promise<string> => {
  const img = await fileToImage(file);

  // Pass 1: Find the black board region
  let boardBounds: { x: number; y: number; w: number; h: number };
  try {
    boardBounds = findBoardBounds(img);
    if (boardBounds.w < img.width * 0.15 || boardBounds.h < img.height * 0.15) {
      throw new Error("Board detection returned implausibly small region");
    }
    console.log(`[BoardCrop] Board bounds: x:${boardBounds.x} y:${boardBounds.y} w:${boardBounds.w} h:${boardBounds.h}`);
  } catch (e) {
    console.warn("[BoardCrop] Detection failed, using full image:", e);
    boardBounds = { x: 0, y: 0, w: img.width, h: img.height };
  }

  // Draw board crop to canvas
  const boardCanvas = document.createElement("canvas");
  boardCanvas.width = boardBounds.w;
  boardCanvas.height = boardBounds.h;
  const boardCtx = boardCanvas.getContext("2d")!;
  boardCtx.drawImage(
    img,
    boardBounds.x, boardBounds.y, boardBounds.w, boardBounds.h,
    0, 0, boardBounds.w, boardBounds.h
  );

  // Pass 2: Find the creation content within the board
  const contentBounds = findCreationBounds(boardCtx, boardBounds.w, boardBounds.h);
  console.log(`[BoardCrop] Creation bounds: x:${contentBounds.x} y:${contentBounds.y} w:${contentBounds.w} h:${contentBounds.h}`);

  // Use very generous padding (40%) so small details like leaves are never clipped
  const padding = 0.4;
  const padX = Math.round(contentBounds.w * padding);
  const padY = Math.round(contentBounds.h * padding);

  const finalX = Math.max(0, contentBounds.x - padX);
  const finalY = Math.max(0, contentBounds.y - padY);
  const finalW = Math.min(boardBounds.w - finalX, contentBounds.w + padX * 2);
  const finalH = Math.min(boardBounds.h - finalY, contentBounds.h + padY * 2);

  console.log(`[BoardCrop] Final crop: x:${finalX} y:${finalY} w:${finalW} h:${finalH}`);

  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = finalW;
  finalCanvas.height = finalH;
  const finalCtx = finalCanvas.getContext("2d")!;
  finalCtx.drawImage(boardCanvas, finalX, finalY, finalW, finalH, 0, 0, finalW, finalH);

  const dataUrl = finalCanvas.toDataURL("image/jpeg", 0.92);
  return dataUrl.split(",")[1];
};

/** Legacy preview-toggle API removed; kept as no-op for compatibility. */
export function setPreviewButtonVisible(_visible: boolean): void {
  // no-op
}

/** Legacy fixed toolbar removed from runtime; kept as no-op for compatibility. */
export function ensurePreviewContainerExists(): void {
  // no-op
}

/** Legacy preview overlay removal no longer needed; kept as no-op. */
export const removeLitebritePreview = (): void => {
  // no-op
};
