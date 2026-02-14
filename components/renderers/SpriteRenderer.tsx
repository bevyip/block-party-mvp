import { Sprite } from '../../types';
import { SCALE } from '../../constants';

const s = (val: number) => Math.floor(val * SCALE);

export const drawSprite = (
    ctx: CanvasRenderingContext2D,
    spr: Sprite
) => {
    const bob = Math.floor(Math.sin(spr.bobOffset) * 1.2 * SCALE); // Slower, heavier bob
    const sx = Math.floor(spr.x);
    // Base Y is the top of the sprite. The bob affects the whole body.
    const sy = Math.floor(spr.y - Math.abs(bob));
    
    // --- SHADOW ---
    // Draw a small oval shadow at the feet (always at base position, no bob)
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(sx + s(2), Math.floor(spr.y) + s(15), s(4), s(1)); // Centered shadow

    // --- HELPER FUNCTIONS ---
    // Helper to draw a rect at pixel coordinates (x, y) relative to sprite origin
    const r = (x: number, y: number, w: number, h: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(sx + s(x), sy + s(y), s(w), s(h));
    };

    // --- RENDER BASED ON FACING ---
    if (spr.facing === 'front') {
        // --- FRONT VIEW (IDLE/MOVING) ---
        
        // 1. HAIR (Back/Base)
        r(1, 0, 6, 3, spr.hairColor); // Main top volume
        r(0, 1, 1, 2, spr.hairColor); // Left side volume
        r(7, 1, 1, 2, spr.hairColor); // Right side volume
        
        // 2. FACE
        r(1, 3, 6, 4, spr.skinTone); // Face block
        
        // Eyes
        r(2, 5, 1, 1, '#000'); // Left Eye
        r(5, 5, 1, 1, '#000'); // Right Eye
        
        // Hair (Bangs/Sideburns overlapping face)
        r(0, 3, 1, 3, spr.hairColor); // Left sideburn
        r(7, 3, 1, 3, spr.hairColor); // Right sideburn
        
        // 3. BODY
        r(1, 7, 6, 4, spr.color); // Shirt Torso
        
        // Arms (At sides)
        r(0, 8, 1, 3, spr.color); // Left Arm
        r(7, 8, 1, 3, spr.color); // Right Arm
        
        // Skin on hands?
        r(0, 11, 1, 1, spr.skinTone); // Left Hand
        r(7, 11, 1, 1, spr.skinTone); // Right Hand
        
        // 4. LEGS/PANTS
        r(2, 11, 4, 1, spr.pantsColor); // Waistband
        r(2, 12, 2, 3, spr.pantsColor); // Left Leg
        r(4, 12, 2, 3, spr.pantsColor); // Right Leg
        
        // 5. SHOES
        r(2, 15, 2, 1, '#333'); // Left Shoe
        r(4, 15, 2, 1, '#333'); // Right Shoe
        
    } else {
        // --- SIDE VIEW (LEFT or RIGHT) ---
        // We render 'Left' logic, and flip logic for 'Right' is handled by checking facing
        
        const isRight = spr.facing === 'right';
        
        // Calculate leg offset for walking animation
        // sin(offset) goes -1 to 1.
        // If > 0, left leg forward. If < 0, right leg forward.
        const walkCycle = Math.sin(spr.bobOffset);
        const legOffset = 1; // Pixels to move legs
        
        // Modified helper that applies transform
        const rt = (x: number, y: number, w: number, h: number, color: string) => {
             // If mirroring, we need to flip the rect position: 
             // x=0, w=2 becomes x=6 (8 - 2 - 0)
             const rx = isRight ? (8 - w - x) : x;
             ctx.fillStyle = color;
             ctx.fillRect(sx + s(rx), sy + s(y), s(w), s(h));
        };
        
        // 1. HEAD (Profile)
        rt(1, 0, 5, 3, spr.hairColor); // Top Hair
        rt(5, 1, 2, 5, spr.hairColor); // Back of head hair
        
        rt(1, 3, 4, 4, spr.skinTone); // Face profile
        
        rt(1, 5, 1, 1, '#000'); // Eye (on the leading edge)
        
        // 2. BODY
        rt(2, 7, 3, 4, spr.color); // Torso side view
        rt(3, 8, 2, 3, spr.color); // Arm (centered on side)
        rt(3, 11, 2, 1, spr.skinTone); // Hand
        
        // 3. LEGS (Scissor animation)
        const frontLegX = 2;
        const backLegX = 4;
        
        // Determine which leg is "front" visually (closest to viewer) vs "back" (further away)
        // In side view, usually one leg occludes the other or they are spaced.
        // Let's just draw two legs with offsets.
        
        let l1x = 2; 
        let l2x = 4; // Overlapping slightly or adjacent
        
        // Scissor effect
        // Leg 1 (Left leg/Front visual): 
        // Leg 2 (Right leg/Back visual):
        
        // We will just shift the feet pixels.
        // Static upper legs
        rt(2, 11, 3, 2, spr.pantsColor); // Pants butt/hips
        
        // Moving lower legs
        const legMove = Math.round(walkCycle * 2); // -2 to +2
        
        // Leg Closest (Front)
        rt(2 + legMove, 13, 2, 2, spr.pantsColor); 
        rt(2 + legMove, 15, 2, 1, '#333'); // Shoe
        
        // Leg Furthest (Back) - drawn first? No, drawn behind? 
        // Actually, let's keep it simple.
        // If moving, legs separate. If idle, legs together.
        
        if (spr.state === 'idle') {
             rt(2, 13, 3, 2, spr.pantsColor);
             rt(2, 15, 3, 1, '#333');
        } else {
             // Walking
             // Back leg (Left leg if facing left)
             const backOff = -legMove;
             rt(2 + backOff, 12, 2, 3, '#1a1a1a'); // Darker leg for depth? Or just pantsColor
             rt(2 + backOff, 15, 2, 1, '#333');
             
             // Front leg (Right leg if facing left)
             const frontOff = legMove;
             rt(2 + frontOff, 12, 2, 3, spr.pantsColor);
             rt(2 + frontOff, 15, 2, 1, '#333');
        }
    }
};

