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

    (o.apples ?? []).forEach((apple) => {
      if (
        apple.state === "hanging" ||
        apple.state === "falling" ||
        apple.state === "onGround"
      ) {
        drawApple(ctx, apple.x, apple.y);
      }
    });
};

const drawApple = (
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
) => {
  const r = d(1.8);

  // Apple body — slightly wider than tall, drawn as two overlapping ovals
  // Bottom half slightly wider to give apple silhouette
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.ellipse(ax, ay + r * 0.1, r * 1.05, r, 0, 0, Math.PI * 2);
  ctx.fill();

  // Top indent — small dark notch at top center where stem sits
  ctx.fillStyle = '#a93226';
  ctx.beginPath();
  ctx.ellipse(ax, ay - r * 0.75, r * 0.25, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shading — darker right side for roundness
  ctx.fillStyle = '#a93226';
  ctx.beginPath();
  ctx.ellipse(ax + r * 0.35, ay + r * 0.15, r * 0.55, r * 0.8, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Highlight — bright spot top left
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.ellipse(ax - r * 0.3, ay - r * 0.2, r * 0.45, r * 0.35, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight — small bright white-ish dot
  ctx.fillStyle = '#ff8a80';
  ctx.beginPath();
  ctx.ellipse(ax - r * 0.35, ay - r * 0.3, r * 0.2, r * 0.15, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // Stem — short, slightly off-center, coming from indent
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = Math.max(1, d(0.5));
  ctx.beginPath();
  ctx.moveTo(ax + d(0.1), ay - r * 0.85);
  ctx.quadraticCurveTo(ax + d(0.8), ay - r * 1.3, ax + d(0.5), ay - r * 1.6);
  ctx.stroke();

  // Leaf — rounded oval, angled up-right from stem
  ctx.fillStyle = '#27ae60';
  ctx.beginPath();
  ctx.ellipse(
    ax + d(1.0),
    ay - r * 1.35,
    d(1.1),
    d(0.55),
    -0.6,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Leaf vein — thin line through center of leaf
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = Math.max(1, d(0.2));
  ctx.beginPath();
  ctx.moveTo(ax + d(0.3), ay - r * 1.2);
  ctx.lineTo(ax + d(1.6), ay - r * 1.5);
  ctx.stroke();
};

