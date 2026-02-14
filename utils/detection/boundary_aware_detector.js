/**
 * Enhanced Peg Detector with Smart Boundary Detection
 * Crops grid to actual creation boundaries, not just peg extents
 */

import EnhancedLiteBritePegDetector from "./enhanced_lightbox_detector.js";

class BoundaryAwarePegDetector extends EnhancedLiteBritePegDetector {
  constructor(options = {}) {
    super(options);

    // Boundary detection settings
    this.minContentDensity = options.minContentDensity ?? 0.05; // 5% pegs minimum
    this.paddingPercentage = options.paddingPercentage ?? 0.05; // 5% padding around content
  }

  /**
   * Override detectPegs to add boundary detection
   */
  async detectPegs(imageSource) {
    const result = await super.detectPegs(imageSource);

    if (!result.grid || result.grid.length === 0) {
      return result;
    }

    console.log(
      "[Boundary] Original grid:",
      `${result.dimensions.rows}×${result.dimensions.cols}`,
    );

    const boundaries = this.findContentBoundaries(result.grid);
    console.log("[Boundary] Content bounds:", boundaries);

    const croppedGrid = this.cropToContent(result.grid, boundaries);
    console.log(
      "[Boundary] Cropped grid:",
      `${croppedGrid.length}×${croppedGrid[0]?.length || 0}`,
    );

    const cleanedGrid = this.removeIsolatedRegions(croppedGrid);

    return {
      grid: cleanedGrid,
      dimensions: {
        rows: cleanedGrid.length,
        cols: cleanedGrid[0]?.length || 0,
      },
      confidence: result.confidence,
      detectedPegs: this.countPegs(cleanedGrid),
      gridPegs: this.countPegs(cleanedGrid),
      boundaries,
      originalDimensions: result.dimensions,
    };
  }

  /**
   * Find the actual boundaries of content (ignoring empty space)
   */
  findContentBoundaries(grid) {
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

    const paddingRows = Math.max(
      1,
      Math.floor(height * this.paddingPercentage),
    );
    const paddingCols = Math.max(
      1,
      Math.floor(width * this.paddingPercentage),
    );

    return {
      minRow: Math.max(0, minRow - paddingRows),
      maxRow: Math.min(height - 1, maxRow + paddingRows),
      minCol: Math.max(0, minCol - paddingCols),
      maxCol: Math.min(width - 1, maxCol + paddingCols),
    };
  }

  /**
   * Crop grid to actual content boundaries
   */
  cropToContent(grid, boundaries) {
    const { minRow, maxRow, minCol, maxCol } = boundaries;

    const cropped = [];
    for (let y = minRow; y <= maxRow; y++) {
      const row = [];
      for (let x = minCol; x <= maxCol; x++) {
        row.push(grid[y]?.[x] ?? null);
      }
      cropped.push(row);
    }

    return cropped;
  }

  /**
   * Remove isolated regions (keeps largest connected component + nearby components)
   */
  removeIsolatedRegions(grid) {
    const height = grid.length;
    const width = (grid[0] && grid[0].length) || 0;

    const visited = Array(height)
      .fill(null)
      .map(() => Array(width).fill(false));
    const components = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (grid[y][x] && !visited[y][x]) {
          const component = this.floodFill(grid, visited, y, x);
          components.push(component);
        }
      }
    }

    if (components.length === 0) {
      return grid;
    }

    const mainComponents = this.filterNearbyComponents(
      components,
      width,
      height,
    );
    console.log(
      `[Boundary] Found ${components.length} regions, keeping ${mainComponents.length}`,
    );

    const cleaned = Array(height)
      .fill(null)
      .map(() => Array(width).fill(null));

    for (const component of mainComponents) {
      for (const [py, px] of component.pixels) {
        cleaned[py][px] = grid[py][px];
      }
    }

    return cleaned;
  }

  floodFill(grid, visited, startY, startX) {
    const height = grid.length;
    const width = (grid[0] && grid[0].length) || 0;
    const pixels = [];
    const queue = [[startY, startX]];

    visited[startY][startX] = true;

    while (queue.length > 0) {
      const [y, x] = queue.shift();
      pixels.push([y, x]);

      const neighbors = [
        [y - 1, x],
        [y + 1, x],
        [y, x - 1],
        [y, x + 1],
        [y - 1, x - 1],
        [y - 1, x + 1],
        [y + 1, x - 1],
        [y + 1, x + 1],
      ];

      for (const [ny, nx] of neighbors) {
        if (
          ny >= 0 &&
          ny < height &&
          nx >= 0 &&
          nx < width &&
          !visited[ny][nx] &&
          grid[ny][nx]
        ) {
          visited[ny][nx] = true;
          queue.push([ny, nx]);
        }
      }
    }

    let minY = height;
    let maxY = 0;
    let minX = width;
    let maxX = 0;
    for (const [py, px] of pixels) {
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
    }

    return {
      pixels,
      bounds: { minY, maxY, minX, maxX },
      size: pixels.length,
    };
  }

  filterNearbyComponents(components, width, height) {
    if (components.length === 1) {
      return components;
    }

    const sorted = [...components].sort((a, b) => b.size - a.size);
    const kept = [sorted[0]];
    const maxDimension = Math.max(width, height);
    const proximityThreshold = maxDimension * 0.3;

    for (let i = 1; i < sorted.length; i++) {
      const comp = sorted[i];
      const main = sorted[0];

      const compCenterY = (comp.bounds.minY + comp.bounds.maxY) / 2;
      const compCenterX = (comp.bounds.minX + comp.bounds.maxX) / 2;
      const mainCenterY = (main.bounds.minY + main.bounds.maxY) / 2;
      const mainCenterX = (main.bounds.minX + main.bounds.maxX) / 2;

      const distance = Math.sqrt(
        Math.pow(compCenterY - mainCenterY, 2) +
          Math.pow(compCenterX - mainCenterX, 2),
      );

      if (
        distance < proximityThreshold ||
        comp.size > main.size * 0.2
      ) {
        kept.push(comp);
      } else {
        console.log(
          `[Boundary] Removing isolated region (${comp.size} pegs, distance: ${distance.toFixed(0)})`,
        );
      }
    }

    return kept;
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
}

export default BoundaryAwarePegDetector;
