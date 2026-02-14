import { Obstacle } from '../../types';
import { PALETTE } from '../../constants';

export const drawRiver = (
    ctx: CanvasRenderingContext2D,
    riverSegments: Obstacle[]
) => {
    ctx.fillStyle = PALETTE.RIVER;
    riverSegments.forEach(r => {
         ctx.fillRect(r.renderBounds.x, r.renderBounds.y, r.renderBounds.width, r.renderBounds.height);
    });
};

