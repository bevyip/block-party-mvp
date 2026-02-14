/**
 * Gemini AI-Powered Sprite Converter
 * Uses Gemini to analyze the image and intelligently generate back/left/right views
 * from a single Lite Brite photo. Front view comes from peg detection.
 */

import BoundaryAwarePegDetector from "../detection/boundary_aware_detector.js";

class GeminiSpriteConverter {
  constructor(options = {}) {
    this.apiKey = options.apiKey || null;
    this.pegDetector = new BoundaryAwarePegDetector({
      minPegRadius: 6,
      maxPegRadius: 20,
      gridTolerance: 0.35,
      colorSampleRatio: 0.4,
      contrastBoost: 1.5,
      useAdaptiveThreshold: true,
    });

    this.SCALE = 3;
    this.useAdaptiveDensity = options.useAdaptiveDensity !== false;

    // Try these in order; first that doesn't 404 is used for all subsequent calls
    this.GEMINI_MODEL_ALTERNATIVES = [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-pro",
    ];
    this.GEMINI_MODEL = this.GEMINI_MODEL_ALTERNATIVES[0];
    this.apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.GEMINI_MODEL}:generateContent`;

    // Known Lite Brite 6-color palette
    this.LITEBRITE_PALETTE = {
      yellow: "#FFFF00",
      blue: "#0000FF",
      pink: "#FF69B4",
      green: "#00FF00",
      white: "#FFFFFF",
      orange: "#FF8C00",
    };
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

  /**
   * POST to generateContent; on 404 tries alternative models and caches the working one.
   * @param {object} requestBody - JSON body for generateContent
   * @returns {Promise<Response>}
   */
  async fetchGemini(requestBody) {
    const url = `${this.apiEndpoint}?key=${this.apiKey}`;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    };
    let response = await fetch(url, options);
    if (response.ok) return response;
    if (response.status !== 404) return response;

    for (const model of this.GEMINI_MODEL_ALTERNATIVES) {
      if (model === this.GEMINI_MODEL) continue;
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      response = await fetch(fallbackUrl, options);
      if (response.ok) {
        this.GEMINI_MODEL = model;
        this.apiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.GEMINI_MODEL}:generateContent`;
        console.log(`[Gemini] Using model: ${this.GEMINI_MODEL}`);
        return response;
      }
      if (response.status !== 404) return response;
    }
    return response;
  }

  calculateOptimalDimensions(pegGrid, totalPegs, pegDimensions) {
    const pegRows = pegDimensions?.rows || 1;
    const pegCols = pegDimensions?.cols || 1;
    const aspectRatio = pegCols / pegRows;

    const archetype =
      aspectRatio > 1.3 ? "wide" : aspectRatio < 0.75 ? "tall" : "square";

    if (!this.useAdaptiveDensity) {
      const presets = {
        wide: { width: 32, height: 24 },
        tall: { width: 16, height: 32 },
        square: { width: 24, height: 24 },
      };
      return { ...presets[archetype], archetype };
    }

    let targetPixels;
    if (totalPegs < 30) {
      targetPixels = totalPegs * 2.5;
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
    return (grid || []).map((row) =>
      (row || []).map((cellColor) => {
        if (!cellColor) return null;
        const { color, distance } = this.findClosestPaletteColorWithDistance(
          cellColor,
          paletteColors,
        );
        if (distance > 120) return null; // Remove grays from sprite
        return color;
      }),
    );
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
          Math.pow((rgb1.b - rgb2.b) * 0.11, 2),
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

  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Main conversion: image file → 4-view sprite using peg detection + Gemini for views
   */
  async convertToSprite(imageSource) {
    if (this.apiKey) {
      console.log(
        "[Gemini] API key present – using AI for back/left/right views",
      );
    }

    console.log("[Gemini] Step 1: Detecting pegs...");
    const pegResult = await this.pegDetector.detectPegs(imageSource);

    if (pegResult.confidence < 0.7) {
      console.warn(
        `[Gemini] Low detection confidence: ${pegResult.confidence.toFixed(2)}`,
      );
    }

    const rawPegGrid = pegResult.grid;
    const pegDimensions = pegResult.dimensions;

    if (
      !rawPegGrid ||
      rawPegGrid.length === 0 ||
      !pegDimensions?.rows ||
      !pegDimensions?.cols
    ) {
      throw new Error(
        "No pegs detected. Try a clearer Lite Brite photo or use a regular image.",
      );
    }

    const pegGrid = this.snapToPalette(rawPegGrid);
    const totalPegs = this.countPegs(pegGrid);
    const targetDimensions = this.calculateOptimalDimensions(
      pegGrid,
      totalPegs,
      pegDimensions,
    );

    console.log(
      `[Gemini] Detected ${totalPegs} pegs → generating ${targetDimensions.width}×${targetDimensions.height} sprite (${((targetDimensions.width * targetDimensions.height) / totalPegs).toFixed(1)} pixels/peg)`,
    );
    if (pegResult.originalDimensions) {
      const orig =
        pegResult.originalDimensions.rows * pegResult.originalDimensions.cols;
      const crop = pegDimensions.rows * pegDimensions.cols;
      if (orig > 0) {
        const saved = ((1 - crop / orig) * 100).toFixed(0);
        console.log(
          `[Boundary] Cropped: ${pegResult.originalDimensions.rows}×${pegResult.originalDimensions.cols} → ${pegDimensions.rows}×${pegDimensions.cols} (${saved}% empty space removed)`,
        );
      }
    }

    console.log("[Gemini] Step 2: Processing front view...");
    const frontView = await this.processView(
      pegGrid,
      "front",
      null,
      targetDimensions,
    );

    if (!this.apiKey) {
      console.log(
        "[Gemini] No API key – using simple transformations for back/left/right",
      );
      const views = {
        front: frontView,
        back: this.fallbackViewGeneration(frontView, "back"),
        left: this.fallbackViewGeneration(frontView, "left"),
        right: this.fallbackViewGeneration(frontView, "right"),
      };
      return this.buildResult(
        views,
        pegDimensions,
        pegResult.confidence,
        [],
        totalPegs,
        targetDimensions,
      );
    }

    console.log("[Gemini] Step 3: Calling Gemini analysis API...");
    const imageData = await this.imageToBase64(imageSource);
    let analysis;
    try {
      analysis = await this.analyzeCreation(imageData, pegGrid, totalPegs);
      console.log("[Gemini] Analysis API OK –", {
        shape: analysis.shape,
        interpretation: analysis.interpretation,
        colors: analysis.mainColors?.length ?? 0,
      });
    } catch (err) {
      console.error(
        "[Gemini] Analysis API failed, using fallback views:",
        err?.message ?? err,
      );
      if (err?.stack)
        console.error("[Gemini] Analysis API error stack:", err.stack);
      const views = {
        front: frontView,
        back: this.fallbackViewGeneration(frontView, "back"),
        left: this.fallbackViewGeneration(frontView, "left"),
        right: this.fallbackViewGeneration(frontView, "right"),
      };
      return this.buildResult(
        views,
        pegDimensions,
        pegResult.confidence,
        [],
        totalPegs,
        targetDimensions,
      );
    }

    console.log(
      "[Gemini] Step 4: Generating back/left/right views (3 API calls)...",
    );
    const views = await this.generateAllViews(
      frontView,
      analysis,
      totalPegs,
      targetDimensions,
    );

    console.log(
      "[Gemini] All view APIs OK – back, left, right generated by AI",
    );
    return this.buildResult(
      views,
      pegDimensions,
      pegResult.confidence,
      ["back", "left", "right"],
      totalPegs,
      targetDimensions,
    );
  }

  buildResult(
    views,
    pegDimensions,
    confidence,
    aiGenerated,
    totalPegs = 0,
    targetDimensions = null,
  ) {
    const front = views.front;
    const width = front[0]?.length || 0;
    const height = front.length;
    const pixelToPegRatio = totalPegs > 0 ? (width * height) / totalPegs : 0;

    return {
      objectType: views.objectType || "unknown",
      description: views.description || "",
      dimensions: { width, height },
      views: {
        front: views.front,
        back: views.back,
        left: views.left,
        right: views.right,
      },
      metadata: {
        originalSize: pegDimensions,
        originalPegCount: totalPegs,
        confidence,
        pixelToPegRatio,
        aiGenerated: aiGenerated || [],
        geminiModel: this.GEMINI_MODEL,
      },
    };
  }

  async analyzeCreation(imageBase64, pegGrid, totalPegs = 0) {
    const prompt = `You are analyzing a photograph of a physical Lite Brite peg artwork.

CONTEXT:
- This is a real-world creation made with translucent plastic pegs on a black background.
- Only 6 peg colors exist: yellow, blue, pink, green, white, orange.
- The design is sparse and uses ${totalPegs} pegs.
- Pegs appear as small glowing circular dots.
- The background is always black and should be ignored.
- The artwork may be abstract or represent something specific.

CRITICAL INSTRUCTIONS:
- Only describe what is visually present.
- Do NOT assume realism.
- Do NOT add details that are not clearly visible.
- Do NOT invent colors outside the 6 allowed.
- If something is ambiguous, say so clearly.
- Base interpretation strictly on visible structure.

ANALYSIS STEPS:

1. SHAPE  
Describe the overall silhouette and structure:
- Is it tall, wide, compact, symmetrical, scattered?
- Does it have a central axis?
- Does it branch outward?
- Is it geometric or organic?

2. COLORS  
List ONLY the colors that are clearly visible.
Choose only from:
["yellow", "blue", "pink", "green", "white", "orange"]

3. FEATURES  
Describe visible structural components:
- Countable clusters or groupings
- Symmetry or asymmetry
- Horizontal/vertical alignments
- Repeating patterns
- Distinct top/bottom or left/right differences
- Empty space distribution

Be specific to THIS image.

4. INTERPRETATION  
Based ONLY on visible structure and color placement,
provide a short, specific phrase describing what it most resembles.

Examples of acceptable interpretation formats:
- "a small bird with outstretched wings"
- "a flowering plant with three blossoms"
- "a pixelated rocket ship"
- "a smiling face"
- "an abstract spiral pattern"

If unclear, say:
- "an abstract geometric arrangement"
- "an abstract organic shape"

Return STRICTLY valid JSON:

{
  "shape": "...",
  "colors": ["..."],
  "features": ["...", "..."],
  "interpretation": "..."
}`;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
    };
    let response;
    try {
      response = await this.fetchGemini(requestBody);
    } catch (networkErr) {
      console.error(
        "[Gemini] Analysis API – failed to reach API:",
        networkErr?.message ?? networkErr,
      );
      throw networkErr;
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error(
        `[Gemini] Analysis API – HTTP ${response.status}:`,
        errBody.length > 500 ? errBody.slice(0, 500) + "…" : errBody,
      );
      throw new Error(`Gemini API error: ${response.status} ${errBody}`);
    }

    const data = await response.json();
    console.log(
      "[Gemini] Analysis API response:",
      JSON.stringify(data, null, 2),
    );
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn(
        "[Gemini] Analysis API – empty response (no text in candidates), using fallback",
      );
      throw new Error("Empty Gemini response");
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      const colors = Array.isArray(analysis.colors) ? analysis.colors : [];
      const features = Array.isArray(analysis.features)
        ? analysis.features
        : [];
      return {
        objectType: analysis.interpretation || analysis.shape || "unknown",
        mainColors: colors,
        features,
        viewAngle: "front",
        description: [analysis.shape, analysis.interpretation]
          .filter(Boolean)
          .join(" – "),
        shape: analysis.shape,
        interpretation: analysis.interpretation,
      };
    }

    console.warn(
      "[Gemini] Analysis API – no JSON object in response, using fallback analysis",
    );
    return {
      objectType: "unknown",
      mainColors: [],
      features: [],
      viewAngle: "front",
      description: "Could not analyze",
    };
  }

  getViewRules(viewType, analysis) {
    switch (viewType) {
      case "back":
        return `- Usually a horizontal flip with minor variations
- If the shape is asymmetric (like a face), adjust features for back view
- Keep same color distribution`;
      case "left":
        return `- Side profile view - typically narrower than front
- Show ~50% of the width if viewing from side
- Keep vertical proportions the same
- If original shows depth/multiple layers, compress them`;
      case "right":
        return `- Opposite side profile from left view
- Mirror the left view concept but from other side
- Same narrowing as left view`;
      default:
        return "";
    }
  }

  async generateAllViews(frontView, analysis, totalPegs, targetDimensions) {
    const viewPromises = ["back", "left", "right"].map(async (viewType) => {
      const viewGrid = await this.generateView(
        frontView,
        viewType,
        analysis,
        totalPegs,
        targetDimensions,
      );
      return { viewType, viewGrid };
    });

    const results = await Promise.all(viewPromises);
    const views = { front: frontView };
    results.forEach(({ viewType, viewGrid }) => {
      views[viewType] = viewGrid;
    });
    views.objectType = analysis.objectType;
    views.description = analysis.description;
    return views;
  }

  async generateView(
    frontView,
    viewType,
    analysis,
    totalPegs = 0,
    targetDimensions = null,
  ) {
    if (!this.apiKey) return this.fallbackViewGeneration(frontView, viewType);

    const frontGridString = this.gridToString(frontView);
    const height = frontView.length;
    const width = frontView[0]?.length || 0;
    const uniqueColors = this.getAllowedColorsForView(frontView, analysis);
    const viewRules = this.getViewRules(viewType, analysis);
    const interpretation = analysis?.interpretation || analysis?.objectType || "abstract peg art";
    const shapeDesc = analysis?.shape || "";
    const featuresList = Array.isArray(analysis?.features) ? analysis.features.join("; ") : "";

    const prompt = `You are generating the ${viewType.toUpperCase()} view of a Lite Brite peg-art sprite.

WHAT THE OBJECT IS (use this to guide the silhouette and structure):
- Interpretation: ${interpretation}
- Shape: ${shapeDesc}
- Features: ${featuresList}

Your ${viewType} view MUST look like this same object seen from the ${viewType} side. Do not just copy or mirror the front grid below if it is coarse or wrong—draw what "${interpretation}" would actually look like from the ${viewType} (e.g. rounded top, protrusions, symmetry) using the allowed colors.

FRONT VIEW GRID (use only as a rough guide for size and which colors appear; the front view may be simplified):
${frontGridString}

CONSTRAINTS - THESE ARE ABSOLUTE:
1. Size: EXACTLY ${height} rows × ${width} columns (output MUST be this exact size).
2. Colors: ONLY use these hex colors: ${uniqueColors.join(", ")} + null for empty.
3. Peg count: Use a similar density to ~${totalPegs} pegs (sparse pixel-art style).
4. Style: Simple pixel art from colored pegs; silhouette should match "${interpretation}".

RULES FOR ${viewType.toUpperCase()} VIEW:
${viewRules}

CRITICAL:
- The silhouette and structure must match the described object (${interpretation}), not necessarily the front grid pixel-for-pixel.
- Use the same color palette; keep the hand-made, sparse aesthetic.
- Output MUST be exactly ${height} rows and ${width} columns.

Respond with ONLY the JSON array (no markdown, no explanation):
[[color1, color2, ...], [...], ...]`;

    const viewRequestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4000 },
    };
    try {
      let response;
      try {
        response = await this.fetchGemini(viewRequestBody);
      } catch (networkErr) {
        console.error(
          `[Gemini] View API (${viewType}) – failed to reach API:`,
          networkErr?.message ?? networkErr,
        );
        return this.fallbackViewGeneration(frontView, viewType);
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(
          `[Gemini] View API (${viewType}) – HTTP ${response.status}:`,
          errText.length > 300 ? errText.slice(0, 300) + "…" : errText,
        );
        return this.fallbackViewGeneration(frontView, viewType);
      }

      const data = await response.json();
      console.log(
        `[Gemini] View API response (${viewType}):`,
        JSON.stringify(data, null, 2),
      );
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.warn(
          `[Gemini] View API (${viewType}) – empty response (no text), using fallback`,
        );
        return this.fallbackViewGeneration(frontView, viewType);
      }

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        let viewGrid = JSON.parse(jsonMatch[0]);
        if (Array.isArray(viewGrid) && viewGrid.length > 0) {
          viewGrid = this.normalizeViewGridToDimensions(
            viewGrid,
            height,
            width,
          );
          if (
            viewGrid.length === height &&
            (viewGrid[0]?.length ?? 0) === width
          ) {
            console.log(`[Gemini] View API OK – ${viewType}`);
            return viewGrid;
          }
        }
      }

      console.warn(
        `[Gemini] View API (${viewType}) – invalid response shape (expected ${height}×${width}), using fallback`,
      );
      return this.fallbackViewGeneration(frontView, viewType);
    } catch (error) {
      console.error(
        `[Gemini] View API (${viewType}) – error:`,
        error?.message ?? error,
      );
      if (error?.stack)
        console.error("[Gemini] View API error stack:", error.stack);
      return this.fallbackViewGeneration(frontView, viewType);
    }
  }

  fallbackViewGeneration(frontView, viewType) {
    switch (viewType) {
      case "back":
        return frontView.map((row) => [...row].reverse());
      case "left":
        return this.compressHorizontally(frontView, 0.5);
      case "right":
        const left = this.compressHorizontally(frontView, 0.5);
        return left.map((row) => [...row].reverse());
      default:
        return frontView.map((row) => [...row]);
    }
  }

  async processView(pegGrid, viewType, analysis, targetDimensions) {
    if (!targetDimensions) {
      const totalPegs = this.countPegs(pegGrid);
      const pegDimensions = {
        rows: pegGrid.length,
        cols: pegGrid[0]?.length || 0,
      };
      targetDimensions = this.calculateOptimalDimensions(
        pegGrid,
        totalPegs,
        pegDimensions,
      );
    }

    const sourceHeight = pegGrid.length;
    const sourceWidth = pegGrid[0]?.length || 0;

    let processed;
    if (
      sourceHeight > targetDimensions.height ||
      sourceWidth > targetDimensions.width
    ) {
      processed = this.minimalDownsample(pegGrid, targetDimensions);
    } else if (
      sourceHeight < targetDimensions.height ||
      sourceWidth < targetDimensions.width
    ) {
      processed = this.upsample(pegGrid, targetDimensions);
    } else {
      processed = pegGrid.map((row) => [...(row || [])]);
    }

    processed = this.refineGrid(processed);
    processed = this.snapToPalette(processed);

    processed = this.centerAndMaxFillSprite(
      processed,
      targetDimensions.width,
      targetDimensions.height,
    );

    return processed;
  }

  async imageToBase64(imageSource) {
    let img;
    if (imageSource instanceof HTMLImageElement) {
      img = imageSource;
    } else if (imageSource instanceof File) {
      img = await this.loadImageFromFile(imageSource);
    } else if (typeof imageSource === "string") {
      return imageSource.includes(",")
        ? imageSource.split(",")[1]
        : imageSource;
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const dataURL = canvas.toDataURL("image/jpeg", 0.9);
    return dataURL.split(",")[1];
  }

  loadImageFromFile(file) {
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

  gridToString(grid) {
    return grid
      .map((row) => (row || []).map((cell) => cell || "____").join(" "))
      .join("\n");
  }

  getUniqueColors(grid) {
    const colors = new Set();
    for (const row of grid || []) {
      for (const cell of row || []) {
        if (cell) colors.add(cell);
      }
    }
    return Array.from(colors);
  }

  /** Allowed colors for view: front grid colors + analysis mainColors (by name) as hex so AI uses e.g. green */
  getAllowedColorsForView(frontView, analysis) {
    const fromGrid = this.getUniqueColors(frontView);
    const nameToHex = {
      yellow: "#FFFF00",
      blue: "#0000FF",
      pink: "#FF69B4",
      green: "#00FF00",
      white: "#FFFFFF",
      orange: "#FF8C00",
    };
    const fromAnalysis = (analysis?.mainColors || [])
      .map((name) => nameToHex[String(name).toLowerCase()])
      .filter(Boolean);
    const combined = new Set([...fromGrid, ...fromAnalysis]);
    return Array.from(combined);
  }

  /** Normalize API grid to exact height×width (pad or trim; center when smaller) */
  normalizeViewGridToDimensions(grid, targetHeight, targetWidth) {
    const rows = Array.isArray(grid) ? grid.length : 0;
    const cols = grid[0]?.length ?? 0;
    const out = Array(targetHeight)
      .fill(null)
      .map(() => Array(targetWidth).fill(null));
    const padC =
      cols <= targetWidth
        ? Math.max(0, Math.floor((targetWidth - cols) / 2))
        : 0;
    const startC =
      cols > targetWidth ? Math.floor((cols - targetWidth) / 2) : 0;
    for (let r = 0; r < targetHeight; r++) {
      const sr = r < rows ? r : rows - 1;
      const row = grid[sr] || [];
      for (let c = 0; c < targetWidth; c++) {
        const sc = cols <= targetWidth ? c - padC : startC + c;
        if (sc >= 0 && sc < row.length) {
          out[r][c] = row[sc];
        }
      }
    }
    return out;
  }

  minimalDownsample(sourceGrid, targetDimensions) {
    const sourceHeight = sourceGrid.length;
    const sourceWidth = sourceGrid[0]?.length || 0;
    const targetWidth = targetDimensions.width;
    const targetHeight = targetDimensions.height;

    const newGrid = Array(targetHeight)
      .fill(null)
      .map(() => Array(targetWidth).fill(null));
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
            if (sourceGrid[sy]?.[sx]) colors.push(sourceGrid[sy][sx]);
          }
        }
        if (colors.length > 0) newGrid[y][x] = this.mostCommonColor(colors);
      }
    }
    return newGrid;
  }

  upsample(grid, targetDimensions) {
    const sh = grid.length;
    const sw = grid[0]?.length || 0;
    const tw = targetDimensions.width;
    const th = targetDimensions.height;
    const newGrid = Array(th)
      .fill(null)
      .map(() => Array(tw).fill(null));
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const sy = Math.floor((y * sh) / th);
        const sx = Math.floor((x * sw) / tw);
        if (grid[sy]?.[sx]) newGrid[y][x] = grid[sy][sx];
      }
    }
    return newGrid;
  }

  refineGrid(grid) {
    const refined = grid.map((row) => [...(row || [])]);
    const h = grid.length;
    const w = grid[0]?.length || 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!grid[y][x]) {
          const hasLeft = grid[y][x - 1];
          const hasRight = grid[y][x + 1];
          const hasTop = grid[y - 1]?.[x];
          const hasBottom = grid[y + 1]?.[x];
          if ((hasLeft && hasRight) || (hasTop && hasBottom)) {
            refined[y][x] = hasLeft || hasRight || hasTop || hasBottom;
          }
        }
      }
    }
    return refined;
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  mostCommonColor(colors) {
    const counts = {};
    let maxCount = 0;
    let mostCommon = colors[0];
    for (const c of colors) {
      counts[c] = (counts[c] || 0) + 1;
      if (counts[c] > maxCount) {
        maxCount = counts[c];
        mostCommon = c;
      }
    }
    return mostCommon;
  }

  compressHorizontally(grid, ratio) {
    const w = grid[0]?.length || 0;
    const newWidth = Math.max(1, Math.floor(w * ratio));
    const newGrid = Array(grid.length)
      .fill(null)
      .map(() => Array(newWidth).fill(null));
    const cellWidth = w / newWidth;
    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < newWidth; x++) {
        const startX = Math.floor(x * cellWidth);
        const endX = Math.floor((x + 1) * cellWidth);
        const colors = [];
        for (let sx = startX; sx < endX && sx < w; sx++) {
          if (grid[y][sx]) colors.push(grid[y][sx]);
        }
        if (colors.length > 0) newGrid[y][x] = this.mostCommonColor(colors);
      }
    }
    return newGrid;
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
    const availableWidth = targetWidth - paddingPixels * 2;
    const availableHeight = targetHeight - paddingPixels * 2;
    const scaleX = availableWidth / (contentWidth || 1);
    const scaleY = availableHeight / (contentHeight || 1);
    const scale = Math.min(scaleX, scaleY);
    const scaled = this.scaleGrid(content, scale);
    const scaledWidth = scaled[0]?.length || 0;
    const scaledHeight = scaled.length;
    const usage = (
      ((scaledWidth * scaledHeight) / (targetWidth * targetHeight)) *
      100
    ).toFixed(1);
    console.log(
      `[MaxFill] Content ${contentHeight}×${contentWidth} → scaled ${scaledHeight}×${scaledWidth}, canvas usage ${usage}%`,
    );
    return this.centerInCanvas(scaled, targetWidth, targetHeight);
  }

  getContentBounds(grid) {
    const height = grid.length;
    const width = grid[0]?.length || 0;
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
        if (
          targetY >= 0 &&
          targetY < targetHeight &&
          targetX >= 0 &&
          targetX < targetWidth
        ) {
          canvas[targetY][targetX] = grid[y][x];
        }
      }
    }
    return canvas;
  }

  createEmptyGrid(height, width) {
    return Array(height)
      .fill(null)
      .map(() => Array(width).fill(null));
  }
}

export default GeminiSpriteConverter;
