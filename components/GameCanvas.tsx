import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { GAME_WIDTH, GAME_HEIGHT, PALETTE, SPRITE_SIZE, SPRITE_COUNT, SCALE } from '../constants';
import { GameState, Sprite, Obstacle, EntityType, Rect, Fish, SpriteResult } from '../types';
import { playBlip, playChirp } from '../utils/audio.js';

// Import Renderers
import { drawSprite } from './renderers/SpriteRenderer';
import { drawCustomSprite } from './renderers/CustomSpriteRenderer';
import { drawTree } from './renderers/TreeRenderer';
import { drawRock } from './renderers/RockRenderer';
import { drawFlower } from './renderers/FlowerRenderer';
import { drawRiver } from './renderers/RiverRenderer';
import { drawBridge } from './renderers/BridgeRenderer';
import { drawFish } from './renderers/FishRenderer';
import { drawSpeechBubble } from './renderers/SpeechBubbleRenderer';

// --- Utility Functions ---

const s = (val: number) => Math.floor(val * SCALE);

const getRandomEmoji = () => {
    // Unicode emoji ranges - Filtered to exclude B&W symbols/dingbats
    const emojiRanges = [
        [0x1F600, 0x1F64F], // Emoticons
        [0x1F300, 0x1F5FF], // Misc Symbols and Pictographs
        [0x1F680, 0x1F6FF], // Transport and Map
        [0x1F900, 0x1F9FF], // Supplemental Symbols and Pictographs
    ];
    
    // Pick a random range
    const range = emojiRanges[Math.floor(Math.random() * emojiRanges.length)];
    
    // Pick a random code point within that range
    const codePoint = Math.floor(Math.random() * (range[1] - range[0] + 1)) + range[0];
    
    // Convert to emoji
    return String.fromCodePoint(codePoint);
};

const AABB = (r1: Rect, r2: Rect) => {
  return (
    r1.x < r2.x + r2.width &&
    r1.x + r1.width > r2.x &&
    r1.y < r2.y + r2.height &&
    r1.y + r1.height > r2.y
  );
};

const distSq = (x1: number, y1: number, x2: number, y2: number) => {
  return (x1 - x2) ** 2 + (y1 - y2) ** 2;
};

export interface GameCanvasRef {
  addCustomSprite: (spriteResult: SpriteResult) => Promise<void>;
}

interface GameCanvasProps {
  isSpawning?: boolean;
}

export const GameCanvas = forwardRef<GameCanvasRef, GameCanvasProps>(({ isSpawning = false }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState>({ sprites: [], obstacles: [], fish: [] });
  const requestRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const bridgeCenterRef = useRef<{ x: number; y: number } | null>(null);
  const bridgeYRef = useRef<number>(GAME_HEIGHT / 2);
  const bridgeSegmentsRef = useRef<Obstacle[]>([]);
  const nextSpriteIdRef = useRef<number>(SPRITE_COUNT);
  
  // Expose method to add custom sprites
  useImperativeHandle(ref, () => ({
    addCustomSprite: async (spriteResult: SpriteResult) => {
      // Small delay to show spinner
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const state = gameStateRef.current;
      
      // Find bridge center for spawning
      const bridgeCenter = bridgeCenterRef.current;
      if (!bridgeCenter) {
        return;
      }

      // Create custom sprite
      // Position sprite exactly at bridge center coordinates
      const spriteHeight = spriteResult.dimensions.height * SCALE;
      const spriteWidth = spriteResult.dimensions.width * SCALE;
      
      // Randomly choose left or right direction (50/50 chance)
      const moveRight = Math.random() >= 0.5;
      const MOVEMENT_SPEED = 0.25 * SCALE;
      
      // Small delay before movement (1-2 seconds)
      const spawnDelay = 60 * (1 + Math.random()); // 1-2 seconds at 60fps
      
      const customSprite: Sprite = {
        id: nextSpriteIdRef.current++,
        x: bridgeCenter.x - spriteWidth / 2, // Center horizontally on bridge center
        y: bridgeCenter.y - spriteHeight / 2, // Center vertically on bridge center
        vx: 0, // Start with no movement
        vy: 0, // No vertical movement initially
        color: '#888', // Default colors (not used for custom sprites)
        hairColor: '#888',
        pantsColor: '#888',
        skinTone: '#888',
        interactionCooldown: Math.random() * 200,
        facing: moveRight ? 'right' : 'left', // Set facing direction but don't move yet
        bobOffset: Math.random() * Math.PI * 2,
        state: 'idle', // Start in idle state
        stateTimer: spawnDelay, // Wait before starting to move
        isCustom: true,
        customSprite: {
          matrix: spriteResult.matrix,
          dimensions: spriteResult.dimensions
        }
      };
      
      // Store intended direction on the sprite object for when timer expires
      (customSprite as any)._spawnDirection = moveRight ? 'right' : 'left';
      (customSprite as any)._spawnSpeed = MOVEMENT_SPEED;

      // Adjust sprite size for collision (feet collision box)
      const spriteBox = { 
        x: customSprite.x, 
        y: customSprite.y + spriteResult.dimensions.height * SCALE / 2, 
        width: spriteResult.dimensions.width * SCALE, 
        height: spriteResult.dimensions.height * SCALE / 2 
      };

      // Check if sprite is on a bridge segment (bridge takes precedence over water)
      const isOnBridge = bridgeSegmentsRef.current.some(bridge => {
        return AABB(spriteBox, bridge.bounds);
      });

      // Check collision with obstacles (apply bridge > water logic)
      const collision = state.obstacles.some(o => {
        // Always skip decorative elements and bridges
        if (o.type === EntityType.FLOWER || o.type === EntityType.GRASS_PATCH || o.type === EntityType.BRIDGE) return false;
        
        // If sprite is on bridge, allow spawning even if there's water below (bridge takes precedence)
        if (isOnBridge && o.type === EntityType.RIVER_SEGMENT) return false;
        
        // Check collision with other obstacles (trees, rocks, water when not on bridge)
        return AABB(spriteBox, o.bounds);
      });

      if (!collision) {
        state.sprites.push(customSprite);
      } else {
        // Try spawning slightly offset if there's a collision
        customSprite.x += s(20);
        const altSpriteBox = { 
          x: customSprite.x, 
          y: customSprite.y + spriteResult.dimensions.height * SCALE / 2, 
          width: spriteResult.dimensions.width * SCALE, 
          height: spriteResult.dimensions.height * SCALE / 2 
        };
        
        // Check if alternative position is on bridge
        const altIsOnBridge = bridgeSegmentsRef.current.some(bridge => {
          return AABB(altSpriteBox, bridge.bounds);
        });
        
        const altCollision = state.obstacles.some(o => {
          if (o.type === EntityType.FLOWER || o.type === EntityType.GRASS_PATCH || o.type === EntityType.BRIDGE) return false;
          // Bridge takes precedence over water
          if (altIsOnBridge && o.type === EntityType.RIVER_SEGMENT) return false;
          return AABB(altSpriteBox, o.bounds);
        });
        if (!altCollision) {
          state.sprites.push(customSprite);
        }
      }
      
      // Small delay before hiding spinner
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }));

  // Initialization
  const initGame = useCallback(() => {
    const obstacles: Obstacle[] = [];

    // Helper to check if a rect collides with any existing hard obstacle (for generation)
    const isColliding = (rect: Rect) => {
        return obstacles.some(o => {
            if (o.type === EntityType.FLOWER || o.type === EntityType.GRASS_PATCH) return false;
            return AABB(rect, o.bounds);
        });
    };
    
    // 1. Generate River (S-curve)
    const riverPoints = [];
    
    // EXTENDED RANGE: Generate points from -2 to 12 (t from -0.2 to 1.2)
    for(let i = -2; i <= 12; i++) {
        const t = i/10;
        // Curve across the map
        const x = (GAME_WIDTH * 0.2) + (t * GAME_WIDTH * 0.6) + Math.sin(t * Math.PI * 2) * s(40);
        const y = t * GAME_HEIGHT;
        riverPoints.push({x, y});
    }

    // Connect points with segments
    for(let i=0; i<riverPoints.length - 1; i++) {
        const p1 = riverPoints[i];
        const p2 = riverPoints[i+1];
        const steps = 12;
        for(let j=0; j<steps; j++) {
            const t = j/steps;
            const rx = p1.x + (p2.x - p1.x) * t;
            const ry = p1.y + (p2.y - p1.y) * t;
            obstacles.push({
                id: `river-${i}-${j}`,
                type: EntityType.RIVER_SEGMENT,
                bounds: { x: rx - s(14), y: ry, width: s(28), height: s(28) },
                renderBounds: { x: rx - s(14), y: ry, width: s(28), height: s(28) },
                variant: 0
            });
        }
    }

    // 2. Add Bridge
    const bridgeY = GAME_HEIGHT / 2;
    const riverSegments = obstacles.filter(o => o.type === EntityType.RIVER_SEGMENT);
    const bridgeSegments = riverSegments.filter(o => Math.abs(o.bounds.y - bridgeY) < s(11));
    bridgeSegments.forEach(b => b.type = EntityType.BRIDGE);

    // Store bridge info for movement logic
    bridgeYRef.current = bridgeY;
    bridgeSegmentsRef.current = bridgeSegments;

    // Store bridge center for custom sprite spawning
    // Set as constant true center - calculated once during initialization
    const bridgeCenterX = GAME_WIDTH / 2; // True center of the map
    bridgeCenterRef.current = { x: bridgeCenterX, y: bridgeY };

    // 3. Grass Patches (Visual Texture)
    for(let i=0; i<12; i++) {
        const cx = Math.random() * GAME_WIDTH;
        const cy = Math.random() * GAME_HEIGHT;
        const subPatches = 3 + Math.floor(Math.random() * 3);
        for(let j=0; j<subPatches; j++) {
            obstacles.push({
                id: `grass-${i}-${j}`,
                type: EntityType.GRASS_PATCH,
                bounds: { x: 0, y: 0, width: 0, height: 0 },
                renderBounds: { 
                    x: cx + (Math.random() - 0.5) * s(40), 
                    y: cy + (Math.random() - 0.5) * s(30), 
                    width: s(10 + Math.random() * 20), 
                    height: s(10 + Math.random() * 15) 
                },
                variant: 0
            });
        }
    }

    // 4. Tree Formations
    const treeW = s(24);
    const treeH = s(32);
    const treeCollisionH = s(8);
    const treeCollisionW = s(12);
    
    const addTree = (tx: number, ty: number) => {
        const bounds = { 
            x: tx + (treeW - treeCollisionW)/2, 
            y: ty + treeH - treeCollisionH - s(2), 
            width: treeCollisionW, 
            height: treeCollisionH 
        };
        
        if (!isColliding(bounds)) {
            obstacles.push({
                id: `tree-${Math.random()}`,
                type: EntityType.TREE,
                bounds,
                renderBounds: { x: tx, y: ty, width: treeW, height: treeH },
                variant: Math.floor(Math.random() * 3)
            });
        }
    };

    // Formation 1: Gentle Curve (Top Left)
    const curveStart = { x: s(40), y: s(40) };
    for(let i=0; i<6; i++) {
        addTree(
            curveStart.x + i * s(20) + Math.sin(i*0.5)*s(10), 
            curveStart.y + i * s(15) + (Math.random()-0.5)*s(5)
        );
    }

    // Formation 2: Corner (Top Right)
    const corner = { x: GAME_WIDTH - s(80), y: s(50) };
    addTree(corner.x, corner.y);
    addTree(corner.x - s(20), corner.y + s(5));
    addTree(corner.x + s(5), corner.y + s(20));
    addTree(corner.x - s(15), corner.y + s(25));

    // Formation 3: Diagonal Line (Bottom Left)
    const diag = { x: s(60), y: GAME_HEIGHT - s(100) };
    for(let i=0; i<5; i++) {
        addTree(
            diag.x + i * s(18) + (Math.random()-0.5)*s(4),
            diag.y + i * s(12) + (Math.random()-0.5)*s(4)
        );
    }

    // Formation 4: Cluster (Bottom Right)
    const cluster = { x: GAME_WIDTH - s(100), y: GAME_HEIGHT - s(80) };
    addTree(cluster.x, cluster.y);
    addTree(cluster.x + s(20), cluster.y);
    addTree(cluster.x + s(10), cluster.y + s(15));

    // Standalone random trees
    for(let i=0; i<4; i++) {
        addTree(Math.random() * (GAME_WIDTH - treeW), Math.random() * (GAME_HEIGHT - treeH));
    }

    // 5. Rocks
    const rockW = s(16);
    const rockH = s(12);
    for(let i=0; i<8; i++) {
        let placed = false;
        let attempts = 0;
        while(!placed && attempts < 20) {
            const x = Math.random() * (GAME_WIDTH - rockW);
            const y = Math.random() * (GAME_HEIGHT - rockH);
            const bounds = { x: x, y: y + s(4), width: rockW, height: rockH - s(4) };
            
            if (!isColliding(bounds)) {
                obstacles.push({
                    id: `rock-${i}`,
                    type: EntityType.ROCK,
                    bounds,
                    renderBounds: { x, y, width: rockW, height: rockH },
                    variant: Math.floor(Math.random() * 3)
                });
                placed = true;
            }
            attempts++;
        }
    }

    // 6. Flowers (No collision)
    for(let i=0; i<20; i++) {
        obstacles.push({
            id: `flower-${i}`,
            type: EntityType.FLOWER,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            renderBounds: { 
                x: Math.random() * GAME_WIDTH, 
                y: Math.random() * GAME_HEIGHT, 
                width: s(6), 
                height: s(6) 
            },
            variant: 0
        });
    }

    // 7. Sprites (5 initial sprites)
    const sprites: Sprite[] = [];
    const shirtColors = ['#e74c3c', '#3498db', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#bdc3c7', '#34495e'];
    const hairColors = ['#f1c40f', '#8e44ad', '#d35400', '#2c3e50', '#7f8c8d', '#5d4037', '#e5c07b'];
    const pantsColors = ['#2c3e50', '#3e2723', '#273c75', '#353b48', '#40739e'];
    const skinTones = ['#ffccaa', '#f1c27d', '#e0ac69', '#8d5524', '#c68642'];

    for(let i=0; i<SPRITE_COUNT; i++) {
        let validPos = false;
        let sx = 0, sy = 0;
        let attempts = 0;

        while(!validPos && attempts < 100) {
            sx = Math.random() * (GAME_WIDTH - s(20)) + s(10);
            sy = Math.random() * (GAME_HEIGHT - s(20)) + s(10);
            const spriteBox = { x: sx, y: sy + SPRITE_SIZE.h/2, width: SPRITE_SIZE.w, height: SPRITE_SIZE.h/2 };
            
            const collision = obstacles.some(o => {
                if (o.type === EntityType.FLOWER || o.type === EntityType.GRASS_PATCH || o.type === EntityType.BRIDGE) return false;
                return AABB(spriteBox, o.bounds);
            });

            if (!collision) validPos = true;
            attempts++;
        }

        if (validPos) {
            sprites.push({
                id: i,
                x: sx,
                y: sy,
                vx: 0,
                vy: 0,
                color: shirtColors[Math.floor(Math.random() * shirtColors.length)],
                hairColor: hairColors[Math.floor(Math.random() * hairColors.length)],
                pantsColor: pantsColors[Math.floor(Math.random() * pantsColors.length)],
                skinTone: skinTones[Math.floor(Math.random() * skinTones.length)],
                interactionCooldown: Math.random() * 200,
                facing: 'front',
                bobOffset: Math.random() * Math.PI * 2,
                state: 'idle',
                stateTimer: 60 * (3 + Math.random() * 5)
            });
        }
    }

    // 8. Fish
    const fish: Fish[] = [];
    const fishColors = ['#ff8c00', '#ffd700', '#ff4444', '#ff69b4', '#00d4ff'];
    const fishCount = 1 + Math.floor(Math.random() * 4);

    for (let i = 0; i < fishCount; i++) {
        fish.push({
            id: i,
            x: 0,
            y: Math.random() * GAME_HEIGHT,
            color: fishColors[Math.floor(Math.random() * fishColors.length)],
            speed: 0.05 + Math.random() * 0.1, 
            direction: Math.random() > 0.5 ? 1 : -1,
            facingRight: Math.random() > 0.5,
            wiggleOffset: Math.random() * Math.PI * 2,
            riverOffset: (Math.random() - 0.5) * s(10)
        });
    }

    gameStateRef.current = { sprites, obstacles, fish };
    setIsPlaying(true);
  }, []);

  // Update Loop
  const update = useCallback(() => {
    const state = gameStateRef.current;
    const MOVEMENT_SPEED = 0.25 * SCALE;

    // --- Update Fish ---
    state.fish.forEach(fish => {
        fish.y += fish.speed * fish.direction * SCALE;

        const buffer = s(12);
        if (fish.direction === 1 && fish.y > GAME_HEIGHT + buffer) {
            fish.y = -buffer;
        } else if (fish.direction === -1 && fish.y < -buffer) {
            fish.y = GAME_HEIGHT + buffer;
        }

        const t = fish.y / GAME_HEIGHT;
        const riverCenterX = (GAME_WIDTH * 0.2) + (t * GAME_WIDTH * 0.6) + Math.sin(t * Math.PI * 2) * s(40);
        
        fish.x = riverCenterX + fish.riverOffset;
        fish.wiggleOffset += 0.03;
    });

    state.sprites.forEach(sprite => {
        // --- State Machine ---
        if (sprite.state === 'idle') {
            sprite.vx = 0;
            sprite.vy = 0;
            sprite.facing = 'front';
            sprite.bobOffset += 0.05; 

            sprite.stateTimer--;
            if (sprite.stateTimer <= 0) {
                sprite.state = 'moving';
                sprite.stateTimer = 60 * (1 + Math.random() * 3);
                
                // Check if this is a newly spawned custom sprite with a pending direction
                const pendingDirection = (sprite as any)._spawnDirection;
                const pendingSpeed = (sprite as any)._spawnSpeed;
                
                if (pendingDirection && pendingSpeed) {
                    // Use the stored spawn direction for newly spawned custom sprites
                    sprite.vx = pendingDirection === 'right' ? pendingSpeed : -pendingSpeed;
                    sprite.vy = 0;
                    sprite.facing = pendingDirection;
                    // Clear the pending direction
                    delete (sprite as any)._spawnDirection;
                    delete (sprite as any)._spawnSpeed;
                } else {
                    // Normal movement logic for other sprites
                    // Check if sprite is near or on the bridge
                    const spriteCenterY = sprite.y + (sprite.isCustom && sprite.customSprite 
                        ? sprite.customSprite.dimensions.height * SCALE / 2
                        : SPRITE_SIZE.h / 2);
                    const distanceFromBridge = Math.abs(spriteCenterY - bridgeYRef.current);
                    const isNearBridge = distanceFromBridge < s(40); // Within 40 pixels of bridge center
                    
                    // Check if sprite is actually on a bridge segment
                    const spriteW = sprite.isCustom && sprite.customSprite 
                        ? sprite.customSprite.dimensions.width * SCALE 
                        : SPRITE_SIZE.w;
                    const spriteH = sprite.isCustom && sprite.customSprite 
                        ? sprite.customSprite.dimensions.height * SCALE 
                        : SPRITE_SIZE.h;
                    const spriteBox: Rect = { 
                        x: sprite.x, 
                        y: sprite.y + spriteH/2, 
                        width: spriteW, 
                        height: spriteH/2 
                    };
                    const isOnBridge = bridgeSegmentsRef.current.some(bridge => {
                        return AABB(spriteBox, bridge.bounds);
                    });
                    
                    const rand = Math.random();
                    
                    // If on bridge, strongly favor horizontal movement (80% horizontal, 20% vertical)
                    if (isOnBridge) {
                        if (rand < 0.4) { 
                            sprite.vx = MOVEMENT_SPEED; 
                            sprite.vy = 0; 
                            sprite.facing = 'right'; 
                        }
                        else if (rand < 0.8) { 
                            sprite.vx = -MOVEMENT_SPEED; 
                            sprite.vy = 0; 
                            sprite.facing = 'left'; 
                        }
                        else if (rand < 0.9) { 
                            sprite.vx = 0; 
                            sprite.vy = MOVEMENT_SPEED; 
                            sprite.facing = 'front'; 
                        }
                        else { 
                            sprite.vx = 0; 
                            sprite.vy = -MOVEMENT_SPEED; 
                            sprite.facing = 'front'; 
                        }
                    }
                    // If near bridge, favor horizontal movement (60% horizontal, 40% vertical)
                    else if (isNearBridge) {
                        if (rand < 0.3) { 
                            sprite.vx = MOVEMENT_SPEED; 
                            sprite.vy = 0; 
                            sprite.facing = 'right'; 
                        }
                        else if (rand < 0.6) { 
                            sprite.vx = -MOVEMENT_SPEED; 
                            sprite.vy = 0; 
                            sprite.facing = 'left'; 
                        }
                        else if (rand < 0.8) { 
                            sprite.vx = 0; 
                            sprite.vy = MOVEMENT_SPEED; 
                            sprite.facing = 'front'; 
                        }
                        else { 
                            sprite.vx = 0; 
                            sprite.vy = -MOVEMENT_SPEED; 
                            sprite.facing = 'front'; 
                        }
                    }
                    // Normal movement distribution (25% each direction)
                    else {
                        if (rand < 0.25) { sprite.vx = MOVEMENT_SPEED; sprite.vy = 0; sprite.facing = 'right'; }
                        else if (rand < 0.5) { sprite.vx = -MOVEMENT_SPEED; sprite.vy = 0; sprite.facing = 'left'; }
                        else if (rand < 0.75) { sprite.vx = 0; sprite.vy = MOVEMENT_SPEED; sprite.facing = 'front'; }
                        else { sprite.vx = 0; sprite.vy = -MOVEMENT_SPEED; sprite.facing = 'front'; }
                    }
                }
            }
        } 
        else if (sprite.state === 'moving') {
            sprite.bobOffset += 0.15;
            sprite.stateTimer--;
            if (sprite.stateTimer <= 0) {
                sprite.state = 'idle';
                sprite.stateTimer = 60 * (3 + Math.random() * 5);
            }
        }

        // --- Movement & Collision ---
        if (sprite.state === 'moving') {
            let nextX = sprite.x + sprite.vx;
            let nextY = sprite.y + sprite.vy;
            let hit = false;

            // Get sprite dimensions (custom or default)
            const spriteW = sprite.isCustom && sprite.customSprite 
                ? sprite.customSprite.dimensions.width * SCALE 
                : SPRITE_SIZE.w;
            const spriteH = sprite.isCustom && sprite.customSprite 
                ? sprite.customSprite.dimensions.height * SCALE 
                : SPRITE_SIZE.h;

            // 1. Screen Bounds
            if (nextX < 0 || nextX > GAME_WIDTH - spriteW || nextY < 0 || nextY > GAME_HEIGHT - spriteH) {
                hit = true;
            }

            // 2. Obstacles
            if (!hit) {
                const spriteBox: Rect = { x: nextX, y: nextY + spriteH/2, width: spriteW, height: spriteH/2 };
                
                // Check if sprite is currently on a bridge
                const currentSpriteBox: Rect = { x: sprite.x, y: sprite.y + spriteH/2, width: spriteW, height: spriteH/2 };
                const isOnBridge = bridgeSegmentsRef.current.some(bridge => {
                    return AABB(currentSpriteBox, bridge.bounds);
                });
                
                // Check if sprite will be on bridge at next position
                const willBeOnBridge = bridgeSegmentsRef.current.some(bridge => {
                    return AABB(spriteBox, bridge.bounds);
                });
                
                // Check if sprite is moving horizontally
                const isMovingHorizontally = sprite.vx !== 0 && sprite.vy === 0;
                
                // Check if sprite is at bridge Y level (within tolerance)
                // This helps detect when sprite is exiting the bridge even if collision box doesn't overlap
                const spriteFeetY = sprite.y + spriteH;
                const isAtBridgeLevel = Math.abs(spriteFeetY - bridgeYRef.current) < s(20);
                
                // Allow horizontal movement over water if:
                // 1. Sprite is currently on bridge (allows exit momentum when leaving bridge)
                // 2. OR sprite will be on bridge (allows entry when approaching bridge)
                // 3. OR sprite is at bridge level and moving horizontally (handles edge cases at bridge ends)
                // This allows smooth entry and exit from the bridge in both directions
                const canCrossWater = (isOnBridge || willBeOnBridge || (isAtBridgeLevel && isMovingHorizontally)) && isMovingHorizontally;
                
                for (const obs of state.obstacles) {
                    // Always skip decorative elements
                    if (obs.type === EntityType.FLOWER || obs.type === EntityType.GRASS_PATCH || obs.type === EntityType.BRIDGE) continue;
                    
                    // If sprite is on bridge or entering bridge and moving horizontally, allow crossing even over water
                    // This ensures bridge crossing takes precedence over water collision
                    if (canCrossWater && obs.type === EntityType.RIVER_SEGMENT) {
                        continue; // Skip water collision when crossing bridge horizontally
                    }
                    
                    // Normal collision check for other obstacles (trees, rocks, water when not on bridge)
                    if (AABB(spriteBox, obs.bounds)) {
                        hit = true;
                        break;
                    }
                }
            }

            // 3. Other Sprites (Soft collision)
            if (!hit) {
                for (const other of state.sprites) {
                    if (other.id === sprite.id) continue;
                    
                    // Check collision with other sprite's current position
                    const otherCurrentDist = distSq(nextX, nextY, other.x, other.y);
                    
                    // If other sprite is also moving, check its next position to avoid deadlock
                    let otherNextX = other.x;
                    let otherNextY = other.y;
                    if (other.state === 'moving') {
                        otherNextX = other.x + other.vx;
                        otherNextY = other.y + other.vy;
                    }
                    const otherNextDist = distSq(nextX, nextY, otherNextX, otherNextY);
                    
                    // Use the minimum distance (either current or next position)
                    // This prevents deadlock when both sprites are moving
                    const minDist = Math.min(otherCurrentDist, otherNextDist);
                    
                    if (minDist < (10 * SCALE) ** 2) {
                        // Only block if other sprite is idle or moving towards us
                        // If both are moving and would pass each other, allow movement
                        if (other.state === 'moving') {
                            // Check if sprites are moving in opposite directions (would pass each other)
                            const dx = nextX - otherNextX;
                            const dy = nextY - otherNextY;
                            const dotProduct = (sprite.vx * (otherNextX - other.x)) + (sprite.vy * (otherNextY - other.y));
                            
                            // If moving towards each other and would overlap, block
                            // Otherwise allow (they're moving away or in same direction)
                            if (dotProduct < 0 && minDist < (8 * SCALE) ** 2) {
                                hit = true;
                            }
                            // If moving away from each other, don't block
                        } else {
                            // Other sprite is idle, block movement
                            hit = true;
                        }
                        
                        if (hit && sprite.interactionCooldown <= 0) {
                            sprite.interactionCooldown = 180;
                            if (Math.random() < 0.3) {
                                const icon = getRandomEmoji();
                                sprite.bubble = { text: icon, life: 240 };
                                playChirp();
                            }
                        }
                        if (hit) break;
                    }
                }
            }

            if (hit) {
                sprite.state = 'idle';
                sprite.stateTimer = 60 * (2 + Math.random() * 3);
                sprite.vx = 0;
                sprite.vy = 0;
                sprite.facing = 'front';
                
                if (sprite.interactionCooldown <= 0) {
                     sprite.interactionCooldown = 180;
                     if (Math.random() < 0.2) {
                        const icon = getRandomEmoji(); 
                        sprite.bubble = { text: icon, life: 240 };
                        playBlip(0.8);
                     }
                }
            } else {
                sprite.x = nextX;
                sprite.y = nextY;
            }
        }

        if (sprite.interactionCooldown > 0) sprite.interactionCooldown--;
        if (sprite.bubble) {
            sprite.bubble.life--;
            if (sprite.bubble.life <= 0) sprite.bubble = undefined;
        }
    });
  }, []);

  // Render Loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.imageSmoothingEnabled = false;

    const state = gameStateRef.current;

    // Clear
    ctx.fillStyle = PALETTE.GRASS_BASE;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Static Grass Patches (Base noise)
    ctx.fillStyle = PALETTE.GRASS_DARK;
    const grassStep = s(20);
    for (let x = 0; x < GAME_WIDTH; x += grassStep) {
        for (let y = 0; y < GAME_HEIGHT; y += grassStep) {
            if ((Math.sin(x/SCALE) + Math.cos(y/SCALE)) > 0.5) {
                ctx.fillRect(x + s(5), y + s(5), s(4), s(2));
            }
        }
    }

    // Render large grass patches (Visual only)
    state.obstacles.filter(o => o.type === EntityType.GRASS_PATCH).forEach(p => {
        ctx.fillStyle = PALETTE.GRASS_DARK;
        ctx.fillRect(p.renderBounds.x, p.renderBounds.y, p.renderBounds.width, p.renderBounds.height);
    });

    // 1. Draw River (Background Water) - Only draw actual river segments, not bridge segments
    const riverSegments = state.obstacles.filter(o => o.type === EntityType.RIVER_SEGMENT);
    drawRiver(ctx, riverSegments);

    // 2. Draw Fish (Now between River floor and Bridge)
    state.fish.forEach(fish => drawFish(ctx, fish));

    // 3. Draw Bridges (Over Fish)
    const bridgeSegments = state.obstacles.filter(o => o.type === EntityType.BRIDGE);
    drawBridge(ctx, bridgeSegments);

    // Sort renderables by Y (Sprites, Trees, Rocks)
    const renderList = [
        ...state.sprites.map(s => {
            const spriteH = s.isCustom && s.customSprite 
                ? s.customSprite.dimensions.height * SCALE 
                : SPRITE_SIZE.h;
            return { type: 'sprite', y: s.y + spriteH, obj: s };
        }),
        ...state.obstacles.filter(o => 
            o.type !== EntityType.RIVER_SEGMENT && 
            o.type !== EntityType.BRIDGE && 
            o.type !== EntityType.GRASS_PATCH
        ).map(o => ({ type: 'obstacle', y: o.bounds.y + o.bounds.height, obj: o }))
    ];

    renderList.sort((a, b) => a.y - b.y);

    renderList.forEach(item => {
        if (item.type === 'obstacle') {
            const o = item.obj as Obstacle;
            if (o.type === EntityType.TREE) drawTree(ctx, o);
            else if (o.type === EntityType.ROCK) drawRock(ctx, o);
            else if (o.type === EntityType.FLOWER) drawFlower(ctx, o);
        } else {
            const spr = item.obj as Sprite;
            if (spr.isCustom) {
                drawCustomSprite(ctx, spr);
            } else {
                drawSprite(ctx, spr);
            }
        }
    });

    // Draw Bubbles
    state.sprites.forEach(sprite => {
        if (sprite.bubble) {
            drawSpeechBubble(ctx, sprite);
        }
    });

  }, []);

  const tick = useCallback(() => {
    update();
    draw();
    requestRef.current = requestAnimationFrame(tick);
  }, [update, draw]);

  useEffect(() => {
    initGame();
    requestRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(requestRef.current);
  }, [initGame, tick]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border-4 border-white shadow-[0_0_20px_rgba(255,255,255,0.3)]">
        {/* Vignette Overlay */}
        <div className="absolute inset-0 pointer-events-none z-10" 
             style={{ background: 'radial-gradient(circle, rgba(0,0,0,0) 60%, rgba(0,0,0,0.4) 100%)' }}>
        </div>
        
        <canvas
            ref={canvasRef}
            width={GAME_WIDTH}
            height={GAME_HEIGHT}
            className="w-full h-full block"
            style={{ imageRendering: 'pixelated' }}
        />

        {/* Start Overlay (Audio gate) */}
        {!isPlaying && (
             <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                <p className="text-white font-mono animate-pulse">Initializing World...</p>
             </div>
        )}

        {/* Spawning Overlay */}
        {isSpawning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-30">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-white font-mono text-sm">Spawning sprite...</p>
            </div>
          </div>
        )}
    </div>
  );
});

GameCanvas.displayName = 'GameCanvas';

