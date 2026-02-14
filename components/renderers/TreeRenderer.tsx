import { Obstacle } from '../../types';
import { SCALE, PALETTE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);

export const drawTree = (
    ctx: CanvasRenderingContext2D,
    o: Obstacle
) => {
    const cx = o.renderBounds.x + o.renderBounds.width / 2;
    const bottomY = o.renderBounds.y + o.renderBounds.height;
    const treeH = o.renderBounds.height;
    const treeW = o.renderBounds.width;
    
    // --- TRUNK ---
    const trunkW = s(5); 
    const trunkH = treeH * 0.55; 
    const trunkX = cx - trunkW/2;
    const trunkY = bottomY - trunkH;

    ctx.fillStyle = PALETTE.TREE_TRUNK_DARK;
    ctx.fillRect(trunkX - s(1), bottomY - s(2), trunkW + s(2), s(2)); 
    ctx.fillRect(trunkX, trunkY, trunkW, trunkH);

    ctx.fillStyle = PALETTE.TREE_TRUNK_MID;
    ctx.fillRect(trunkX + s(1), trunkY, trunkW - s(2), trunkH);

    ctx.fillStyle = PALETTE.TREE_TRUNK_LIGHT;
    ctx.fillRect(trunkX + s(1), trunkY, s(1), trunkH);

    ctx.fillStyle = PALETTE.TREE_TRUNK_DARK;
    ctx.fillRect(trunkX + s(2), trunkY + s(8), s(1), s(2));
    ctx.fillRect(trunkX + s(1), trunkY + s(15), s(1), s(1));

    // --- FOLIAGE ---
    const canopyCY = o.renderBounds.y + treeH * 0.35; 
    const canopyR = treeW * 0.45;

    const drawRoughCircle = (x: number, y: number, r: number, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    };

    drawRoughCircle(cx, canopyCY + s(6), canopyR, PALETTE.TREE_LEAVES_DARKEST);
    drawRoughCircle(cx - canopyR*0.6, canopyCY + s(8), canopyR*0.7, PALETTE.TREE_LEAVES_DARKEST);
    drawRoughCircle(cx + canopyR*0.6, canopyCY + s(8), canopyR*0.7, PALETTE.TREE_LEAVES_DARKEST);

    drawRoughCircle(cx, canopyCY, canopyR, PALETTE.TREE_LEAVES_DARK);
    drawRoughCircle(cx - canopyR*0.5, canopyCY + s(2), canopyR*0.6, PALETTE.TREE_LEAVES_DARK);
    drawRoughCircle(cx + canopyR*0.5, canopyCY + s(2), canopyR*0.6, PALETTE.TREE_LEAVES_DARK);

    drawRoughCircle(cx, canopyCY - s(2), canopyR*0.7, PALETTE.TREE_LEAVES_MID);
    drawRoughCircle(cx - canopyR*0.4, canopyCY, canopyR*0.5, PALETTE.TREE_LEAVES_MID);
    drawRoughCircle(cx + canopyR*0.4, canopyCY, canopyR*0.5, PALETTE.TREE_LEAVES_MID);

    drawRoughCircle(cx, canopyCY - s(4), canopyR*0.5, PALETTE.TREE_LEAVES_LIGHT);
    drawRoughCircle(cx - canopyR*0.3, canopyCY - s(2), canopyR*0.4, PALETTE.TREE_LEAVES_LIGHT);
    drawRoughCircle(cx + canopyR*0.3, canopyCY - s(2), canopyR*0.4, PALETTE.TREE_LEAVES_LIGHT);
};

