import { Obstacle } from '../../types';
import { SCALE, PALETTE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);
const VISUAL_SCALE = 1.5;
const d = (val: number) => s(val * VISUAL_SCALE);

export const drawFlower = (
  ctx: CanvasRenderingContext2D,
  o: Obstacle
) => {
  const stage = o.flowerStage ?? 2;
  const fx = o.renderBounds.x + o.renderBounds.width / 2;
  const fy = o.renderBounds.y + o.renderBounds.height / 2;

  if (stage === 1) {
    // Seedling: single small leaf, bottom-center
    ctx.fillStyle = PALETTE.GRASS_DARK;
    // Small stem
    ctx.fillRect(fx, fy + d(1), d(1), d(1));
    // Single leaf to the right
    ctx.fillStyle = PALETTE.TREE_LEAVES_MID;
    ctx.fillRect(fx + d(1), fy + d(1), d(2), d(1));
  }

  if (stage === 2) {
    // Current flower — cross petals + center
    ctx.fillStyle = PALETTE.FLOWER_PETAL;
    ctx.fillRect(fx - d(1), fy, d(3), d(1));
    ctx.fillRect(fx, fy - d(1), d(1), d(3));
    ctx.fillStyle = PALETTE.FLOWER_CENTER;
    ctx.fillRect(fx, fy, d(1), d(1));
  }

  if (stage === 3) {
    // Full flower: taller stem + side leaf in middle of stem + 5 petals on top
    // Stem (taller so leaf can sit in the middle)
    ctx.fillStyle = PALETTE.GRASS_DARK;
    ctx.fillRect(fx, fy + d(1), d(1), d(3));
    // Side leaf in middle of stem
    ctx.fillStyle = PALETTE.TREE_LEAVES_MID;
    ctx.fillRect(fx + d(1), fy + d(2), d(2), d(1));
    // 5 petals around center (top, right, bottom-right, bottom-left, left) — top petal one pixel taller
    ctx.fillStyle = PALETTE.FLOWER_PETAL;
    ctx.fillRect(fx, fy - d(1) - 1, d(1), d(1) + 1);
    ctx.fillRect(fx + d(1), fy, d(1), d(1));
    ctx.fillRect(fx + d(1), fy + d(1), d(1), d(1));
    ctx.fillRect(fx - d(1), fy + d(1), d(1), d(1));
    ctx.fillRect(fx - d(1), fy, d(1), d(1));
    // Center
    ctx.fillStyle = PALETTE.FLOWER_CENTER;
    ctx.fillRect(fx, fy, d(1), d(1));
  }
};
