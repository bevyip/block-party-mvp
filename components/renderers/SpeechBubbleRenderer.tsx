import { Sprite } from '../../types';
import { SCALE, SPRITE_SIZE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);

export const drawSpeechBubble = (
    ctx: CanvasRenderingContext2D,
    sprite: Sprite
) => {
    if (!sprite.bubble) return;
    
    const bx = Math.floor(sprite.x + SPRITE_SIZE.w/2);
    const by = Math.floor(sprite.y - 12 * SCALE);
    
    const bW = s(18);
    const bH = s(14);
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(bx - bW/2 + s(2), by - bH, bW - s(4), bH);
    ctx.fillRect(bx - bW/2, by - bH + s(2), bW, bH - s(4));
    ctx.fillRect(bx - bW/2 + s(1), by - bH + s(1), bW - s(2), bH - s(2));

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx - bW/2 + s(2), by - bH + s(1), bW - s(4), bH - s(2));
    ctx.fillRect(bx - bW/2 + s(1), by - bH + s(2), bW - s(2), bH - s(4));

    const tailY = by;
    ctx.fillStyle = '#000000';
    ctx.fillRect(bx - s(2), tailY, s(4), s(1)); 
    ctx.fillRect(bx - s(1), tailY + s(1), s(2), s(1)); 
    ctx.fillRect(bx, tailY + s(2), s(1), s(1)); // Extended tip point
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx - s(1), tailY - s(1), s(2), s(1)); 

    ctx.fillStyle = '#000000';
    ctx.font = `${8 * SCALE}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sprite.bubble.text, bx, by - bH/2 + s(1));
};

