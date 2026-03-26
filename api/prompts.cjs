/** Prompts for the Lite Brite → character pipeline (Gemini). */

const INTERPRET_PROMPT = `Analyze this Lite Brite peg art scan. Identify:
   1. What object or character this creation represents
   2. The dominant peg colors used (from: pink #ff5ecb, red #e81c2a, 
      blue #1a6fff, green #0a7d32, yellow #ffe600, white #f0f0f0, 
      orange #ff8c00)
   3. Key visual traits of the object (shape, texture, notable features)
   4. The overall mood or personality this creation expresses
   5. Which binary gender a human sprite for this theme should use: "male" or "female" only.

   CRITICAL for "gender":
   - The value MUST be exactly the string "male" or exactly the string "female".
   - NEVER use neutral, non-binary, ambiguous, unknown, n/a, or any other label.
   - If the object is not a person (food, animal, object, abstract shape, etc.), still choose "male" or "female":
     pick whichever fits the mood, color energy, and personality you described — like picking a lead for themed merchandise.

   Output ONLY valid JSON, no explanation, no markdown backticks:
   {
     "object": "<string>",
     "gender": "male" | "female",
     "dominant_colors": ["<string>"],
     "key_traits": ["<string>"],
     "mood": "<string>",
     "peg_colors_used": ["<string>"],
     "theme_emoji": "<single emoji character that best represents this object or character — e.g. 🌸 for a flower, 🍔 for a burger, 🐱 for a cat. Must be exactly one emoji, no text>"
   }`;

function briefPrompt(interpretationJson) {
  return `You are a character designer for a pixel art RPG game.
   
   Based on this object analysis: ${interpretationJson}
   
   The JSON field "gender" in your output MUST be exactly "male" or "female" — same rule as the analysis (no neutral or other values).

   Do NOT output "skin_tone" — the game server picks it randomly (lighter vs darker spectrum). In "theme_summary", describe hair, face, expression, and clothing and shoes only. Do NOT mention skin, skin tone, complexion, or any skin-related wording.

   Design a human sprite character that is THEMED after the object.
   Think of how horoscope merchandise reimagines zodiac signs as characters —
   the base is always human, but the visual details express the theme.
   
   The character's colors must ONLY use these hex values:
   #ff5ecb, #e81c2a, #1a6fff, #0a7d32, #ffe600, #f0f0f0, #ff8c00
   Pick the closest matches to the object's natural colors.
   
   Output ONLY valid JSON, no explanation, no markdown backticks:
   {
     "gender": "male" | "female",
     "hair": {
       "style": "<string>",
       "color": "<string>",
       "description": "<string>"
     },
     "face": {
       "expression": "<string>",
       "markings": "<string>" | null,
       "description": "<string>"
     },
     "torso": {
       "style": "<string>",
       "primary_color": "<string>",
       "secondary_color": "<string>" | null,
       "description": "<string>"
     },
     "legs": {
       "style": "<string>",
       "color": "<string>",
       "description": "<string>"
     },
     "shoes": {
       "color": "<string>",
       "description": "<string>"
     },
     "theme_summary": "<ONE sentence only — third-person visual description for a sketch artist: apparent age vibe, hair (style and color), face, expression, clothing layers and colors, shoes; NO mention of skin, skin tone, or complexion; no bullet points, no semicolon lists, no second sentence; plain prose>",
     "theme_elements": ["<string>"]
   }`;
}

function spritePrompt(designBriefJson, objectLabel, gender) {
  return `You are a pixel art sprite sheet generator.

You will receive TWO images.
IMAGE 1 is the ${gender} CHARACTER REFERENCE. Match its body proportions, scale, and pixel art style exactly.
IMAGE 2 is the ${gender} IDLE ALL DIRECTIONS reference. It has two identical 64px-tall rows of four 64×64 frames in order LEFT→RIGHT: DOWN, then LEFT, then RIGHT, then UP. A bottom row is TEXT LABELS ONLY (DOWN / LEFT / RIGHT / UP) aligned under those columns—do not treat it as sprite pixels. Use IMAGE 2 only to learn body shape and profile per direction; match the column order and labels.
Do NOT copy colors, hair, or clothing from either image.

Generate a 4-frame horizontal sprite strip using this design brief:
${designBriefJson}
The character must be recognizably themed as: ${objectLabel}

CANVAS: 256px wide × 64px tall. 4 frames × 64px each.
Frame 1 (x=0–63):    facing DOWN (face visible)
Frame 2 (x=64–127):  facing LEFT
Frame 3 (x=128–191): facing RIGHT
Frame 4 (x=192–255): facing UP (back visible)

Each character sprite must be 32–36 pixels tall within its 64×64 frame. Leave black space above and below. Do not fill the full cell height.
Colors must ONLY use: #ff5ecb #e81c2a #1a6fff #0a7d32 #ffe600 #f0f0f0 #ff8c00 plus #000000 and skin tones.
Background: pure #000000. Pixel art style. Hard edges. No anti-aliasing. No gradients. No drop shadows. No ground shadows. No cast shadows of any kind.
All 4 frames: same character, only facing direction changes.

VERIFY: 256×64px total | 4 frames | correct directions | palette only | pure black background`;
}

/**
 * Stage 3B Walk — ONE call generates the full 256×256 walk spritesheet (4 rows × 4 frames).
 * Sharp slices the result into rows/cells — no per-direction calls needed.
 *
 * Row order (top to bottom):
 *   Row 0 = UP   (back visible)
 *   Row 1 = LEFT  (left profile)
 *   Row 2 = DOWN  (front visible)
 *   Row 3 = RIGHT (right profile)
 */
function walkSheetPrompt() {
  return `You are a pixel art sprite generator for a top-down RPG game.

REFERENCE IMAGE: The character's 256×64px Stage 3A strip — 4 static frames of the SAME character:
  Column 0 (x=0–63):    facing DOWN  (front, face visible)
  Column 1 (x=64–127):  facing LEFT  (left profile)
  Column 2 (x=128–191): facing RIGHT (right profile)
  Column 3 (x=192–255): facing UP    (back, face not visible)
Copy hair, clothing, colors, and pixel art style EXACTLY from this reference.
All 16 output frames must show the SAME character at the SAME scale.

OUTPUT: A single 256×256px PNG. 4 columns × 4 rows. Each cell is exactly 64×64px.

ROW ORDER (top to bottom):
  Row 0 (y=0–63):    facing UP    — back visible, face NOT visible
  Row 1 (y=64–127):  facing LEFT  — left side profile, face points left
  Row 2 (y=128–191): facing DOWN  — front visible, face visible
  Row 3 (y=192–255): facing RIGHT — right side profile, face points right

FRAME ORDER per row (left to right) — 4-frame walk cycle:
  Frame 0 (x=0–63):    neutral stance — feet together, arms at sides
  Frame 1 (x=64–127):  mid-stride    — right foot forward, left foot back, arms swing opposite
  Frame 2 (x=128–191): neutral stance — feet together, arms at sides (identical to frame 0)
  Frame 3 (x=192–255): mid-stride    — left foot forward, right foot back, arms swing opposite

STRICT RULES:
- Exactly 4 rows and exactly 4 columns. Canvas is 256px wide × 256px tall. No more, no fewer.
- Each row shows ONE direction only — direction never changes within a row.
- Only leg and arm positions vary between the 4 frames. Head, torso, hair, clothing are IDENTICAL across all frames in a row.
- Pure black #000000 background. No padding, margins, labels, or borders between cells.
- Hard pixel edges. No anti-aliasing. No gradients. No shadows of any kind.

VERIFY before submitting:
[ ] Canvas is exactly 256px wide × 256px tall
[ ] Exactly 4 columns × 4 rows (16 cells)
[ ] Row 0=UP(back), Row 1=LEFT, Row 2=DOWN(front), Row 3=RIGHT
[ ] Pure black #000000 background`;
}

/**
 * Retry prompt when Gemini returned wrong dimensions.
 * @param {{ width?: number, height?: number } | null} lastDims
 */
function walkSheetRetryPrompt(lastDims) {
  const w = lastDims?.width ?? "?";
  const h = lastDims?.height ?? "?";
  const colsGuess =
    lastDims?.width != null ? Math.round(lastDims.width / 64) : "?";
  const rowsGuess =
    lastDims?.height != null ? Math.round(lastDims.height / 64) : "?";
  return `${walkSheetPrompt()}

⚠ YOUR PREVIOUS OUTPUT WAS ${w}×${h}px (approximately ${colsGuess} columns × ${rowsGuess} rows). THAT IS WRONG.
The required canvas is exactly 256×256px — 4 columns × 4 rows, each cell 64×64px.
Do NOT produce more than 4 rows or 4 columns. One character only.`;
}

/**
 * Stage 3B — one animation state spritesheet (IMAGE 1 = 4-view character, IMAGE 2 = pose layout ref).
 */
function spriteStatePrompt(
  stateName,
  frameCount,
  directionRows,
  expectedWidth,
  expectedHeight,
  designBriefJson,
  gender,
  rowOrderBlock,
  extraNote = "",
) {
  if (stateName === "run") {
    return `You are a pixel art sprite sheet generator.

You will receive TWO images.
IMAGE 1 is the character design reference. Copy appearance exactly: hair, face, clothing, colors, proportions.
IMAGE 2 is the run animation reference. Use it ONLY for leg/arm positions and body lean. Do NOT copy colors or design. Do NOT count frames from IMAGE 2.

CANVAS: 512px wide × 256px tall. 8 columns × 4 rows. Each cell: 64×64px.

Row 0 (y=0):   runs AWAY from viewer (back visible)
Row 1 (y=64):  runs LEFT
Row 2 (y=128): runs TOWARD viewer (face visible)
Row 3 (y=192): runs RIGHT
Every cell in a row maintains that direction.

EXACTLY 8 frames per row. Canvas ends at x=512. No more columns.
Sprite: match IMAGE 1's scale and style. Feet near bottom of cell.
Background: pure #000000. Pixel art. Hard edges. No anti-aliasing.

VERIFY:
[ ] 512×256px | 8 cols × 4 rows
[ ] Row 0: back | Row 1: left | Row 2: front | Row 3: right — all 8 frames each
[ ] Pure black background`;
  }

  const extraBlock = extraNote ? `\n\n${extraNote}\n` : "";
  const row3Line = directionRows === 4 ? "Row 3 (y=192): facing RIGHT" : "";

  let stateOverride = "";
  if (stateName === "sit") {
    stateOverride = `SIT: Exactly 3 rows (no right-facing row). Height = 192px (3 × 64). Width = 128px (2 × 64).
Frame 1: character beginning to sit. Frame 2: character fully seated.`;
  }

  const overrideBlock = stateOverride ? `\n\n${stateOverride}\n` : "";
  return `You are a pixel art sprite sheet generator.

You will receive TWO images.
IMAGE 1 is the character design reference. Copy appearance exactly: hair, face, clothing, colors, proportions.
IMAGE 2 is the pose reference for the "${stateName}" animation. Use it ONLY for body positions and layout. Do NOT copy colors or design.

Draw the character from IMAGE 1 performing the "${stateName}" animation.

CANVAS: ${expectedWidth}px wide × ${expectedHeight}px tall.
${frameCount} frames per row. ${directionRows} rows.
Row 0 (y=0):   facing AWAY (back view)
Row 1 (y=64):  facing LEFT
Row 2 (y=128): facing toward viewer (front view)
${row3Line}
Each cell: 64×64px. Zero padding between frames and rows.
Sprite: match IMAGE 1's scale. Centered horizontally, bottom-aligned in cell.
Background: pure #000000. Pixel art. Hard edges. No anti-aliasing.
${extraBlock}${overrideBlock}
VERIFY: ${expectedWidth}×${expectedHeight}px | ${frameCount} cols × ${directionRows} rows | consistent character across all frames | pure black background`;
}

const STATE_ROW_ORDER_4 = `Row order (top to bottom):
    Row 0: facing UP (back view)
    Row 1: facing LEFT
    Row 2: facing DOWN (front view)
    Row 3: facing RIGHT`;

const STATE_ROW_ORDER_SIT = `Row order (top to bottom) — exactly 3 direction rows only (up, left, down). No right-facing row:
    Row 0: facing UP (back view)
    Row 1: facing LEFT
    Row 2: facing DOWN (front view)`;

/**
 * Stage 3B — unique per-character animation (variable grid); model must output SPEC: JSON line.
 */
function customStatePrompt(object, themeSummary, designBriefJson) {
  const objQ = JSON.stringify(String(object ?? ""));
  const themeQ = JSON.stringify(String(themeSummary ?? ""));
  return `You are a pixel art sprite sheet generator designing a unique animation for an RPG character.

IMAGE 1: Character visual design reference. Copy hair, clothing, colors, proportions exactly.
IMAGE 2: Pose reference. Use only for pixel art proportions and movement style. Ignore colors and design.

CHARACTER: Themed as ${objQ}. Theme: ${themeQ}.
Design brief: ${designBriefJson}

Design ONE animation that fits this character's theme (e.g. a food character eating, a nature character swaying).

CONSTRAINTS:
- Frames per row: exactly 3 frames. Always 3. No more, no less.
- Direction rows: always exactly 4 rows (up/left/down/right). No exceptions.
- Row order top to bottom: Row 0=UP (back), Row 1=LEFT, Row 2=DOWN (front), Row 3=RIGHT
- fps: 4–8
- Each cell: 64×64px | sprite bottom-aligned, matching IMAGE 1's scale
- Black background #000000 | pixel art, no anti-aliasing
- Total canvas: exactly 192px wide (3 frames × 64px) × 256px tall (4 rows × 64px).

Output TWO things:
1. The sprite sheet image.
2. A SPEC line immediately after the image (plain text, not in a code block):
SPEC:{"stateName":"<single_word_or_two_words>","frameCount":3,"directionRows":4,"description":"<one sentence>","looping":<true|false>,"fps":<4-8>,"rowOrder":"up_left_down_right"}`;
}

module.exports = {
  INTERPRET_PROMPT,
  briefPrompt,
  spritePrompt,
  // Walk: new single-sheet approach (replaces walkRowPrompt / walkRowRetryPrompt)
  walkSheetPrompt,
  walkSheetRetryPrompt,
  // Keep old exports for any callers that haven't migrated yet
  walkRowPrompt: walkSheetPrompt, // shim — direction param ignored
  walkRowRetryPrompt: (dir, gender, dims) => walkSheetRetryPrompt(dims), // shim
  spriteStatePrompt,
  customStatePrompt,
  STATE_ROW_ORDER_4,
  STATE_ROW_ORDER_SIT,
};
