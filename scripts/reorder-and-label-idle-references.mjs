/**
 * Reorders idle-all-directions reference PNGs to match pipeline order:
 *   col0 DOWN, col1 LEFT, col2 RIGHT, col3 UP
 * (Source assets were UP, RIGHT, DOWN, LEFT per column.)
 * Then adds a bottom legend row: DOWN | LEFT | RIGHT | UP
 *
 * Run from repo root: node scripts/reorder-and-label-idle-references.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_DIR = path.join(__dirname, "..", "public", "assets", "test", "reference");
const FILES = ["female_idle_all_directions.png", "male_idle_all_directions.png"];

const CELL = 64;
const LABEL_H = 22;

/**
 * Old column order in source art: 0=UP, 1=RIGHT profile, 2=DOWN, 3=LEFT profile
 * → pipeline order: 0=DOWN, 1=LEFT, 2=RIGHT, 3=UP
 * (Uses old[1] as RIGHT and old[3] as LEFT so middle columns match screen-facing.)
 */
async function reorderRowFromBuffer(imgBuffer, rowIndex) {
  const top = rowIndex * CELL;
  const rowBuf = await sharp(imgBuffer)
    .extract({ left: 0, top, width: 256, height: CELL })
    .toBuffer();
  const cells = [];
  for (let c = 0; c < 4; c++) {
    const cell = await sharp(rowBuf)
      .extract({ left: c * CELL, top: 0, width: CELL, height: CELL })
      .toBuffer();
    cells.push(cell);
  }
  const newOrder = [cells[2], cells[1], cells[3], cells[0]];
  const composites = newOrder.map((input, i) => ({
    input,
    left: i * CELL,
    top: 0,
  }));
  return sharp({
    create: {
      width: 256,
      height: CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

const legendSvg = Buffer.from(
  `<svg width="256" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="${LABEL_H}" fill="#000000"/>
  <text x="32" y="16" text-anchor="middle" fill="#c8c8c8" font-size="11" font-weight="700" font-family="system-ui,Segoe UI,sans-serif">DOWN</text>
  <text x="96" y="16" text-anchor="middle" fill="#c8c8c8" font-size="11" font-weight="700" font-family="system-ui,Segoe UI,sans-serif">LEFT</text>
  <text x="160" y="16" text-anchor="middle" fill="#c8c8c8" font-size="11" font-weight="700" font-family="system-ui,Segoe UI,sans-serif">RIGHT</text>
  <text x="224" y="16" text-anchor="middle" fill="#c8c8c8" font-size="11" font-weight="700" font-family="system-ui,Segoe UI,sans-serif">UP</text>
</svg>`,
);

async function processFile(name) {
  const inputPath = path.join(REF_DIR, name);
  const buf = fs.readFileSync(inputPath);
  const meta = await sharp(buf).metadata();
  if (meta.width !== 256 || meta.height !== 128) {
    throw new Error(`${name}: expected 256×128, got ${meta.width}×${meta.height}`);
  }
  const row0 = await reorderRowFromBuffer(buf, 0);
  const row1 = await reorderRowFromBuffer(buf, 1);
  const stacked = await sharp({
    create: {
      width: 256,
      height: 128,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([
      { input: row0, left: 0, top: 0 },
      { input: row1, left: 0, top: 64 },
    ])
    .png()
    .toBuffer();

  const out = await sharp(stacked)
    .extend({
      bottom: LABEL_H,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .composite([{ input: legendSvg, left: 0, top: 128 }])
    .png()
    .toBuffer();

  fs.writeFileSync(inputPath, out);
  console.log("Wrote", inputPath, "→ 256×" + (128 + LABEL_H));
}

for (const f of FILES) {
  await processFile(f);
}
console.log("Done.");
