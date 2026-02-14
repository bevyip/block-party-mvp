/**
 * Optimized Lite Brite to Sprite Converter
 *
 * Optimizations:
 * 1. Sparse designs → High pixel density (maintain all detail)
 * 2. Known color palette → Accurate color mapping
 */

import BoundaryAwarePegDetector from '../detection/boundary_aware_detector.js';

class OptimizedLiteBriteConverter {
    constructor(options = {}) {
        this.pegDetector = new BoundaryAwarePegDetector({
            minPegRadius: 6,
            maxPegRadius: 20,
            gridTolerance: 0.35,
            colorSampleRatio: 0.4,
            contrastBoost: 1.5,
            useAdaptiveThreshold: true,
        });

        // Known Lite Brite color palette
        this.LITEBRITE_PALETTE = {
            yellow: '#FFFF00',
            blue: '#0000FF',
            pink: '#FF69B4',    // Hot pink
            green: '#00FF00',
            white: '#FFFFFF',
            orange: '#FF8C00'   // Dark orange
        };

        this.SCALE = 3; // Render scale

        // Adaptive pixel density based on design size
        this.useAdaptiveDensity = options.useAdaptiveDensity !== false;
    }

    /**
     * Main conversion with sparse design optimization
     */
    async convertToSprite(imageSource) {
        // Step 1: Detect pegs
        console.log('[Sprite] Step 1: Detecting pegs from scanner image...');
        const pegResult = await this.pegDetector.detectPegs(imageSource);

        if (pegResult.confidence < 0.6) {
            console.warn(`[Sprite] Low detection confidence: ${pegResult.confidence.toFixed(2)}`);
        }

        const rawPegGrid = pegResult.grid || [];
        const pegDimensions = pegResult.dimensions || { rows: 0, cols: 0 };

        const totalPegs = this.countPegs(rawPegGrid);
        console.log(`[Sprite] Detected: ${pegDimensions.rows}×${pegDimensions.cols} grid with ${totalPegs} pegs`);
        if (pegResult.originalDimensions) {
            const orig = pegResult.originalDimensions.rows * pegResult.originalDimensions.cols;
            const crop = pegDimensions.rows * pegDimensions.cols;
            if (orig > 0) {
                const saved = ((1 - crop / orig) * 100).toFixed(0);
                console.log(`[Boundary] Cropped: ${pegResult.originalDimensions.rows}×${pegResult.originalDimensions.cols} → ${pegDimensions.rows}×${pegDimensions.cols} (${saved}% empty space removed)`);
            }
        }

        // Step 2: Snap colors to known palette
        console.log('[Sprite] Step 2: Mapping to Lite Brite palette...');
        const pegGrid = this.snapToPalette(rawPegGrid);

        // Step 3: Determine optimal sprite dimensions
        console.log('[Sprite] Step 3: Calculating optimal sprite size...');
        const spriteDimensions = this.calculateOptimalDimensions(
            pegGrid,
            totalPegs,
            pegDimensions
        );

        console.log(`[Sprite] Target sprite: ${spriteDimensions.width}×${spriteDimensions.height} (${spriteDimensions.width * spriteDimensions.height} pixels for ${totalPegs} pegs)`);

        // Step 4: Smart upsampling or minimal downsampling
        console.log('[Sprite] Step 4: Processing sprite...');
        let processedGrid;

        const needsDownsampling = pegDimensions.rows > spriteDimensions.height ||
                                   pegDimensions.cols > spriteDimensions.width;

        if (needsDownsampling) {
            processedGrid = this.minimalDownsample(pegGrid, spriteDimensions);
        } else {
            processedGrid = this.detailPreservingUpsample(pegGrid, spriteDimensions);
        }

        // Step 5: Refinement (very light - preserve user's intent)
        processedGrid = this.lightRefinement(processedGrid);

        // Step 6: Ensure palette consistency
        processedGrid = this.snapToPalette(processedGrid);

        // Step 6.5: Center and scale to maximum fill (1px padding, preserve aspect)
        console.log('[Sprite] Centering and scaling to fill canvas...');
        processedGrid = this.centerAndMaxFillSprite(
            processedGrid,
            spriteDimensions.width,
            spriteDimensions.height
        );

        // Step 7: Generate views
        const views = this.generateViews(processedGrid, spriteDimensions);

        return {
            dimensions: spriteDimensions,
            views: views,
            metadata: {
                originalSize: pegDimensions,
                originalPegCount: totalPegs,
                confidence: pegResult.confidence,
                pixelToPegRatio: totalPegs > 0 ? (spriteDimensions.width * spriteDimensions.height) / totalPegs : 0,
                processingMode: needsDownsampling ? 'downsampled' : 'upsampled'
            }
        };
    }

    calculateOptimalDimensions(pegGrid, totalPegs, pegDimensions) {
        const { rows: pegRows, cols: pegCols } = pegDimensions;
        const aspectRatio = pegRows > 0 ? pegCols / pegRows : 1;

        const archetype = aspectRatio > 1.3 ? 'wide' :
                         aspectRatio < 0.75 ? 'tall' : 'square';

        if (!this.useAdaptiveDensity) {
            const presets = {
                'wide': { width: 32, height: 24 },
                'tall': { width: 16, height: 32 },
                'square': { width: 24, height: 24 }
            };
            return { ...presets[archetype], archetype };
        }

        let targetPixels;

        if (totalPegs < 30) {
            targetPixels = totalPegs * 2.5;
            console.log(`[Sprite] Sparse design (${totalPegs} pegs): generous pixel budget`);
        } else if (totalPegs < 60) {
            targetPixels = totalPegs * 2;
        } else {
            targetPixels = totalPegs * 1.5;
        }

        const baseSize = Math.sqrt(Math.max(targetPixels, 1) / aspectRatio);
        let width = Math.round(baseSize * aspectRatio);
        let height = Math.round(baseSize);

        width = Math.max(width, 12);
        height = Math.max(height, 12);

        const maxDimension = 48;
        if (width > maxDimension || height > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }

        width = Math.round(width / 2) * 2;
        height = Math.round(height / 2) * 2;

        return { width, height, archetype };
    }

    snapToPalette(grid) {
        const paletteColors = Object.values(this.LITEBRITE_PALETTE);

        const snapped = grid.map(row =>
            row.map(cellColor => {
                if (!cellColor) return null;
                const { color, distance } = this.findClosestPaletteColorWithDistance(cellColor, paletteColors);
                if (distance > 120) return null; // Remove grays from sprite
                return color;
            })
        );

        return snapped;
    }

    findClosestPaletteColorWithDistance(cellColor, palette) {
        let minDist = Infinity;
        let closest = palette[0];
        const rgb1 = this.hexToRgb(cellColor);

        for (const paletteColor of palette) {
            const rgb2 = this.hexToRgb(paletteColor);
            const dist = Math.sqrt(
                Math.pow((rgb1.r - rgb2.r) * 0.3, 2) +
                Math.pow((rgb1.g - rgb2.g) * 0.59, 2) +
                Math.pow((rgb1.b - rgb2.b) * 0.11, 2)
            );
            if (dist < minDist) {
                minDist = dist;
                closest = paletteColor;
            }
        }
        return { color: closest, distance: minDist };
    }

    findClosestPaletteColor(color, palette) {
        return this.findClosestPaletteColorWithDistance(color, palette).color;
    }

    minimalDownsample(sourceGrid, targetDimensions) {
        const sourceHeight = sourceGrid.length;
        const sourceWidth = (sourceGrid[0] && sourceGrid[0].length) || 0;
        const { width: targetWidth, height: targetHeight } = targetDimensions;

        console.log(`[Sprite] Downsampling ${sourceWidth}×${sourceHeight} → ${targetWidth}×${targetHeight}`);

        const newGrid = Array(targetHeight).fill(null).map(() =>
            Array(targetWidth).fill(null)
        );

        const cellHeight = sourceHeight / targetHeight;
        const cellWidth = sourceWidth / targetWidth;

        for (let y = 0; y < targetHeight; y++) {
            for (let x = 0; x < targetWidth; x++) {
                const startY = Math.floor(y * cellHeight);
                const endY = Math.ceil((y + 1) * cellHeight);
                const startX = Math.floor(x * cellWidth);
                const endX = Math.ceil((x + 1) * cellWidth);

                const colors = [];

                for (let sy = startY; sy < endY && sy < sourceHeight; sy++) {
                    for (let sx = startX; sx < endX && sx < sourceWidth; sx++) {
                        if (sourceGrid[sy] && sourceGrid[sy][sx]) {
                            colors.push(sourceGrid[sy][sx]);
                        }
                    }
                }

                if (colors.length > 0) {
                    newGrid[y][x] = this.mostCommonColor(colors);
                }
            }
        }

        return newGrid;
    }

    detailPreservingUpsample(sourceGrid, targetDimensions) {
        const sourceHeight = sourceGrid.length;
        const sourceWidth = (sourceGrid[0] && sourceGrid[0].length) || 0;
        const { width: targetWidth, height: targetHeight } = targetDimensions;

        console.log(`[Sprite] Upsampling ${sourceWidth}×${sourceHeight} → ${targetWidth}×${targetHeight} (adding detail)`);

        const newGrid = Array(targetHeight).fill(null).map(() =>
            Array(targetWidth).fill(null)
        );

        const scaleX = targetWidth / sourceWidth;
        const scaleY = targetHeight / sourceHeight;

        for (let y = 0; y < targetHeight; y++) {
            for (let x = 0; x < targetWidth; x++) {
                const sourceY = Math.floor(y / scaleY);
                const sourceX = Math.floor(x / scaleX);

                if (sourceGrid[sourceY] && sourceGrid[sourceY][sourceX]) {
                    newGrid[y][x] = sourceGrid[sourceY][sourceX];
                }
            }
        }

        const smoothed = this.smartSmoothing(newGrid);
        return smoothed;
    }

    smartSmoothing(grid) {
        const smoothed = grid.map(row => [...row]);
        const height = grid.length;
        const width = (grid[0] && grid[0].length) || 0;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                if (!grid[y][x]) {
                    const neighbors = this.getNeighborColors(grid, y, x);

                    if (neighbors.length >= 2) {
                        const colorCounts = {};
                        for (const color of neighbors) {
                            colorCounts[color] = (colorCounts[color] || 0) + 1;
                        }

                        let maxCount = 0;
                        let fillColor = null;
                        for (const [color, count] of Object.entries(colorCounts)) {
                            if (count > maxCount) {
                                maxCount = count;
                                fillColor = color;
                            }
                        }

                        if (maxCount >= 2) {
                            smoothed[y][x] = fillColor;
                        }
                    }
                }
            }
        }

        return smoothed;
    }

    lightRefinement(grid) {
        const refined = grid.map(row => [...row]);

        for (let y = 0; y < grid.length; y++) {
            for (let x = 0; x < (grid[0] && grid[0].length) || 0; x++) {
                if (grid[y][x]) {
                    const neighbors = this.getColoredNeighborCount(grid, y, x);

                    if (neighbors === 0) {
                        refined[y][x] = null;
                    }
                }
            }
        }

        return refined;
    }

    generateViews(frontGrid, dimensions) {
        const views = {
            front: frontGrid,
            back: frontGrid.map(row => [...row].reverse()),
        };

        const compressionRatio = dimensions.archetype === 'wide' ? 0.4 :
                                dimensions.archetype === 'tall' ? 0.6 : 0.5;

        views.left = this.compressHorizontally(frontGrid, compressionRatio);
        views.right = views.left.map(row => [...row].reverse());

        return views;
    }

    countPegs(grid) {
        let count = 0;
        for (const row of grid || []) {
            for (const cell of row || []) {
                if (cell) count++;
            }
        }
        return count;
    }

    getNeighborColors(grid, y, x) {
        const colors = [];
        const neighbors = [
            [y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]
        ];

        for (const [ny, nx] of neighbors) {
            if (ny >= 0 && ny < grid.length && nx >= 0 && nx < (grid[0] && grid[0].length)) {
                if (grid[ny][nx]) {
                    colors.push(grid[ny][nx]);
                }
            }
        }

        return colors;
    }

    getColoredNeighborCount(grid, y, x) {
        let count = 0;
        const neighbors = [
            [y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1],
            [y - 1, x - 1], [y - 1, x + 1], [y + 1, x - 1], [y + 1, x + 1]
        ];

        for (const [ny, nx] of neighbors) {
            if (ny >= 0 && ny < grid.length && nx >= 0 && nx < (grid[0] && grid[0].length)) {
                if (grid[ny][nx]) count++;
            }
        }

        return count;
    }

    mostCommonColor(colors) {
        const counts = {};
        let maxCount = 0;
        let mostCommon = colors[0];

        for (const color of colors) {
            counts[color] = (counts[color] || 0) + 1;
            if (counts[color] > maxCount) {
                maxCount = counts[color];
                mostCommon = color;
            }
        }

        return mostCommon;
    }

    compressHorizontally(grid, ratio) {
        const w = (grid[0] && grid[0].length) || 0;
        const newWidth = Math.max(1, Math.floor(w * ratio));
        const newGrid = Array(grid.length).fill(null).map(() =>
            Array(newWidth).fill(null)
        );

        const cellWidth = w / newWidth;

        for (let y = 0; y < grid.length; y++) {
            for (let x = 0; x < newWidth; x++) {
                const startX = Math.floor(x * cellWidth);
                const endX = Math.floor((x + 1) * cellWidth);

                const colors = [];
                for (let sx = startX; sx < endX; sx++) {
                    if (grid[y][sx]) {
                        colors.push(grid[y][sx]);
                    }
                }

                if (colors.length > 0) {
                    newGrid[y][x] = this.mostCommonColor(colors);
                }
            }
        }

        return newGrid;
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    }

    centerAndMaxFillSprite(spriteGrid, targetWidth, targetHeight) {
        const bounds = this.getContentBounds(spriteGrid);
        if (!bounds) {
            return this.createEmptyGrid(targetHeight, targetWidth);
        }
        const content = this.extractContent(spriteGrid, bounds);
        const contentWidth = content[0]?.length || 0;
        const contentHeight = content.length;
        const paddingPixels = 1;
        const availableWidth = targetWidth - (paddingPixels * 2);
        const availableHeight = targetHeight - (paddingPixels * 2);
        const scaleX = availableWidth / (contentWidth || 1);
        const scaleY = availableHeight / (contentHeight || 1);
        const scale = Math.min(scaleX, scaleY);
        const scaled = this.scaleGrid(content, scale);
        const scaledWidth = scaled[0]?.length || 0;
        const scaledHeight = scaled.length;
        const usage = ((scaledWidth * scaledHeight) / (targetWidth * targetHeight) * 100).toFixed(1);
        console.log(`[MaxFill] Content ${contentHeight}×${contentWidth} → scaled ${scaledHeight}×${scaledWidth}, canvas usage ${usage}%`);
        return this.centerInCanvas(scaled, targetWidth, targetHeight);
    }

    getContentBounds(grid) {
        const height = grid.length;
        const width = (grid[0] && grid[0].length) || 0;
        let minRow = height;
        let maxRow = -1;
        let minCol = width;
        let maxCol = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (grid[y][x]) {
                    minRow = Math.min(minRow, y);
                    maxRow = Math.max(maxRow, y);
                    minCol = Math.min(minCol, x);
                    maxCol = Math.max(maxCol, x);
                }
            }
        }
        if (maxRow === -1) return null;
        return { minRow, maxRow, minCol, maxCol };
    }

    extractContent(grid, bounds) {
        const { minRow, maxRow, minCol, maxCol } = bounds;
        const content = [];
        for (let y = minRow; y <= maxRow; y++) {
            const row = [];
            for (let x = minCol; x <= maxCol; x++) {
                row.push(grid[y]?.[x] ?? null);
            }
            content.push(row);
        }
        return content;
    }

    scaleGrid(grid, scale) {
        const newHeight = Math.round(grid.length * scale);
        const newWidth = Math.round((grid[0]?.length || 0) * scale);
        const scaled = [];
        for (let y = 0; y < newHeight; y++) {
            const row = [];
            for (let x = 0; x < newWidth; x++) {
                const sourceY = Math.floor(y / scale);
                const sourceX = Math.floor(x / scale);
                row.push(grid[sourceY]?.[sourceX] ?? null);
            }
            scaled.push(row);
        }
        return scaled;
    }

    centerInCanvas(grid, targetWidth, targetHeight) {
        const contentHeight = grid.length;
        const contentWidth = grid[0]?.length || 0;
        const offsetY = Math.floor((targetHeight - contentHeight) / 2);
        const offsetX = Math.floor((targetWidth - contentWidth) / 2);
        const canvas = this.createEmptyGrid(targetHeight, targetWidth);
        for (let y = 0; y < contentHeight; y++) {
            for (let x = 0; x < contentWidth; x++) {
                const targetY = y + offsetY;
                const targetX = x + offsetX;
                if (targetY >= 0 && targetY < targetHeight && targetX >= 0 && targetX < targetWidth) {
                    canvas[targetY][targetX] = grid[y][x];
                }
            }
        }
        return canvas;
    }

    createEmptyGrid(height, width) {
        return Array(height).fill(null).map(() => Array(width).fill(null));
    }
}

export default OptimizedLiteBriteConverter;
