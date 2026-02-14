import { Fish } from '../../types';
import { SCALE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);

export const drawFish = (
    ctx: CanvasRenderingContext2D,
    fish: Fish
) => {
    const wiggle = Math.sin(fish.wiggleOffset) * s(1);
    const fx = Math.floor(fish.x + wiggle);
    const fy = Math.floor(fish.y);
    const fishScale = s(1); 
    
    if (fish.facingRight) {
            // Facing RIGHT ->
            ctx.fillStyle = fish.color;
            // Body
            ctx.fillRect(fx + 1 * fishScale, fy, 6 * fishScale, 3 * fishScale);
            // Nose (Right)
            ctx.fillRect(fx + 7 * fishScale, fy + 1 * fishScale, 1 * fishScale, 1 * fishScale);
            // Tail (Left)
            ctx.fillRect(fx, fy, 1 * fishScale, 1 * fishScale);
            ctx.fillRect(fx, fy + 2 * fishScale, 1 * fishScale, 1 * fishScale);
            
            // Eye (Right side)
            ctx.fillStyle = '#000';
            ctx.fillRect(fx + 5 * fishScale, fy + 1 * fishScale, 1 * fishScale, 1 * fishScale);
            
    } else {
            // Facing LEFT <-
            ctx.fillStyle = fish.color;
            // Body
            ctx.fillRect(fx + 1 * fishScale, fy, 6 * fishScale, 3 * fishScale);
            // Nose (Left)
            ctx.fillRect(fx, fy + 1 * fishScale, 1 * fishScale, 1 * fishScale);
            // Tail (Right)
            ctx.fillRect(fx + 7 * fishScale, fy, 1 * fishScale, 1 * fishScale);
            ctx.fillRect(fx + 7 * fishScale, fy + 2 * fishScale, 1 * fishScale, 1 * fishScale);
            
            // Eye (Left side)
            ctx.fillStyle = '#000';
            ctx.fillRect(fx + 2 * fishScale, fy + 1 * fishScale, 1 * fishScale, 1 * fishScale);
    }
};

