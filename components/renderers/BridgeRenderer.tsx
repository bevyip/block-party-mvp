import { Obstacle } from '../../types';
import { SCALE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);

export const drawBridge = (
    ctx: CanvasRenderingContext2D,
    bridgeSegments: Obstacle[]
) => {
    if (bridgeSegments.length === 0) return;

    // Find the bridge's overall bounds from the river segments
    const minX = Math.min(...bridgeSegments.map(b => b.renderBounds.x));
    const maxX = Math.max(...bridgeSegments.map(b => b.renderBounds.x + b.renderBounds.width));
    const minY = Math.min(...bridgeSegments.map(b => b.renderBounds.y));
    const maxY = Math.max(...bridgeSegments.map(b => b.renderBounds.y + b.renderBounds.height));
    
    // Extend the bridge significantly onto the land to ensure connection (s(12) extension)
    const bridgeStart = minX - s(12);
    const bridgeEnd = maxX + s(12);
    const bridgeWidth = bridgeEnd - bridgeStart;
    
    // Calculate vertical center and use a fixed height for visual cleanliness
    const centerY = (minY + maxY) / 2;
    const fixedHeight = s(22); // Reduced from 28 to 22 for narrower bridge
    const drawY = centerY - fixedHeight / 2;
    const bridgeHeight = fixedHeight;

    // --- SHADOW (Flat on water) ---
    // Draw the shadow at the base water level to emphasize the arch's height relative to the water
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(bridgeStart, drawY + s(4), bridgeWidth, bridgeHeight);

    // --- ARCHED DECK ---
    const plankWidth = s(4);
    const numPlanks = Math.ceil(bridgeWidth / plankWidth);
    const maxLift = s(8); // Reduced arch height slightly to match narrower width

    for (let i = 0; i < numPlanks; i++) {
        const currentX = bridgeStart + i * plankWidth;
        
        // Ensure we don't overshoot width
        const w = Math.min(plankWidth, bridgeStart + bridgeWidth - currentX);
        if (w <= 0) break;

        // Calculate Arch Lift (Parabola)
        // Normalize x position to 0..1 range
        const t = i / (numPlanks - 1 || 1); 
        // Parabolic formula: 0 at ends, 1 at center
        const parabola = 1 - Math.pow(2 * t - 1, 2);
        const lift = Math.floor(maxLift * parabola);
        
        // Apply lift (move UP on screen, which is negative Y)
        const y = drawY - lift;

        // Draw Plank Slice
        
        // 1. Structure/Support (Darker wood visible below deck)
        ctx.fillStyle = '#4a3218'; // Dark wood
        ctx.fillRect(currentX, y + s(2), w, bridgeHeight);

        // 2. Main Deck (Lighter wood)
        ctx.fillStyle = '#8b6f47'; 
        ctx.fillRect(currentX, y, w, bridgeHeight);
        
        // 3. Plank Detail (Gap/Texture)
        ctx.fillStyle = '#6b5735'; 
        ctx.fillRect(currentX + w - s(1), y, s(1), bridgeHeight);

        // 4. Rails (Follow the curve)
        const railHeight = s(3);
        ctx.fillStyle = '#5c4033'; // Darker rail color
        
        // Top Rail
        ctx.fillRect(currentX, y - s(2), w, railHeight);
        // Bottom Rail
        ctx.fillRect(currentX, y + bridgeHeight - s(1), w, railHeight);
    }

    // --- POSTS (Anchors at ends) ---
    // Draw posts at the original ground level (no lift) to anchor the bridge
    ctx.fillStyle = '#3e2723';
    
    // Left posts
    ctx.fillRect(bridgeStart, drawY - s(4), s(4), s(6)); // Top
    ctx.fillRect(bridgeStart, drawY + bridgeHeight - s(2), s(4), s(6)); // Bottom
    
    // Right posts
    ctx.fillRect(bridgeEnd - s(4), drawY - s(4), s(4), s(6)); // Top
    ctx.fillRect(bridgeEnd - s(4), drawY + bridgeHeight - s(2), s(4), s(6)); // Bottom
};

