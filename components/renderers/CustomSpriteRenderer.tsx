import { Sprite } from '../../types';
import { SCALE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);

export const drawCustomSprite = (
    ctx: CanvasRenderingContext2D,
    spr: Sprite
) => {
    if (!spr.isCustom || !spr.customSprite) {
        return;
    }

    const bob = Math.floor(Math.sin(spr.bobOffset) * 1.2 * SCALE);
    const sx = Math.floor(spr.x);
    const sy = Math.floor(spr.y - Math.abs(bob));

    // Get the appropriate sprite matrix based on facing direction
    let pixels: string[][];
    if (spr.facing === 'front') {
        pixels = spr.customSprite.matrix.front;
    } else if (spr.facing === 'left') {
        pixels = spr.customSprite.matrix.left;
    } else if (spr.facing === 'right') {
        pixels = spr.customSprite.matrix.right;
    } else {
        pixels = spr.customSprite.matrix.front;
    }

    if (!pixels || pixels.length === 0) {
        return;
    }

    // Get actual sprite width from the pixels matrix (varies by facing direction)
    const actualSpriteWidth = pixels[0]?.length || spr.customSprite.dimensions.width;
    const actualSpriteHeight = pixels.length || spr.customSprite.dimensions.height;

    // Draw shadow - width matches the actual sprite width for current facing direction
    // The sprite's x position is centered based on front/back width, so we need to center the shadow
    // based on the actual narrower width when facing left/right
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    const shadowWidth = actualSpriteWidth * SCALE;
    const shadowHeight = s(1);
    const shadowY = Math.floor(spr.y) + actualSpriteHeight * SCALE;
    // Calculate shadow X: sprite is centered on front/back width, so offset shadow to center on actual width
    const frontBackWidth = spr.customSprite.dimensions.width * SCALE;
    const shadowX = sx + (frontBackWidth - shadowWidth) / 2 + s(2);
    ctx.fillRect(shadowX, shadowY, shadowWidth, shadowHeight);

    // Draw the pixel matrix
    let pixelsDrawn = 0;
    pixels.forEach((row, y) => {
        if (!row) return;
        row.forEach((color, x) => {
            if (color && color !== 'transparent' && color !== '#00000000') {
                ctx.fillStyle = color;
                ctx.fillRect(
                    sx + x * SCALE,
                    sy + y * SCALE,
                    SCALE,
                    SCALE
                );
                pixelsDrawn++;
            }
        });
    });

    // Fallback: Draw a visible rectangle if no pixels were drawn (for debugging)
    if (pixelsDrawn === 0) {
        ctx.fillStyle = '#ff00ff'; // Magenta fallback color
        ctx.fillRect(
            sx,
            sy,
            spr.customSprite.dimensions.width * SCALE,
            spr.customSprite.dimensions.height * SCALE
        );
    }
};

