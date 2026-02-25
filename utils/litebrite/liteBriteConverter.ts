// ─────────────────────────────────────────────────────────
// liteBriteConverter.ts
// Orchestrator: File → LiteBriteConversionResult
//
// Pipeline:
//   1. Crop board from photo (boardCropper)
//   2. Stage 1 Gemini: semantic analysis (geminiAnalyzer)
//   3. Stage 2 Gemini: character grid front view (geminiAnalyzer)
//   4. Char grid → PegGrid (gridRenderer)
//   5. Scale to sprite dimensions (gridRenderer)
//   6. Stage 3 Gemini: side view (geminiAnalyzer); back = mirror front, right = mirror left
// ─────────────────────────────────────────────────────────

import { cropBoard } from "./boardCropper";
import { runStage1, runStage2, runStage3 } from "./geminiAnalyzer";
import {
  charGridToPegGrid,
  scalePegGridToSprite,
  scalePegGridToMatchHeight,
} from "./gridRenderer";
import type { LiteBriteConversionResult } from "./types";

export interface ConvertLiteBriteOptions {
  onStage1Complete?: () => void;
}

export const convertLiteBriteToSprite = async (
  file: File,
  options?: ConvertLiteBriteOptions
): Promise<LiteBriteConversionResult> => {
  console.log("[LiteBrite] Step 1: Cropping board from photo...");
  const boardBase64 = await cropBoard(file);

  console.log("[LiteBrite] Step 2: Running semantic analysis...");
  const semanticAnalysis = await runStage1(boardBase64);
  options?.onStage1Complete?.();

  console.log("[LiteBrite] Step 3: Generating front/back character grid...");
  const gridAnalysis = await runStage2(boardBase64, semanticAnalysis);

  console.log("[LiteBrite] Step 4: Converting front grid to peg map...");
  const rawFrontPegGrid = charGridToPegGrid(gridAnalysis);

  console.log("[LiteBrite] Step 5: Scaling to sprite dimensions...");
  const frontGrid = scalePegGridToSprite(rawFrontPegGrid);
  const backGrid = frontGrid.map((row) => [...row].reverse());

  let frontContentMinRow = frontGrid.length;
  let frontContentMaxRow = -1;
  for (let y = 0; y < frontGrid.length; y++) {
    const hasContent = frontGrid[y].some((cell) => cell !== null);
    if (hasContent) {
      if (y < frontContentMinRow) frontContentMinRow = y;
      if (y > frontContentMaxRow) frontContentMaxRow = y;
    }
  }
  const frontContentHeight =
    frontContentMaxRow > -1
      ? frontContentMaxRow - frontContentMinRow + 1
      : frontGrid.length;

  console.log(
    `[LiteBrite] Front content height: ${frontContentHeight} rows (canvas: ${frontGrid.length})`
  );

  console.log("[LiteBrite] Step 6: Generating side view with Gemini...");
  const sideGridAnalysis = await runStage3(
    boardBase64,
    semanticAnalysis,
    gridAnalysis.grid
  );

  const rawSidePegGrid = charGridToPegGrid(sideGridAnalysis);
  const sideGrid = scalePegGridToMatchHeight(
    rawSidePegGrid,
    frontContentHeight,
    frontGrid.length
  );
  const rightGrid = sideGrid.map((row) => [...row].reverse());

  console.log("[LiteBrite] Conversion complete:", {
    subject: semanticAnalysis.subject,
    colors: semanticAnalysis.colors.map((c) => `${c.name} (${c.hex})`),
    frontSize: `${frontGrid.length}×${frontGrid[0]?.length ?? 0}`,
    sideSize: `${sideGrid.length}×${sideGrid[0]?.length ?? 0}`,
  });

  return {
    views: {
      front: frontGrid,
      back: backGrid,
      left: sideGrid,
      right: rightGrid,
    },
    dimensions: {
      width: frontGrid[0]?.length ?? 24,
      height: frontGrid.length,
    },
    subject: semanticAnalysis.subject,
    colors: semanticAnalysis.colors,
  };
};
