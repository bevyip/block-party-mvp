import { Sprite } from '../../types';
import { SCALE } from '../../constants';
import { LITEBRITE_DISPLAY_SCALE } from '../../utils/litebrite/constants';
import { getRenderedContentBounds } from '../../utils/litebrite/gridRenderer';
import type { PegGrid } from '../../utils/litebrite/types';

export interface CustomSpriteBounds {
  /** X offset of actual content from sprite origin, in display pixels */
  contentX: number;
  /** Y offset of actual content from sprite origin, in display pixels */
  contentY: number;
  /** Width of actual content in display pixels */
  contentWidth: number;
  /** Height of actual content in display pixels */
  contentHeight: number;
}

export const drawCustomSprite = (
  ctx: CanvasRenderingContext2D,
  sprite: Sprite
): CustomSpriteBounds | null => {
  if (!sprite.customSprite) return null;

  const matrix = sprite.customSprite.matrix;
  const view = matrix[sprite.facing] ?? matrix.front;
  if (!view || view.length === 0) return null;

  // Convert string[][] back to PegGrid for bounds calculation
  const pegGrid: PegGrid = view.map((row) =>
    row.map((c) => (c === 'transparent' ? null : c))
  );

  const bounds = getRenderedContentBounds(pegGrid);

  // Idle bob (same as default sprites: slower, heavier bob)
  const bob = Math.floor(Math.sin(sprite.bobOffset) * 1.2 * SCALE);
  const sy = Math.floor(sprite.y - Math.abs(bob));

  ctx.save();
  ctx.translate(Math.floor(sprite.x), sy);
  ctx.scale(LITEBRITE_DISPLAY_SCALE, LITEBRITE_DISPLAY_SCALE);

  for (let row = 0; row < view.length; row++) {
    for (let col = 0; col < (view[row]?.length ?? 0); col++) {
      const color = view[row][col];
      if (!color || color === 'transparent') continue;
      ctx.fillStyle = color;
      ctx.fillRect(col * SCALE, row * SCALE, SCALE, SCALE);
    }
  }

  ctx.restore();

  // Return content bounds in display pixels (after LITEBRITE_DISPLAY_SCALE)
  return {
    contentX: bounds.left * LITEBRITE_DISPLAY_SCALE,
    contentY: bounds.top * LITEBRITE_DISPLAY_SCALE,
    contentWidth: bounds.width * LITEBRITE_DISPLAY_SCALE,
    contentHeight: bounds.height * LITEBRITE_DISPLAY_SCALE,
  };
};
