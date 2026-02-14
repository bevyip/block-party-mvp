/**
 * Enhanced Lite Brite Peg Detector
 * Optimized for document scanner images with light box setup
 */

class EnhancedLiteBritePegDetector {
    constructor(options = {}) {
        // Adjusted parameters for document scanner setup
        this.minPegRadius = options.minPegRadius || 6;  // Smaller - pegs appear smaller from above
        this.maxPegRadius = options.maxPegRadius || 20; // Adjusted for overhead view
        this.gridTolerance = options.gridTolerance || 0.35; // More lenient for sparse designs
        this.colorSampleRatio = options.colorSampleRatio || 0.4; // Sample smaller center area

        // Light box specific settings (tune before user tests as needed)
        this.useAdaptiveThreshold = options.useAdaptiveThreshold !== false; // Default true
        this.contrastBoost = options.contrastBoost || 1.5; // Enhance peg visibility
        this.backgroundSubtraction = options.backgroundSubtraction !== false;
    }

    async detectPegs(imageSource) {
        await this.ensureOpenCVLoaded();

        // Load image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let img;
        if (imageSource instanceof HTMLImageElement) {
            img = imageSource;
        } else if (imageSource instanceof File) {
            img = await this._loadImageFromFile(imageSource);
        } else if (typeof imageSource === 'string') {
            img = await this._loadImageFromURL(imageSource);
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Convert to OpenCV Mat
        let src = cv.imread(canvas);

        // Crop out border (Lite Brite frame) to avoid detecting white border as content
        const borderCropPercent = 0.08;
        const cropX = Math.floor(src.cols * borderCropPercent);
        const cropY = Math.floor(src.rows * borderCropPercent);
        const cropW = src.cols - cropX * 2;
        const cropH = src.rows - cropY * 2;
        if (cropW > 0 && cropH > 0) {
            const rect = new cv.Rect(cropX, cropY, cropW, cropH);
            const cropped = src.roi(rect).clone();
            src.delete();
            src = cropped;
        }

        // Preprocessing pipeline for light box images
        const processed = this.preprocessLightBoxImage(src);

        // Detect circles (relaxed param2 so we get more candidates; color filter removes holes)
        const circles = new cv.Mat();
        cv.HoughCircles(
            processed,
            circles,
            cv.HOUGH_GRADIENT,
            1,                          // dp
            this.minPegRadius * 2,      // minDist - avoid detecting every hole
            90,                         // param1 - edge threshold (slightly lower = more circles)
            26,                         // param2 - accumulator (lower = more candidates; filter by color)
            this.minPegRadius,
            this.maxPegRadius
        );

        let result;
        if (circles.cols === 0) {
            result = {
                grid: [],
                dimensions: { rows: 0, cols: 0 },
                confidence: 0,
                error: 'No circles detected'
            };
        } else {
            // Convert circles to array
            const circleData = [];
            for (let i = 0; i < circles.cols; i++) {
                const x = circles.data32F[i * 3];
                const y = circles.data32F[i * 3 + 1];
                const r = circles.data32F[i * 3 + 2];
                circleData.push({ x: Math.round(x), y: Math.round(y), r: Math.round(r) });
            }

            // Filter out false positives (board holes vs actual pegs)
            const filteredCircles = this.filterPegCircles(src, circleData);

            // Fit to grid
            const gridData = this._fitToGrid(filteredCircles);

            // Extract colors with enhanced sampling
            const pegGrid = this._extractColorsEnhanced(src, gridData);

            // Calculate confidence
            const confidence = this._calculateConfidence(filteredCircles, gridData);

            result = {
                grid: pegGrid,
                dimensions: {
                    rows: pegGrid.length,
                    cols: pegGrid.length > 0 ? pegGrid[0].length : 0
                },
                confidence: confidence,
                detectedPegs: filteredCircles.length,
                gridPegs: gridData.totalPositions
            };
        }

        // Clean up
        src.delete();
        processed.delete();
        circles.delete();

        return result;
    }

    /**
     * Preprocessing pipeline optimized for light box images
     */
    preprocessLightBoxImage(src) {
        const gray = new cv.Mat();
        const enhanced = new cv.Mat();

        // Convert to grayscale
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // Step 1: Contrast enhancement to make pegs pop
        gray.convertTo(enhanced, -1, this.contrastBoost, 0);

        // Step 2: Adaptive thresholding to handle uneven lighting
        if (this.useAdaptiveThreshold) {
            const adaptive = new cv.Mat();
            cv.adaptiveThreshold(
                enhanced,
                adaptive,
                255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY,
                11,  // Block size
                2    // Constant
            );

            // Invert (pegs should be bright)
            cv.bitwise_not(adaptive, adaptive);

            // Blend with original enhanced image
            cv.addWeighted(enhanced, 0.7, adaptive, 0.3, 0, enhanced);
            adaptive.delete();
        }

        // Step 3: Gaussian blur to reduce noise
        const blurred = new cv.Mat();
        cv.GaussianBlur(enhanced, blurred, new cv.Size(5, 5), 1.5);

        gray.delete();
        enhanced.delete();

        return blurred;
    }

    /**
     * Sample average color in a small neighborhood (robust to specular highlights / single bad pixel)
     */
    sampleRegionColor(src, x, y, radius = 1) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const px = Math.max(0, Math.min(x + dx, src.cols - 1));
                const py = Math.max(0, Math.min(y + dy, src.rows - 1));
                const c = this.samplePixelColor(src, px, py);
                r += c.r; g += c.g; b += c.b;
                n++;
            }
        }
        return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
    }

    /** Color distance threshold: allow camera yellows/greens (e.g. lime, neon) that are close to palette */
    static get PEG_COLOR_DISTANCE_THRESHOLD() { return 155; }

    /**
     * Filter circles: only accept if center region is close to a known Lite Brite peg color (color-first)
     */
    filterPegCircles(src, circles) {
        const filtered = [];
        const threshold = EnhancedLiteBritePegDetector.PEG_COLOR_DISTANCE_THRESHOLD;

        for (const circle of circles) {
            const regionColor = this.sampleRegionColor(src, circle.x, circle.y, 1);
            const { distance } = this.findClosestPegColor(regionColor);
            if (distance < threshold) {
                filtered.push(circle);
            }
        }

        console.log(`Filtered ${circles.length} circles → ${filtered.length} actual pegs`);
        if (circles.length > 0 && filtered.length === 0) {
            console.warn(`[PegDetector] All circles rejected by color filter (none within ${threshold} of Lite Brite colors). Image may not be a Lite Brite photo, or lighting/angle may differ.`);
        }
        return filtered;
    }

    /**
     * Find closest of the 6 Lite Brite peg colors; returns { distance, color } (color as hex)
     */
    findClosestPegColor(rgb) {
        const pegColors = [
            { r: 255, g: 255, b: 0, hex: '#FFFF00' },
            { r: 0, g: 0, b: 255, hex: '#0000FF' },
            { r: 255, g: 105, b: 180, hex: '#FF69B4' },
            { r: 0, g: 255, b: 0, hex: '#00FF00' },
            { r: 255, g: 255, b: 255, hex: '#FFFFFF' },
            { r: 255, g: 140, b: 0, hex: '#FF8C00' },
        ];
        let minDist = Infinity;
        let closest = pegColors[0];
        for (const pegColor of pegColors) {
            const dist = Math.sqrt(
                Math.pow(rgb.r - pegColor.r, 2) +
                Math.pow(rgb.g - pegColor.g, 2) +
                Math.pow(rgb.b - pegColor.b, 2)
            );
            if (dist < minDist) {
                minDist = dist;
                closest = pegColor;
            }
        }
        return { distance: minDist, color: closest.hex };
    }

    /**
     * Calculate how colorful a pixel is (vs grayscale)
     */
    calculateColorfulness(rgb) {
        const max = Math.max(rgb.r, rgb.g, rgb.b);
        const min = Math.min(rgb.r, rgb.g, rgb.b);
        return max - min; // Saturation proxy
    }

    /**
     * Sample a single pixel color
     */
    samplePixelColor(src, x, y) {
        x = Math.max(0, Math.min(x, src.cols - 1));
        y = Math.max(0, Math.min(y, src.rows - 1));

        const pixel = src.ucharPtr(y, x);
        return {
            r: pixel[0],
            g: pixel[1],
            b: pixel[2]
        };
    }

    /**
     * Color extraction with multi-point sampling for lighting robustness
     */
    _extractColorsEnhanced(srcMat, gridData) {
        const positions = gridData.positions;

        if (Object.keys(positions).length === 0) {
            return [];
        }

        const posArray = Object.values(positions);
        const rows = posArray.map(p => p.row);
        const cols = posArray.map(p => p.col);

        const minRow = Math.min(...rows);
        const maxRow = Math.max(...rows);
        const minCol = Math.min(...cols);
        const maxCol = Math.max(...cols);

        const gridHeight = maxRow - minRow + 1;
        const gridWidth = maxCol - minCol + 1;

        const pegGrid = Array(gridHeight).fill(null).map(() =>
            Array(gridWidth).fill(null)
        );

        for (const [key, peg] of Object.entries(positions)) {
            const normalizedRow = peg.row - minRow;
            const normalizedCol = peg.col - minCol;

            // Sample from center of peg (smaller area to avoid edges)
            const sampleRadius = Math.floor(peg.radius * this.colorSampleRatio);

            // Multi-point sampling to handle lighting variations
            const colors = [];
            const samplePoints = [
                { dx: 0, dy: 0 }, // center
                { dx: sampleRadius * 0.5, dy: 0 }, // right
                { dx: -sampleRadius * 0.5, dy: 0 }, // left
                { dx: 0, dy: sampleRadius * 0.5 }, // down
                { dx: 0, dy: -sampleRadius * 0.5 }  // up
            ];

            for (const point of samplePoints) {
                const px = Math.round(peg.x + point.dx);
                const py = Math.round(peg.y + point.dy);

                if (px >= 0 && px < srcMat.cols && py >= 0 && py < srcMat.rows) {
                    const pixel = srcMat.ucharPtr(py, px);
                    const r = pixel[0];
                    const g = pixel[1];
                    const b = pixel[2];

                    colors.push({ r, g, b });
                }
            }

            // Average the sampled colors
            const avgColor = this.averageColors(colors);
            const hex = `#${avgColor.r.toString(16).padStart(2, '0')}${avgColor.g.toString(16).padStart(2, '0')}${avgColor.b.toString(16).padStart(2, '0')}`;

            pegGrid[normalizedRow][normalizedCol] = hex;
        }

        return pegGrid;
    }

    /**
     * Average multiple color samples
     */
    averageColors(colors) {
        if (colors.length === 0) return { r: 0, g: 0, b: 0 };

        let rSum = 0, gSum = 0, bSum = 0;
        for (const c of colors) {
            rSum += c.r;
            gSum += c.g;
            bSum += c.b;
        }

        return {
            r: Math.round(rSum / colors.length),
            g: Math.round(gSum / colors.length),
            b: Math.round(bSum / colors.length)
        };
    }

    async ensureOpenCVLoaded() {
        if (typeof cv === 'undefined') {
            throw new Error('OpenCV.js not loaded');
        }

        return new Promise((resolve) => {
            if (cv.getBuildInformation) {
                resolve();
            } else {
                cv.onRuntimeInitialized = () => resolve();
            }
        });
    }

    _loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    _loadImageFromURL(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.crossOrigin = 'anonymous';
            img.src = url;
        });
    }

    _fitToGrid(circles) {
        if (circles.length === 0) {
            return { positions: {}, spacing: 0, totalPositions: 0 };
        }

        const xCoords = circles.map(c => c.x).sort((a, b) => a - b);
        const yCoords = circles.map(c => c.y).sort((a, b) => a - b);

        const xDiffs = [];
        const yDiffs = [];
        for (let i = 1; i < xCoords.length; i++) {
            const diff = xCoords[i] - xCoords[i - 1];
            if (diff > 10 && diff < 100) xDiffs.push(diff);
        }
        for (let i = 1; i < yCoords.length; i++) {
            const diff = yCoords[i] - yCoords[i - 1];
            if (diff > 10 && diff < 100) yDiffs.push(diff);
        }

        const spacingX = xDiffs.length > 0 ? this._median(xDiffs) : 20;
        const spacingY = yDiffs.length > 0 ? this._median(yDiffs) : 20;
        const spacing = (spacingX + spacingY) / 2;

        const originX = Math.min(...xCoords);
        const originY = Math.min(...yCoords);

        const positions = {};
        for (const circle of circles) {
            const col = Math.round((circle.x - originX) / spacing);
            const row = Math.round((circle.y - originY) / spacing);

            const expectedX = originX + col * spacing;
            const expectedY = originY + row * spacing;

            const distance = Math.sqrt(
                Math.pow(circle.x - expectedX, 2) +
                Math.pow(circle.y - expectedY, 2)
            );

            if (distance < spacing * this.gridTolerance) {
                const key = `${row},${col}`;
                positions[key] = {
                    x: circle.x,
                    y: circle.y,
                    radius: circle.r,
                    row: row,
                    col: col
                };
            }
        }

        return {
            positions: positions,
            spacing: spacing,
            origin: { x: originX, y: originY },
            totalPositions: Object.keys(positions).length
        };
    }

    _calculateConfidence(circles, gridData) {
        if (circles.length === 0) return 0;

        const fitRatio = gridData.totalPositions / circles.length;

        if (fitRatio < 0.8) {
            return fitRatio * 0.7;
        }

        return Math.min(fitRatio, 1.0);
    }

    _median(arr) {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    async visualizeDetection(imageSource, outputCanvas) {
        await this.ensureOpenCVLoaded();

        const result = await this.detectPegs(imageSource);

        let img;
        if (imageSource instanceof HTMLImageElement) {
            img = imageSource;
        } else if (imageSource instanceof File) {
            img = await this._loadImageFromFile(imageSource);
        }

        const ctx = outputCanvas.getContext('2d');
        outputCanvas.width = img.width;
        outputCanvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const canvas = document.createElement('canvas');
        const tempCtx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        tempCtx.drawImage(img, 0, 0);

        let src = cv.imread(canvas);
        const borderCropPercent = 0.08;
        const cropX = Math.floor(src.cols * borderCropPercent);
        const cropY = Math.floor(src.rows * borderCropPercent);
        const cropW = src.cols - cropX * 2;
        const cropH = src.rows - cropY * 2;
        if (cropW > 0 && cropH > 0) {
            const rect = new cv.Rect(cropX, cropY, cropW, cropH);
            const cropped = src.roi(rect).clone();
            src.delete();
            src = cropped;
        }

        const processed = this.preprocessLightBoxImage(src);

        const circles = new cv.Mat();
        cv.HoughCircles(processed, circles, cv.HOUGH_GRADIENT, 1,
            this.minPegRadius * 2, 100, 35,
            this.minPegRadius, this.maxPegRadius);

        if (circles.cols > 0) {
            const circleData = [];
            for (let i = 0; i < circles.cols; i++) {
                circleData.push({
                    x: Math.round(circles.data32F[i * 3]),
                    y: Math.round(circles.data32F[i * 3 + 1]),
                    r: Math.round(circles.data32F[i * 3 + 2])
                });
            }

            const filtered = this.filterPegCircles(src, circleData);

            const ox = cropW > 0 ? cropX : 0;
            const oy = cropH > 0 ? cropY : 0;

            for (const { x, y, r } of circleData) {
                ctx.beginPath();
                ctx.arc(x + ox, y + oy, r, 0, 2 * Math.PI);
                ctx.strokeStyle = '#ff0000';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            for (const { x, y, r } of filtered) {
                ctx.beginPath();
                ctx.arc(x + ox, y + oy, r, 0, 2 * Math.PI);
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x + ox, y + oy, 2, 0, 2 * Math.PI);
                ctx.fillStyle = '#ffff00';
                ctx.fill();
            }
        }

        src.delete();
        processed.delete();
        circles.delete();

        return result;
    }
}

export default EnhancedLiteBritePegDetector;
