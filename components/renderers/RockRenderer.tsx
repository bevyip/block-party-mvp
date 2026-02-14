import { Obstacle } from '../../types';
import { SCALE, PALETTE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);

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
        ctx.fillRect(x + s(2), y + h - s(3), w - s(4), s(3));
        ctx.fillRect(x + s(1), y + h - s(2), s(1), s(2));
        ctx.fillRect(x + w - s(2), y + h - s(2), s(1), s(2));

        ctx.fillStyle = PALETTE.ROCK_BASE;
        ctx.fillRect(x + s(1), y + s(3), w - s(2), h - s(5)); 
        ctx.fillRect(x, y + s(5), s(1), h - s(8)); 
        ctx.fillRect(x + w - s(1), y + s(4), s(1), h - s(7)); 

        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT;
        ctx.fillRect(x + s(2), y + s(1), w - s(6), s(4)); 
        ctx.fillRect(x + s(1), y + s(2), s(1), s(3)); 
        
        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT_BRIGHT;
        ctx.fillRect(x + s(2), y + s(1), w - s(7), s(1)); 
        ctx.fillRect(x + s(1), y + s(2), s(1), s(1)); 
    } 
    else if (o.variant === 1) {
        ctx.fillStyle = PALETTE.ROCK_SHADOW;
        ctx.fillRect(x, y + h - s(3), w, s(3));
        
        ctx.fillStyle = PALETTE.ROCK_BASE;
        ctx.fillRect(x + s(1), y + s(4), w - s(2), h - s(6));
        
        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT;
        ctx.fillRect(x + s(2), y + s(3), w - s(4), s(3));
        
        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT_BRIGHT;
        ctx.fillRect(x + s(3), y + s(3), s(4), s(1));
    } 
    else {
        ctx.fillStyle = PALETTE.ROCK_SHADOW;
        ctx.fillRect(x + s(2), y + h - s(3), w - s(3), s(3));
        
        ctx.fillStyle = PALETTE.ROCK_BASE;
        ctx.fillRect(x + s(1), y + s(2), w - s(3), h - s(4));
        
        ctx.fillStyle = PALETTE.ROCK_SHADOW;
        ctx.fillRect(x + s(5), y + s(3), s(1), s(4));

        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT;
        ctx.fillRect(x + s(2), y + s(1), s(4), s(3));
        ctx.fillRect(x + s(7), y + s(3), s(3), s(2)); 
        
        ctx.fillStyle = PALETTE.ROCK_HIGHLIGHT_BRIGHT;
        ctx.fillRect(x + s(2), y + s(1), s(2), s(1));
    }
};

