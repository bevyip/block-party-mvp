import sharp from "sharp";

const CELL = 64;
const STAGE3A_STRIP_W = 256;
const STAGE3A_STRIP_H = 64;

/**
 * After resize to 256×64, exchange the two middle 64px columns so LEFT @ x=64 and
 * RIGHT @ x=128 match prompts when Gemini swaps them.
 *
 * @param {Buffer} pngBuffer — 256×64 PNG
 * @returns {Promise<Buffer>}
 */
export async function swapStage3ALeftRightColumns(pngBuffer) {
  const cells = [];
  for (let c = 0; c < 4; c++) {
    const cell = await sharp(pngBuffer)
      .extract({
        left: c * CELL,
        top: 0,
        width: CELL,
        height: STAGE3A_STRIP_H,
      })
      .toBuffer();
    cells.push(cell);
  }
  const [down, left, right, up] = cells;
  const swapped = [down, right, left, up];
  const composites = swapped.map((input, i) => ({
    input,
    left: i * CELL,
    top: 0,
  }));
  return sharp({
    create: {
      width: STAGE3A_STRIP_W,
      height: STAGE3A_STRIP_H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Measures the pixel height and foot Y position of the sprite
 * in a single 64×64 cell extracted from the Stage 3A strip.
 * Used to set a consistent target for all walk cell normalisations.
 *
 * @param {Buffer} stage3aBuffer — full 256×64 Stage 3A PNG
 * @param {number} frameX — x offset of the frame to measure (0, 64, 128, or 192)
 * @returns {Promise<{ spriteHeight: number, feetY: number, headY: number }>}
 */
export async function measureStage3AFrame(stage3aBuffer, frameX) {
  const { data, info } = await sharp(stage3aBuffer)
    .extract({ left: frameX, top: 0, width: CELL, height: CELL })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let feetRow = -1;
  let headRow = -1;

  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (
        data[idx + 3] > 10 &&
        (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10)
      ) {
        feetRow = y;
        break;
      }
    }
    if (feetRow !== -1) break;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (
        data[idx + 3] > 10 &&
        (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10)
      ) {
        headRow = y;
        break;
      }
    }
    if (headRow !== -1) break;
  }

  const spriteHeight =
    feetRow !== -1 && headRow !== -1 ? feetRow - headRow + 1 : 36;
  const feetY = feetRow !== -1 ? feetRow : 58;
  const headY = headRow !== -1 ? headRow : feetY - spriteHeight + 1;

  return { spriteHeight, feetY, headY };
}

/**
 * Assembles the idle spritesheet from Stage 3A only: col0 = neutral per direction,
 * col1 = programmatic breath (sprite shifted up 2px on black).
 *
 * Output layout (128×256px, 2 cols × 4 rows):
 *   Row 0: UP — col0=neutral, col1=breath
 *   Row 1: LEFT — col0=neutral, col1=breath
 *   Row 2: DOWN — col0=neutral, col1=breath
 *   Row 3: RIGHT — col0=neutral, col1=breath
 */
export async function assembleIdleSheet(stage3aBuffer) {
  /** Stage 3A strip order matches prompts.cjs: x=0 down, 64 left, 128 right, 192 up */
  const stage3aOffsets = { DOWN: 0, LEFT: 64, RIGHT: 128, UP: 192 };
  const rowOrder = ["UP", "LEFT", "DOWN", "RIGHT"];
  const composites = [];

  for (let row = 0; row < 4; row++) {
    const dir = rowOrder[row];
    const srcX = stage3aOffsets[dir];

    // Col 0: neutral frame extracted from Stage 3A
    const neutral = await sharp(stage3aBuffer)
      .extract({ left: srcX, top: 0, width: CELL, height: CELL })
      .toBuffer();

    // Col 1: programmatic breath — shift torso up 2px using sharp
    const breathFrame = await sharp(stage3aBuffer)
      .extract({ left: srcX, top: 0, width: CELL, height: CELL })
      .toBuffer();

    const breath = await sharp({
      create: {
        width: CELL,
        height: CELL,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([{ input: breathFrame, left: 0, top: -2 }])
      .png()
      .toBuffer()
      .catch(() =>
        sharp(breathFrame)
          .affine([1, 0, 0, 1], {
            background: { r: 0, g: 0, b: 0, alpha: 1 },
            idx: 0,
            idy: -2,
          })
          .resize(CELL, CELL, {
            fit: "contain",
            position: "south",
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          })
          .png()
          .toBuffer(),
      );

    composites.push({ input: neutral, left: 0, top: row * CELL });
    composites.push({ input: breath, left: CELL, top: row * CELL });
  }

  return sharp({
    create: {
      width: 128,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Assembles the walk spritesheet from 12 individual 64×64 cell buffers.
 *
 * walkCells: object keyed by direction, each containing 4 frame buffers:
 * {
 *   UP:    [neutral, rightFoot, neutral, leftFoot],
 *   LEFT:  [neutral, rightFoot, neutral, leftFoot],
 *   DOWN:  [neutral, rightFoot, neutral, leftFoot],
 *   RIGHT: [neutral, rightFoot, neutral, leftFoot],
 * }
 *
 * Output layout (256×256px, 4 cols × 4 rows):
 *   Row 0: UP direction
 *   Row 1: LEFT direction
 *   Row 2: DOWN direction
 *   Row 3: RIGHT direction
 */
export async function assembleWalkSheet(walkCells) {
  const rowOrder = ["UP", "LEFT", "DOWN", "RIGHT"];
  const FRAMES = 4;
  const composites = [];

  for (let row = 0; row < 4; row++) {
    const dir = rowOrder[row];
    const frames = walkCells[dir];

    for (let col = 0; col < FRAMES; col++) {
      composites.push({
        input: frames[col],
        left: col * CELL,
        top: row * CELL,
      });
    }
  }

  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Normalises a 64×64 walk cell to exactly match the Stage 3A reference sprite height.
 * Scales the sprite if needed, then anchors feet to the reference feet Y position.
 *
 * @param {Buffer} cellBuffer — 64×64 PNG walk cell
 * @param {object} ref — { spriteHeight: number, feetY: number } from measureStage3AFrame
 */
export async function normaliseWalkCell(cellBuffer, ref) {
  const TARGET_FEET_Y = ref?.feetY ?? 58;
  const TARGET_HEIGHT = ref?.spriteHeight ?? 36;

  const { data, info } = await sharp(cellBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let feetRow = -1;
  let headRow = -1;

  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (
        data[idx + 3] > 10 &&
        (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10)
      ) {
        feetRow = y;
        break;
      }
    }
    if (feetRow !== -1) break;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (
        data[idx + 3] > 10 &&
        (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10)
      ) {
        headRow = y;
        break;
      }
    }
    if (headRow !== -1) break;
  }

  if (feetRow === -1) return cellBuffer;

  const spriteHeight = feetRow - headRow + 1;

  // Scale sprite to exactly match reference height
  let workingBuffer = cellBuffer;
  if (spriteHeight !== TARGET_HEIGHT) {
    const scale = TARGET_HEIGHT / spriteHeight;
    const newWidth = Math.max(1, Math.min(64, Math.round(width * scale)));
    const newHeight = Math.max(1, Math.min(64, Math.round(height * scale)));

    const resizedSprite = await sharp(cellBuffer)
      .resize(newWidth, newHeight, { kernel: "nearest" })
      .toBuffer();

    workingBuffer = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([
        {
          input: resizedSprite,
          left: Math.max(0, Math.floor((64 - newWidth) / 2)),
          top: Math.max(0, Math.floor((64 - newHeight) / 2)),
        },
      ])
      .png()
      .toBuffer();

    // Re-scan feet after resize
    const rescanResult = await sharp(workingBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    feetRow = -1;
    for (let y = rescanResult.info.height - 1; y >= 0; y--) {
      for (let x = 0; x < rescanResult.info.width; x++) {
        const idx =
          (y * rescanResult.info.width + x) * rescanResult.info.channels;
        if (
          rescanResult.data[idx + 3] > 10 &&
          (rescanResult.data[idx] > 10 ||
            rescanResult.data[idx + 1] > 10 ||
            rescanResult.data[idx + 2] > 10)
        ) {
          feetRow = y;
          break;
        }
      }
      if (feetRow !== -1) break;
    }
  }

  if (feetRow === -1 || feetRow === TARGET_FEET_Y) {
    return sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([{ input: workingBuffer, left: 0, top: 0 }])
      .png()
      .toBuffer();
  }

  const shift = TARGET_FEET_Y - feetRow;
  const cropTop = Math.max(0, -shift);
  const srcMeta = await sharp(workingBuffer).metadata();
  const srcHeight = srcMeta.height ?? 64;
  const cropHeight = Math.max(1, srcHeight - cropTop);

  const shifted = await sharp(workingBuffer)
    .extract({ left: 0, top: cropTop, width: 64, height: cropHeight })
    .toBuffer();

  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: shifted, left: 0, top: Math.max(0, shift) }])
    .png()
    .toBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
// Walk sheet helpers (new single-call approach)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rescales any raster buffer to exactly 256×256px using nearest-neighbour (pixel-art safe).
 * Called after Gemini returns the walk sheet regardless of its native size.
 *
 * @param {Buffer} inputBuf
 * @returns {Promise<Buffer>}
 */
export async function rescaleToWalkSheet(inputBuf) {
  return sharp(inputBuf)
    .resize(256, 256, { kernel: "nearest" })
    .png()
    .toBuffer();
}

/**
 * Detects and corrects the L/R row swap that Gemini introduces in the walk sheet.
 *
 * Gemini almost always swaps Row 1 (LEFT) and Row 3 (RIGHT) — the same pattern as the
 * Stage 3A LEFT/RIGHT column swap. This function auto-detects using a pixel heuristic:
 *
 *   - In frame 1 (mid-stride, x=64–127), sample the first non-black column scanning
 *     left→right within the frame area.
 *   - A LEFT-facing sprite has its body mass on the right half of the cell (it walks
 *     leftward, so torso/head pixels are clustered toward the right).
 *   - A RIGHT-facing sprite has its mass toward the left.
 *   - If row 1's first-opaque-column offset is LOWER than row 3's, row 1 is actually
 *     right-facing → swap rows 1 and 3.
 *
 * If detection is ambiguous (equal values), the swap is skipped. Pass forceSwap=true to
 * always swap regardless of heuristic (useful when you know Gemini inverts every time).
 *
 * @param {Buffer} sheetBuf   — 256×256 PNG, row order: UP / LEFT / DOWN / RIGHT
 * @param {boolean} [forceSwap=false]
 * @returns {Promise<Buffer>}
 */
export async function swapWalkSheetLeftRight(sheetBuf, forceSwap = false) {
  // Extract all 4 rows
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const row = await sharp(sheetBuf)
      .extract({ left: 0, top: r * CELL, width: 256, height: CELL })
      .png()
      .toBuffer();
    rows.push(row);
  }

  let shouldSwap = forceSwap;

  if (!forceSwap) {
    /**
     * For a given row buffer, find the x-offset (relative to frame 1 start at x=64)
     * of the first non-black pixel column, scanning left→right through frame 1 only.
     */
    const firstOpaqueColInFrame1 = async (rowBuf) => {
      const { data, info } = await sharp(rowBuf)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const { width, height, channels } = info;
      const frameStart = CELL; // frame 1 starts at x=64
      const frameEnd = CELL * 2; // frame 1 ends at x=128
      for (let x = frameStart; x < frameEnd; x++) {
        for (let y = 0; y < height; y++) {
          const idx = (y * width + x) * channels;
          if (
            data[idx + 3] > 10 &&
            (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10)
          ) {
            return x - frameStart; // offset within frame 1
          }
        }
      }
      return CELL; // blank row — treat as max
    };

    const col1 = await firstOpaqueColInFrame1(rows[1]); // expected LEFT
    const col3 = await firstOpaqueColInFrame1(rows[3]); // expected RIGHT

    // LEFT-facing: character walks toward left → body bulk on right side → higher offset
    // RIGHT-facing: body bulk on left side → lower offset
    // If row1 offset < row3 offset, row1 is actually right-facing → rows are swapped
    if (col1 < col3) {
      shouldSwap = true;
    }
  }

  if (!shouldSwap) return sheetBuf;

  // Swap rows 1 and 3 in-place (LEFT ↔ RIGHT)
  const [row0, row1, row2, row3] = rows;
  const reordered = [row0, row3, row2, row1];
  const composites = reordered.map((input, i) => ({
    input,
    left: 0,
    top: i * CELL,
  }));
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Slices a 256×256 walk sheet into per-direction cell arrays.
 *
 * Expected row order (after swapWalkSheetLeftRight if needed):
 *   Row 0 = UP, Row 1 = LEFT, Row 2 = DOWN, Row 3 = RIGHT
 *
 * @param {Buffer} sheetBuf — 256×256 PNG
 * @returns {Promise<{ UP: Buffer[], LEFT: Buffer[], DOWN: Buffer[], RIGHT: Buffer[] }>}
 */
export async function sliceWalkSheet(sheetBuf) {
  const directionRows = ["UP", "LEFT", "DOWN", "RIGHT"];
  const result = {};

  for (let row = 0; row < 4; row++) {
    const dir = directionRows[row];
    const cells = [];
    for (let col = 0; col < 4; col++) {
      const cell = await sharp(sheetBuf)
        .extract({
          left: col * CELL,
          top: row * CELL,
          width: CELL,
          height: CELL,
        })
        .png()
        .toBuffer();
      cells.push(cell);
    }
    result[dir] = cells;
  }

  return result;
}
