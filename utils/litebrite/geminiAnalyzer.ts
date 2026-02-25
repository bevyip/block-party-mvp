import type { SemanticAnalysis, GridAnalysis, DetectedColor } from "./types";
import { LITEBRITE_PALETTE, resolveColorCode } from "./constants";

const post = async (body: object): Promise<unknown> => {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}.`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
};

const stripFences = (raw: string): string =>
  raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

const parseJson = <T>(raw: string): T => {
  try {
    return JSON.parse(stripFences(raw)) as T;
  } catch {
    const match = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) return JSON.parse(match[1]) as T;
    throw new Error("Could not parse Gemini JSON response");
  }
};

// ── Stage 1 ────────────────────────────────────────────────

const STAGE1_PROMPT = `You are analyzing a photo of a Lite-Brite toy board.
The board is a dark/black grid of small holes. Colored plastic pegs have been inserted into some holes to form a creation. Most of the board may be empty — focus only on the area where colored pegs are present.

The only possible peg colors are: red, blue, green, pink, yellow, white, orange.

Identify what real-world object the creation depicts based on the shapes and color relationships.
Do not describe the arrangement of colors as the subject — always identify the actual object.

For estimatedRows and estimatedCols, think about the real-world object in its natural upright orientation:
- A round apple is roughly as wide as it is tall
- A tall flower with stem is taller than wide
- A wide butterfly is wider than tall

Return ONLY a JSON object (no markdown) with this exact shape:
{
  "subject": "<a noun phrase completing 'We think your creation is ___' — describe specific parts, colors, and positions naturally. Do not use the words peg, pegs, lite-brite, or board.>",
  "colors": ["red", "green"],
  "estimatedRows": <integer: natural upright height of the object>,
  "estimatedCols": <integer: natural upright width of the object>,
  "aspectRatio": "<one of: wider-than-tall | taller-than-wide | roughly-square>"
}

Rules:
- "colors" is a simple array from the allowed list above only.
- Only include colors actually present as pegs. Ignore the black board background.`;

export const runStage1 = async (
  boardBase64: string,
): Promise<SemanticAnalysis> => {
  console.log("[Gemini Stage 1] Analyzing colors and subject...");

  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: boardBase64 } },
          { text: STAGE1_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  };

  const raw = (await post(body)) as string;
  const parsed = parseJson<{
    subject: string;
    colors: string[];
    estimatedRows: number;
    estimatedCols: number;
    aspectRatio?: string;
  }>(raw);

  if (!parsed.colors || parsed.colors.length === 0) {
    throw new Error("Stage 1: No colors detected in the image.");
  }

  // Map each Gemini color name → canonical palette entry
  const colors: DetectedColor[] = [];
  const usedCodes = new Set<string>();

  for (const name of parsed.colors) {
    const code = resolveColorCode(name);
    if (!code) {
      console.warn(
        `[Gemini Stage 1] Unrecognized color name "${name}" — skipping`,
      );
      continue;
    }
    if (usedCodes.has(code)) continue;
    usedCodes.add(code);
    colors.push({
      name,
      hex: LITEBRITE_PALETTE[code].hex,
      code,
    });
  }

  if (colors.length === 0) {
    throw new Error(
      "Stage 1: Could not resolve any colors to the Lite-Brite palette.",
    );
  }

  console.log("[Gemini Stage 1] Subject:", parsed.subject, "| Colors:", colors);

  const aspectRatio = parsed.aspectRatio as
    | "wider-than-tall"
    | "taller-than-wide"
    | "roughly-square"
    | undefined;
  return {
    subject: parsed.subject,
    colors,
    estimatedRows: Math.max(1, parsed.estimatedRows || 10),
    estimatedCols: Math.max(1, parsed.estimatedCols || 10),
    aspectRatio: aspectRatio ?? "roughly-square",
  } as SemanticAnalysis;
};

// ── Stage 2 ────────────────────────────────────────────────

const buildStage2Prompt = (analysis: SemanticAnalysis): string => {
  const colorList = analysis.colors
    .map((c) => `"${c.code}" = ${c.name}`)
    .join(", ");

  const aspectRatio =
    (analysis as SemanticAnalysis & { aspectRatio?: string }).aspectRatio ??
    "roughly-square";

  return `You are looking at a photo of a Lite-Brite board showing: ${analysis.subject}

Color codes: ${colorList}, "." = empty/transparent

Your task is to TRACE what you actually see in the photo — not draw from imagination.

Look at the photo carefully:
1. Find where the colored pegs are located on the board
2. Mentally overlay a grid on the peg cluster
3. For each grid cell, write the code of the color peg in that cell, or "." if empty

The output grid should faithfully represent the ACTUAL layout of pegs in the photo.
The shape should match what was physically made — not a textbook version of ${analysis.subject}.

Important:
- The creation may be rotated or diagonal in the photo — output it upright
- All rows must be the same length, pad with "." symmetrically
- Aim for about ${analysis.estimatedRows} rows × ${analysis.estimatedCols} cols
- Keep the correct aspect ratio: ${aspectRatio}

Return ONLY this JSON (no markdown):
{
  "reasoning": "<one sentence: describe what you see in the photo and how you traced it>",
  "grid": ["row0", "row1", ...]
}`;
};

const coordinatesToGrid = (
  regions: { code: string; pixels: [number, number][] }[],
  width: number,
  height: number,
): string[] => {
  const grid: string[][] = Array.from({ length: height }, () =>
    Array(width).fill("."),
  );

  for (const region of regions) {
    for (const [row, col] of region.pixels) {
      if (row >= 0 && row < height && col >= 0 && col < width) {
        grid[row][col] = region.code;
      }
    }
  }

  return grid.map((row) => row.join(""));
};

export const runStage2 = async (
  boardBase64: string,
  analysis: SemanticAnalysis,
): Promise<GridAnalysis> => {
  console.log("[Gemini Stage 2] Generating ASCII grid...");

  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: boardBase64 } },
          { text: buildStage2Prompt(analysis) },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.05,
    },
  };

  const raw = (await post(body)) as string;
  const parsed = parseJson<{
    reasoning?: string;
    grid: string[];
  }>(raw);

  if (!parsed.grid || parsed.grid.length === 0) {
    throw new Error("Stage 2: Gemini returned an empty grid.");
  }

  const maxLen = Math.max(...parsed.grid.map((r) => r.length));
  const normalizedGrid = parsed.grid.map((r) => {
    const trimmed = r.trim();
    const totalPad = maxLen - trimmed.length;
    const leftPad = Math.floor(totalPad / 2);
    const rightPad = totalPad - leftPad;
    return ".".repeat(leftPad) + trimmed + ".".repeat(rightPad);
  });

  const validCodes = new Set(analysis.colors.map((c) => c.code));
  const cleanGrid = normalizedGrid.map((row) =>
    row
      .split("")
      .map((ch) => (ch === "." || validCodes.has(ch) ? ch : "."))
      .join(""),
  );

  // Trim empty rows
  let topRow = 0;
  let bottomRow = cleanGrid.length - 1;
  while (
    topRow < cleanGrid.length &&
    cleanGrid[topRow].split("").every((c) => c === ".")
  )
    topRow++;
  while (
    bottomRow > topRow &&
    cleanGrid[bottomRow].split("").every((c) => c === ".")
  )
    bottomRow--;
  const trimmedGrid = cleanGrid.slice(topRow, bottomRow + 1);

  const colorMap: Record<string, string> = {};
  for (const c of analysis.colors) {
    colorMap[c.code] = LITEBRITE_PALETTE[c.code].hex;
  }

  console.log("[Gemini Stage 2] reasoning:", parsed.reasoning ?? "(none)");
  console.log(
    `[Gemini Stage 2] Grid: ${trimmedGrid.length} rows × ${trimmedGrid[0]?.length ?? 0} cols`,
  );

  return { grid: trimmedGrid, colorMap };
};

export const runStage3 = async (
  boardBase64: string,
  analysis: SemanticAnalysis,
  frontGrid: string[],
): Promise<GridAnalysis> => {
  console.log("[Gemini Stage 3] Generating side view...");

  const colorList = analysis.colors
    .map((c) => `"${c.code}" = ${c.name}`)
    .join(", ");

  const targetHeight = frontGrid.length;

  const prompt = `You are creating the LEFT SIDE VIEW for a pixel art sprite of: ${analysis.subject}

The front view grid (already traced from the actual creation) is:
${frontGrid.join("\n")}

Color codes: ${colorList}, "." = empty/transparent

The side view represents the DEPTH of the object — how thick it is when viewed from the side.
This width becomes the z-depth in a 3D voxel rendering, so it must feel physically real.

3D depth rules:
- ROUND objects (heart, apple, ball, orange): depth nearly equals width → side is wide oval
- THICK flat objects (flower head, leaf, mushroom cap): still has real thickness → minimum 4-5 cols wide, showing a rounded edge profile
- THIN flat objects (paper, card): 2-3 cols wide
- CYLINDRICAL (bottle, trunk, stem): 40-60% of front width, straight sides

IMPORTANT: Nothing should be 1-2 cols wide unless it is literally paper-thin.
Even objects that appear flat from the front have real physical thickness in 3D.
Use the object's real-world nature to estimate depth — for example:
- A flower head: petals have thickness → 4-5 cols
- A flower stem: cylindrical → 2-3 cols
- A fruit (apple, orange): nearly as deep as wide → round oval side
- A leaf: thin but not paper-thin → 2-3 cols
- A person/character: body depth → 3-5 cols

Apply this same reasoning to whatever object you are drawing.
Ask yourself: if I held this object in my hand and looked at it from the side, how thick would it be?
That thickness is what the side view width should represent.

The side view must be exactly ${targetHeight} rows tall.
The silhouette height profile should match the front view — wide rows in the front stay wide from the side.

All rows same length, pad with "." symmetrically.

Return ONLY this JSON (no markdown):
{
  "reasoning": "<state: what is this object's 3D shape, how deep is it, and what width did you choose for the side view>",
  "grid": ["row0", "row1", ...]
}`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  };

  const raw = (await post(body)) as string;
  const parsed = parseJson<{
    reasoning?: string;
    grid: string[];
  }>(raw);

  if (!parsed.grid || parsed.grid.length === 0) {
    throw new Error("Stage 3: Gemini returned an empty grid.");
  }

  const maxLen = Math.max(...parsed.grid.map((r) => r.length));
  const normalizedGrid = parsed.grid.map((r) => {
    const trimmed = r.trim();
    const totalPad = maxLen - trimmed.length;
    const leftPad = Math.floor(totalPad / 2);
    const rightPad = totalPad - leftPad;
    return ".".repeat(leftPad) + trimmed + ".".repeat(rightPad);
  });

  const validCodes = new Set(analysis.colors.map((c) => c.code));
  const cleanGrid = normalizedGrid.map((row) =>
    row
      .split("")
      .map((ch) => (ch === "." || validCodes.has(ch) ? ch : "."))
      .join(""),
  );

  // Trim empty rows top and bottom
  let topRow = 0;
  let bottomRow = cleanGrid.length - 1;
  while (
    topRow < cleanGrid.length &&
    cleanGrid[topRow].split("").every((c) => c === ".")
  )
    topRow++;
  while (
    bottomRow > topRow &&
    cleanGrid[bottomRow].split("").every((c) => c === ".")
  )
    bottomRow--;
  const trimmedGrid = cleanGrid.slice(topRow, bottomRow + 1);

  const colorMap: Record<string, string> = {};
  for (const c of analysis.colors) {
    colorMap[c.code] = LITEBRITE_PALETTE[c.code].hex;
  }

  console.log("[Gemini Stage 3] reasoning:", parsed.reasoning ?? "(none)");
  console.log(
    `[Gemini Stage 3] Side grid: ${trimmedGrid.length} rows × ${trimmedGrid[0]?.length ?? 0} cols`,
  );

  return { grid: trimmedGrid, colorMap };
};
