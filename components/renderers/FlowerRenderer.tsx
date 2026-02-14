import { Obstacle } from '../../types';
import { SCALE, PALETTE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);

export const drawFlower = (
    ctx: CanvasRenderingContext2D,
    o: Obstacle
) => {
    ctx.fillStyle = PALETTE.FLOWER_PETAL;
    const fx = o.renderBounds.x + s(3);
    const fy = o.renderBounds.y + s(3);
    ctx.fillRect(fx - s(1), fy, s(3), s(1));
    ctx.fillRect(fx, fy - s(1), s(1), s(3));
    ctx.fillStyle = PALETTE.FLOWER_CENTER;
    ctx.fillRect(fx, fy, s(1), s(1));
};

