/**
 * MAXIMUM FILL SCALING
 * 
 * Problem: Sprites using only 30-50% of canvas
 * Goal: Fill 90-95% of canvas (maximize pixel usage)
 * 
 * Strategy: Scale to fill either width OR height completely,
 *           whichever gives maximum coverage
 */

// ============================================================
// MAXIMUM FILL: Scale to Touch Canvas Edges
// ============================================================

/**
 * Center and scale sprite to MAXIMUM size
 * Fills width or height completely (whichever is limiting factor)
 */
centerAndMaxFillSprite(spriteGrid, targetWidth, targetHeight) {
    // Step 1: Get actual content bounds
    const bounds = this.getContentBounds(spriteGrid);
    
    if (!bounds) {
        return this.createEmptyGrid(targetHeight, targetWidth);
    }
    
    // Step 2: Extract just the content
    const content = this.extractContent(spriteGrid, bounds);
    
    const contentWidth = content[0]?.length || 0;
    const contentHeight = content.length;
    
    console.log(`[MaxFill] Content size: ${contentHeight}×${contentWidth}`);
    
    // Step 3: Calculate MAXIMUM scale (minimal padding)
    const paddingPixels = 1; // Just 1 pixel padding on each side
    const availableWidth = targetWidth - (paddingPixels * 2);
    const availableHeight = targetHeight - (paddingPixels * 2);
    
    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    
    // Use MINIMUM of the two (ensures sprite fits in both dimensions)
    // This will cause one dimension to fill completely
    const scale = Math.min(scaleX, scaleY);
    
    console.log(`[MaxFill] Scale: ${scale.toFixed(2)}× (width: ${scaleX.toFixed(2)}×, height: ${scaleY.toFixed(2)}×)`);
    console.log(`[MaxFill] Will fill ${scale === scaleX ? 'width' : 'height'} completely`);
    
    // Step 4: Scale the content
    const scaledWidth = Math.floor(contentWidth * scale);
    const scaledHeight = Math.floor(contentHeight * scale);
    
    const scaled = this.scaleGrid(content, scale);
    
    console.log(`[MaxFill] Scaled to: ${scaledHeight}×${scaledWidth}`);
    
    // Step 5: Center in canvas
    const centered = this.centerInCanvas(scaled, targetWidth, targetHeight);
    
    // Calculate actual usage
    const usage = (scaledWidth * scaledHeight) / (targetWidth * targetHeight) * 100;
    console.log(`[MaxFill] Canvas usage: ${usage.toFixed(1)}%`);
    
    return centered;
}

// ============================================================
// ALTERNATIVE: Fill BOTH Dimensions (May Distort Aspect Ratio)
// ============================================================

/**
 * Fill width AND height completely (distorts aspect ratio)
 * Only use if you want to force fill entire canvas
 */
centerAndDistortFillSprite(spriteGrid, targetWidth, targetHeight) {
    const bounds = this.getContentBounds(spriteGrid);
    if (!bounds) return this.createEmptyGrid(targetHeight, targetWidth);
    
    const content = this.extractContent(spriteGrid, bounds);
    const contentWidth = content[0]?.length || 0;
    const contentHeight = content.length;
    
    // Calculate separate scales for width and height
    const paddingPixels = 1;
    const scaleX = (targetWidth - paddingPixels * 2) / contentWidth;
    const scaleY = (targetHeight - paddingPixels * 2) / contentHeight;
    
    console.log(`[DistortFill] Scale X: ${scaleX.toFixed(2)}×, Y: ${scaleY.toFixed(2)}×`);
    
    // Scale with different X and Y factors (distorts aspect ratio)
    const scaled = this.scaleGridNonUniform(content, scaleX, scaleY, targetWidth - 2, targetHeight - 2);
    
    return this.centerInCanvas(scaled, targetWidth, targetHeight);
}

/**
 * Non-uniform scaling (different scale for X and Y)
 */
scaleGridNonUniform(grid, scaleX, scaleY, targetWidth, targetHeight) {
    const scaled = [];
    
    for (let y = 0; y < targetHeight; y++) {
        const row = [];
        for (let x = 0; x < targetWidth; x++) {
            const sourceY = Math.floor(y / scaleY);
            const sourceX = Math.floor(x / scaleX);
            row.push(grid[sourceY]?.[sourceX] || null);
        }
        scaled.push(row);
    }
    
    return scaled;
}

// ============================================================
// SMART APPROACH: Aspect-Aware Maximum Fill
// ============================================================

/**
 * Choose fill strategy based on aspect ratio
 */
centerAndSmartFillSprite(spriteGrid, targetWidth, targetHeight, options = {}) {
    const bounds = this.getContentBounds(spriteGrid);
    if (!bounds) return this.createEmptyGrid(targetHeight, targetWidth);
    
    const content = this.extractContent(spriteGrid, bounds);
    const contentWidth = content[0]?.length || 0;
    const contentHeight = content.length;
    
    const contentAspect = contentWidth / contentHeight;
    const targetAspect = targetWidth / targetHeight;
    
    const aspectDifference = Math.abs(contentAspect - targetAspect);
    
    console.log(`[SmartFill] Content aspect: ${contentAspect.toFixed(2)}, Target aspect: ${targetAspect.toFixed(2)}`);
    
    // If aspects are similar (within 20%), use uniform scaling
    if (aspectDifference < 0.2) {
        console.log('[SmartFill] Using uniform scale (aspects similar)');
        return this.centerAndMaxFillSprite(spriteGrid, targetWidth, targetHeight);
    }
    
    // If aspects very different, decide based on settings
    if (options.allowDistortion) {
        console.log('[SmartFill] Using non-uniform scale (fill both dimensions)');
        return this.centerAndDistortFillSprite(spriteGrid, targetWidth, targetHeight);
    } else {
        console.log('[SmartFill] Using uniform scale (preserve aspect)');
        return this.centerAndMaxFillSprite(spriteGrid, targetWidth, targetHeight);
    }
}

// ============================================================
// INTEGRATION: Replace Previous Centering Code
// ============================================================

/**
 * In GeminiSpriteConverter or OptimizedLiteBriteConverter:
 */
async processView(pegGrid, viewType, analysis) {
    const targetDimensions = this.getTargetDimensions(pegGrid);
    
    // ... existing processing ...
    
    // OLD:
    // processed = this.centerAndScaleSprite(processed, targetDimensions.width, targetDimensions.height);
    
    // NEW - MAXIMUM FILL:
    processed = this.centerAndMaxFillSprite(
        processed,
        targetDimensions.width,
        targetDimensions.height
    );
    
    return processed;
}

// ============================================================
// EXPECTED RESULTS FOR YOUR FLOWER
// ============================================================

/**
 * Your flower (assuming peg detection works):
 * 
 * Detected: Two flowers, ~10×15 peg grid
 * Target: 24×24 canvas
 * 
 * OLD (10% padding):
 * - Available: 21.6×21.6
 * - Scale: min(21.6/10, 21.6/15) = min(2.16, 1.44) = 1.44×
 * - Result: 14×22 sprite in 24×24 canvas
 * - Usage: 51%
 * - Top/bottom padding: 1px
 * - Left/right padding: 5px
 * 
 * NEW (1px padding):
 * - Available: 22×22
 * - Scale: min(22/10, 22/15) = min(2.2, 1.47) = 1.47×
 * - Result: 15×22 sprite in 24×24 canvas
 * - Usage: 57%
 * - Top/bottom padding: 1px ← TOUCHES EDGE
 * - Left/right padding: 4.5px
 * 
 * DISTORT FILL (if enabled):
 * - Scale X: 22/10 = 2.2×
 * - Scale Y: 22/15 = 1.47×
 * - Result: 22×22 sprite (fills completely!)
 * - Usage: 84%
 * - Warning: Aspect ratio changed from 10:15 → 1:1
 */

// ============================================================
// CONFIGURATION OPTIONS
// ============================================================

const FILL_STRATEGIES = {
    // Conservative: 10% padding, preserve aspect
    CONSERVATIVE: {
        paddingPercent: 0.1,
        preserveAspect: true,
        maxScale: 4
    },
    
    // Balanced: 5% padding, preserve aspect
    BALANCED: {
        paddingPercent: 0.05,
        preserveAspect: true,
        maxScale: 6
    },
    
    // Maximum: 1px padding, preserve aspect
    MAXIMUM: {
        paddingPixels: 1,
        preserveAspect: true,
        maxScale: 10
    },
    
    // Aggressive: 1px padding, allow distortion
    AGGRESSIVE: {
        paddingPixels: 1,
        preserveAspect: false,
        maxScale: 10
    }
};

// Usage:
const strategy = FILL_STRATEGIES.MAXIMUM;
processed = this.centerAndMaxFillSprite(processed, width, height, strategy);

// ============================================================
// DEBUGGING - See What's Happening
// ============================================================

// Add detailed logging:
centerAndMaxFillSprite(spriteGrid, targetWidth, targetHeight) {
    console.group('[MaxFill] Scaling sprite');
    
    const bounds = this.getContentBounds(spriteGrid);
    if (!bounds) {
        console.log('No content found');
        console.groupEnd();
        return this.createEmptyGrid(targetHeight, targetWidth);
    }
    
    const content = this.extractContent(spriteGrid, bounds);
    const contentWidth = content[0]?.length || 0;
    const contentHeight = content.length;
    
    console.log('Input:', {
        gridSize: `${spriteGrid.length}×${spriteGrid[0]?.length}`,
        contentSize: `${contentHeight}×${contentWidth}`,
        targetSize: `${targetHeight}×${targetWidth}`
    });
    
    const paddingPixels = 1;
    const availableWidth = targetWidth - (paddingPixels * 2);
    const availableHeight = targetHeight - (paddingPixels * 2);
    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY);
    
    console.log('Scaling:', {
        available: `${availableHeight}×${availableWidth}`,
        scaleX: scaleX.toFixed(2),
        scaleY: scaleY.toFixed(2),
        chosen: scale.toFixed(2),
        limitedBy: scale === scaleX ? 'width' : 'height'
    });
    
    const scaled = this.scaleGrid(content, scale);
    const scaledWidth = scaled[0]?.length || 0;
    const scaledHeight = scaled.length;
    
    console.log('Output:', {
        scaledSize: `${scaledHeight}×${scaledWidth}`,
        usage: `${((scaledWidth * scaledHeight) / (targetWidth * targetHeight) * 100).toFixed(1)}%`,
        paddingX: ((targetWidth - scaledWidth) / 2).toFixed(1),
        paddingY: ((targetHeight - scaledHeight) / 2).toFixed(1)
    });
    
    console.groupEnd();
    
    return this.centerInCanvas(scaled, targetWidth, targetHeight);
}

// ============================================================
// RECOMMENDATION
// ============================================================

/**
 * For your use case (Lite Brite to sprite):
 * 
 * Use: MAXIMUM strategy
 * - 1px padding (touches edges)
 * - Preserve aspect ratio
 * - No distortion
 * 
 * This will give you 80-95% canvas usage while keeping shapes accurate.
 * 
 * Your flower will fill height completely (top to bottom as requested),
 * with minimal padding on left/right sides.
 */
