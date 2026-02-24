import { Obstacle } from '../../types';
import { SCALE, PALETTE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);
const VISUAL_SCALE = 1.3;
const d = (val: number) => s(val * VISUAL_SCALE);

export const drawRock = (
    ctx: CanvasRenderingContext2D,
    o: Obstacle
) => {
    const x = o.renderBounds.x;
    const y = o.renderBounds.y;
    const w = o.renderBounds.width;
    const h = o.renderBounds.height;
    
    if (o.variant === 0) {
        ctx.fillStyle = PALETTE.ROCK_SHADOW;
        ctx.fillRect(x + d(2), y + h - d(3), w - d(4), d(3));
        ctx.fillRect(x + d(1), y + h - d(2), d(1), d(2));
        ctx.fillRect(x + w - d(2), y + h - d(2), d(1), d(2));

        ctx.fillStyle = PALETTE.ROCK_BASE;
        ctx.fillRect(x + d(1), y + d(3), w - d(2), h - d(5)); 
        ctx.fillRect(x, y + d(5), d(1), h - d(8)); 
        ctx.fillRect(x + w - d(1), y + d(4), d(1), h - d(7)); 

        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT;
        ctx.fillRect(x + d(2), y + d(1), w - d(6), d(4)); 
        ctx.fillRect(x + d(1), y + d(2), d(1), d(3)); 
        
        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT_BRIGHT;
        ctx.fillRect(x + d(2), y + d(1), w - d(7), d(1)); 
        ctx.fillRect(x + d(1), y + d(2), d(1), d(1)); 
    } 
    else if (o.variant === 1) {
        ctx.fillStyle = PALETTE.ROCK_SHADOW;
        ctx.fillRect(x, y + h - d(3), w, d(3));
        
        ctx.fillStyle = PALETTE.ROCK_BASE;
        ctx.fillRect(x + d(1), y + d(4), w - d(2), h - d(6));
        
        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT;
        ctx.fillRect(x + d(2), y + d(3), w - d(4), d(3));
        
        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT_BRIGHT;
        ctx.fillRect(x + d(3), y + d(3), d(4), d(1));
    } 
    else {
        ctx.fillStyle = PALETTE.ROCK_SHADOW;
        ctx.fillRect(x + d(2), y + h - d(3), w - d(3), d(3));
        
        ctx.fillStyle = PALETTE.ROCK_BASE;
        ctx.fillRect(x + d(1), y + d(2), w - d(3), h - d(4));
        
        ctx.fillStyle = PALETTE.ROCK_SHADOW;
        ctx.fillRect(x + d(5), y + d(3), d(1), d(4));

        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT;
        ctx.fillRect(x + d(2), y + d(1), d(4), d(3));
        ctx.fillRect(x + d(7), y + d(3), d(3), d(2)); 
        
        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT_BRIGHT;
        ctx.fillRect(x + d(2), y + d(1), d(2), d(1));
    }
};

