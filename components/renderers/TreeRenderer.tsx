import { Obstacle } from '../../types';
import { SCALE, PALETTE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);
const VISUAL_SCALE = 1.3;
const d = (val: number) => s(val * VISUAL_SCALE);

export const drawTree = (
    ctx: CanvasRenderingContext2D,
    o: Obstacle
) => {
    const cx = o.renderBounds.x + o.renderBounds.width / 2;
    const bottomY = o.renderBounds.y + o.renderBounds.height;
    const treeH = o.renderBounds.height;
    const treeW = o.renderBounds.width;
    
    // --- TRUNK ---
    const trunkW = d(5); 
    const trunkH = treeH * 0.55; 
    const trunkX = cx - trunkW/2;
    const trunkY = bottomY - trunkH;

    ctx.fillStyle = PALETTE.TREE_TRUNK_DARK;
    ctx.fillRect(trunkX - d(1), bottomY - d(2), trunkW + d(2), d(2)); 
    ctx.fillRect(trunkX, trunkY, trunkW, trunkH);

    ctx.fillStyle = PALETTE.TREE_TRUNK_MID;
    ctx.fillRect(trunkX + d(1), trunkY, trunkW - d(2), trunkH);

    ctx.fillStyle = PALETTE.TREE_TRUNK_LIGHT;
    ctx.fillRect(trunkX + d(1), trunkY, d(1), trunkH);

    ctx.fillStyle = PALETTE.TREE_TRUNK_DARK;
    ctx.fillRect(trunkX + d(2), trunkY + d(8), d(1), d(2));
    ctx.fillRect(trunkX + d(1), trunkY + d(15), d(1), d(1));

    // --- FOLIAGE ---
    const canopyCY = o.renderBounds.y + treeH * 0.35; 
    const canopyR = treeW * 0.45;

    const drawRoughCircle = (x: number, y: number, r: number, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    };

    drawRoughCircle(cx, canopyCY + d(6), canopyR, PALETTE.TREE_LEAVES_DARKEST);
    drawRoughCircle(cx - canopyR*0.6, canopyCY + d(8), canopyR*0.7, PALETTE.TREE_LEAVES_DARKEST);
    drawRoughCircle(cx + canopyR*0.6, canopyCY + d(8), canopyR*0.7, PALETTE.TREE_LEAVES_DARKEST);

    drawRoughCircle(cx, canopyCY, canopyR, PALETTE.TREE_LEAVES_DARK);
    drawRoughCircle(cx - canopyR*0.5, canopyCY + d(2), canopyR*0.6, PALETTE.TREE_LEAVES_DARK);
    drawRoughCircle(cx + canopyR*0.5, canopyCY + d(2), canopyR*0.6, PALETTE.TREE_LEAVES_DARK);

    drawRoughCircle(cx, canopyCY - d(2), canopyR*0.7, PALETTE.TREE_LEAVES_MID);
    drawRoughCircle(cx - canopyR*0.4, canopyCY, canopyR*0.5, PALETTE.TREE_LEAVES_MID);
    drawRoughCircle(cx + canopyR*0.4, canopyCY, canopyR*0.5, PALETTE.TREE_LEAVES_MID);

    drawRoughCircle(cx, canopyCY - d(4), canopyR*0.5, PALETTE.TREE_LEAVES_LIGHT);
    drawRoughCircle(cx - canopyR*0.3, canopyCY - d(2), canopyR*0.4, PALETTE.TREE_LEAVES_LIGHT);
    drawRoughCircle(cx + canopyR*0.3, canopyCY - d(2), canopyR*0.4, PALETTE.TREE_LEAVES_LIGHT);
};

