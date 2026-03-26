const path = require("path");
const fs = require("fs");
const {
  INTERPRET_PROMPT,
  briefPrompt,
  spritePrompt,
  spriteStatePrompt,
  walkSheetPrompt,
  walkSheetRetryPrompt,
  customStatePrompt,
  STATE_ROW_ORDER_4,
} = require("./prompts.cjs");

const { pathToFileURL } = require("node:url");

const TEXT_MODEL = "gemini-2.0-flash";

const REF_DIR = path.join(
  __dirname,
  "..",
  "public",
  "assets",
  "test",
  "reference",
);

/** Stage 3B — idle, walk (fixed), custom (variable grid + SPEC JSON). */
const ANIM_STATES = ["idle", "walk", "custom"];

const STATE_SHEET_DIMENSIONS = {
  idle: { width: 128, height: 256, frames: 2, rows: 4 },
  walk: { width: 256, height: 256, frames: 4, rows: 4 },
};

const STATE_SPECS = {
  idle: {
    ...STATE_SHEET_DIMENSIONS.idle,
    file: "pose_idle.png",
    rowOrder: STATE_ROW_ORDER_4,
    extra: "",
  },
  walk: {
    ...STATE_SHEET_DIMENSIONS.walk,
    file: "pose_walk.png",
    rowOrder: STATE_ROW_ORDER_4,
    extra: "",
  },
};

const DEFAULT_CUSTOM_SPEC = {
  stateName: "special",
  frameCount: 3,
  directionRows: 4,
  description: "Custom animation",
  looping: true,
  fps: 8,
  rowOrder: "up_left_down_right",
};

function parseCustomSpecFromResponseText(text) {
  if (!text || typeof text !== "string") return null;
  const idx = text.indexOf("SPEC:");
  if (idx < 0) return null;
  const rest = text.slice(idx + 5).trim();
  const jsonStart = rest.indexOf("{");
  if (jsonStart < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = jsonStart; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(rest.slice(jsonStart, end));
  } catch {
    return null;
  }
}

function normalizeCustomSpec(raw) {
  const spec = { ...DEFAULT_CUSTOM_SPEC };
  if (!raw || typeof raw !== "object") return spec;
  if (typeof raw.stateName === "string" && raw.stateName.trim()) {
    spec.stateName = String(raw.stateName)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
    if (!spec.stateName) spec.stateName = DEFAULT_CUSTOM_SPEC.stateName;
  }
  spec.frameCount = 3;
  spec.directionRows = 4;
  spec.rowOrder = "up_left_down_right";
  if (typeof raw.description === "string") spec.description = raw.description;
  if (typeof raw.looping === "boolean") spec.looping = raw.looping;
  const fps = Number(raw.fps);
  if (Number.isFinite(fps))
    spec.fps = Math.max(4, Math.min(8, Math.round(fps)));
  return spec;
}

async function generateCustomAnimState(
  characterB64,
  gender,
  designBrief,
  objectLabel,
  themeSummary,
) {
  const posePath = path.join(REF_DIR, "pose_emote.png");
  let poseBuf;
  try {
    poseBuf = fs.readFileSync(posePath);
  } catch {
    throw new Error(`Could not read pose reference: ${posePath}`);
  }
  const poseB64 = poseBuf.toString("base64");
  const designBriefJson = JSON.stringify(designBrief);
  const { runPipelineGeminiStateGenerate } = await import(
    pathToFileURL(path.join(__dirname, "generateStatesImage.mjs")).href
  );
  const model = "gemini-3-pro-image-preview";

  let lastImageBase64 = null;
  let lastText = "";
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const retryNote =
      attempt > 1
        ? `\n\nRETRY: Previous output did not match SPEC dimensions. The PNG width MUST be frameCount×64 and height MUST be directionRows×64 pixels exactly. Update SPEC JSON to match what you draw.`
        : "";
    const prompt =
      customStatePrompt(objectLabel, themeSummary, designBriefJson) + retryNote;
    try {
      const { imageBase64, text } = await runPipelineGeminiStateGenerate(
        characterB64,
        poseB64,
        prompt,
        model,
      );
      lastImageBase64 = imageBase64;
      lastText = text || "";
      const rawSpec = parseCustomSpecFromResponseText(lastText);
      const customSpec = normalizeCustomSpec(rawSpec);
      const expectedW = customSpec.frameCount * 64;
      const expectedH = customSpec.directionRows * 64;
      try {
        const normalized = await rescaleGeminiImageToPngBase64(
          imageBase64,
          expectedW,
          expectedH,
        );
        return { imageBase64: normalized, customSpec };
      } catch (err) {
        lastErr = err;
      }
    } catch (err) {
      lastErr = err;
    }
  }

  if (lastImageBase64) {
    const customSpec = normalizeCustomSpec(
      parseCustomSpecFromResponseText(lastText),
    );
    return { imageBase64: lastImageBase64, customSpec };
  }

  const message =
    lastErr && typeof lastErr === "object" && "message" in lastErr
      ? String(lastErr.message)
      : "Failed to generate custom state";
  throw new Error(message);
}

function getPngDimensions(base64Png) {
  const b64 = stripDataUrlBase64(base64Png);
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 24) return null;
  const pngSig = "89504e470d0a1a0a";
  if (buf.subarray(0, 8).toString("hex") !== pngSig) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

/**
 * Stage 3B server-side dimension enforcement:
 * validate exact expected sheet size; caller may regenerate when mismatch.
 */
function enforceSheetDimensions(base64Png, expectedWidth, expectedHeight) {
  const dims = getPngDimensions(base64Png);
  if (!dims) {
    throw new Error("Generated output is not a valid PNG.");
  }
  if (dims.width !== expectedWidth || dims.height !== expectedHeight) {
    throw new Error(
      `Generated sheet size ${dims.width}x${dims.height} does not match expected ${expectedWidth}x${expectedHeight}.`,
    );
  }
  return base64Png;
}

/**
 * Gemini `inlineData` is often JPEG/WebP even for "sprite" outputs. Accept any
 * raster format sharp understands, verify dimensions, return PNG base64.
 */
async function coerceGeminiImageToPngBase64(
  rawBase64,
  expectedWidth,
  expectedHeight,
) {
  const stripped = stripDataUrlBase64(rawBase64).replace(/\s/g, "");
  if (!stripped) {
    throw new Error("Missing image data.");
  }
  const fast = getPngDimensions(stripped);
  if (fast && fast.width === expectedWidth && fast.height === expectedHeight) {
    return stripped;
  }
  const sharp = (await import("sharp")).default;
  let buf;
  try {
    buf = Buffer.from(stripped, "base64");
  } catch {
    throw new Error("Invalid base64 image data.");
  }
  if (!buf.length) {
    throw new Error("Image decodes to an empty buffer.");
  }
  let meta;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    throw new Error(
      "Image is not a valid raster format (corrupted or unsupported).",
    );
  }
  if (!meta.width || !meta.height) {
    throw new Error("Could not read image dimensions.");
  }
  if (meta.width !== expectedWidth || meta.height !== expectedHeight) {
    throw new Error(
      `Image size ${meta.width}×${meta.height} does not match expected ${expectedWidth}×${expectedHeight}.`,
    );
  }
  const pngBuf = await sharp(buf).png().toBuffer();
  return pngBuf.toString("base64");
}

/**
 * Stage 3A only: accept any valid raster from Gemini and rescale to exactly
 * targetWidth×targetHeight using nearest-neighbour (pixel-art safe).
 * Unlike coerceGeminiImageToPngBase64, this never rejects on dimension mismatch.
 */
async function rescaleGeminiImageToPngBase64(
  rawBase64,
  targetWidth,
  targetHeight,
) {
  const stripped = stripDataUrlBase64(rawBase64).replace(/\s/g, "");
  if (!stripped) throw new Error("Missing image data.");
  const sharp = (await import("sharp")).default;
  let buf;
  try {
    buf = Buffer.from(stripped, "base64");
  } catch {
    throw new Error("Invalid base64 image data.");
  }
  if (!buf.length) throw new Error("Image decodes to an empty buffer.");
  try {
    const pngBuf = await sharp(buf)
      .resize(targetWidth, targetHeight, { kernel: "nearest" })
      .png()
      .toBuffer();
    return pngBuf.toString("base64");
  } catch {
    throw new Error(
      "Image is not a valid raster format (corrupted or unsupported).",
    );
  }
}

/**
 * Stage 3A strip: nearest resize to 256×64, then swap middle columns (L/R fix).
 */
async function rescaleStage3AStripToPngBase64(rawBase64) {
  const pngB64 = await rescaleGeminiImageToPngBase64(rawBase64, 256, 64);
  const { swapStage3ALeftRightColumns } = await import(
    pathToFileURL(path.join(__dirname, "assembleSprite.mjs")).href
  );
  const stripped = stripDataUrlBase64(pngB64).replace(/\s/g, "");
  const swappedBuf = await swapStage3ALeftRightColumns(
    Buffer.from(stripped, "base64"),
  );
  return swappedBuf.toString("base64");
}

function getApiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k?.trim()) return null;
  return k.trim();
}

function stripJsonFences(raw) {
  return String(raw)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function stripDataUrlBase64(raw) {
  return String(raw ?? "").replace(/^data:image\/[\w.+-]+;base64,/i, "");
}

function parseJsonFromText(raw) {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse JSON from model response");
  }
}

/** Gemini sometimes returns `[{ ... }]` instead of `{ ... }` for application/json. */
function unwrapInterpretationJson(parsed) {
  if (Array.isArray(parsed)) {
    const first = parsed.find((x) => x && typeof x === "object" && !Array.isArray(x));
    return first ?? null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  return null;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const texts = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  return texts;
}

function geminiErrorMessage(data, status) {
  const msg =
    data?.error?.message ||
    data?.error?.status ||
    (typeof data?.error === "string" ? data.error : null);
  if (msg) return String(msg);
  if (!status || status >= 400)
    return `Gemini request failed (${status || "unknown"})`;
  return null;
}

/**
 * Pipeline requires exactly "male" | "female" for reference sprites.
 * Coerce model output; if still ambiguous, pick deterministically from seedString.
 */
function coerceBinaryGender(raw, seedString) {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/^["']|["']$/g, "");
  if (s === "male" || s === "m") return "male";
  if (s === "female" || s === "f") return "female";
  if (
    s.includes("female") ||
    s.includes("woman") ||
    s.includes("girl") ||
    s.includes("feminine")
  ) {
    return "female";
  }
  if (
    s === "male" ||
    /\bmasculine\b/.test(s) ||
    /\bboy\b/.test(s) ||
    /\bman\b/.test(s) ||
    /\bmen\b/.test(s)
  ) {
    return "male";
  }
  const seed = String(seedString ?? "sprite");
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 2 === 0 ? "female" : "male";
}

const SKIN_TONES = new Set(["light", "fair", "tan", "dark"]);

function pickRandomSkinTone() {
  const tones = ["light", "fair", "tan", "dark"];
  return tones[Math.floor(Math.random() * tones.length)];
}

function ensureValidSkinTone(designBrief) {
  if (!designBrief || typeof designBrief !== "object") return;
  const s = String(designBrief.skin_tone ?? "")
    .toLowerCase()
    .trim();
  if (SKIN_TONES.has(s)) {
    designBrief.skin_tone = s;
    return;
  }
  designBrief.skin_tone = pickRandomSkinTone();
}

async function callGemini(model, body) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      data: { error: "GEMINI_API_KEY is not configured" },
    };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const err = geminiErrorMessage(data, res.status);
  if (!res.ok || err) {
    return {
      ok: false,
      status: res.status || 500,
      data: { error: err || "Gemini request failed" },
    };
  }
  return { ok: true, status: res.status, data };
}

async function interpret({ imageBase64, mimeType }) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return { ok: false, status: 400, body: { error: "Missing imageBase64" } };
  }
  let safeMime = "image/png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg")
    safeMime = "image/jpeg";
  else if (mimeType && mimeType !== "image/png") {
    return {
      ok: false,
      status: 400,
      body: { error: "mimeType must be image/png or image/jpeg" },
    };
  }

  const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const result = await callGemini(TEXT_MODEL, {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: safeMime, data: b64 } },
          { text: INTERPRET_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  if (!result.ok)
    return { ok: false, status: result.status, body: result.data };

  const text = extractText(result.data);
  if (!text) {
    return {
      ok: false,
      status: 502,
      body: { error: "Model returned no text (interpretation)" },
    };
  }

  let interpretation;
  try {
    interpretation = unwrapInterpretationJson(parseJsonFromText(text));
  } catch (e) {
    return {
      ok: false,
      status: 502,
      body: {
        error: e instanceof Error ? e.message : "Invalid JSON from model",
      },
    };
  }
  if (!interpretation) {
    return {
      ok: false,
      status: 502,
      body: { error: "Model returned an empty or invalid interpretation object" },
    };
  }

  const objectLabel =
    typeof interpretation.object === "string" ? interpretation.object : "";
  interpretation.gender = coerceBinaryGender(
    interpretation.gender,
    objectLabel,
  );

  return { ok: true, status: 200, body: { interpretation } };
}

async function brief({ interpretation }) {
  if (!interpretation || typeof interpretation !== "object") {
    return {
      ok: false,
      status: 400,
      body: { error: "Missing interpretation object" },
    };
  }

  const interpretationJson = JSON.stringify(interpretation);
  const result = await callGemini(TEXT_MODEL, {
    contents: [
      {
        parts: [{ text: briefPrompt(interpretationJson) }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  if (!result.ok)
    return { ok: false, status: result.status, body: result.data };

  const text = extractText(result.data);
  if (!text) {
    return {
      ok: false,
      status: 502,
      body: { error: "Model returned no text (brief)" },
    };
  }

  let designBrief;
  try {
    designBrief = parseJsonFromText(text);
  } catch (e) {
    return {
      ok: false,
      status: 502,
      body: {
        error: e instanceof Error ? e.message : "Invalid JSON from model",
      },
    };
  }

  const seed =
    typeof interpretation.object === "string" && interpretation.object.trim()
      ? interpretation.object.trim()
      : "sprite";
  designBrief.gender = coerceBinaryGender(designBrief.gender, seed);
  designBrief.skin_tone = pickRandomSkinTone();

  return { ok: true, status: 200, body: { designBrief } };
}

async function generate({ designBrief, interpretation }) {
  if (!designBrief || typeof designBrief !== "object") {
    return {
      ok: false,
      status: 400,
      body: { error: "Missing designBrief object" },
    };
  }
  if (!interpretation || typeof interpretation !== "object") {
    return {
      ok: false,
      status: 400,
      body: { error: "Missing interpretation object" },
    };
  }

  const seed =
    typeof interpretation.object === "string" && interpretation.object.trim()
      ? interpretation.object.trim()
      : "sprite";
  const gender = coerceBinaryGender(designBrief.gender, seed);
  designBrief.gender = gender;
  ensureValidSkinTone(designBrief);
  const refName =
    gender === "male" ? "male_reference.png" : "female_reference.png";
  const idleAllDirectionsRefName =
    gender === "male"
      ? "male_idle_all_directions.png"
      : "female_idle_all_directions.png";
  const refPath = path.join(REF_DIR, refName);
  const idleAllDirectionsRefPath = path.join(REF_DIR, idleAllDirectionsRefName);

  let refBuf;
  try {
    refBuf = fs.readFileSync(refPath);
  } catch {
    return {
      ok: false,
      status: 500,
      body: { error: `Could not read reference image: ${refPath}` },
    };
  }

  const refB64 = refBuf.toString("base64");
  let idleAllDirectionsBuf;
  try {
    idleAllDirectionsBuf = fs.readFileSync(idleAllDirectionsRefPath);
  } catch {
    return {
      ok: false,
      status: 500,
      body: {
        error: `Could not read idle all directions reference image: ${idleAllDirectionsRefPath}`,
      },
    };
  }
  const idleAllDirectionsB64 = idleAllDirectionsBuf.toString("base64");
  const objectLabel =
    typeof interpretation.object === "string" && interpretation.object.trim()
      ? interpretation.object.trim()
      : "the scanned creation";

  const designBriefJson = JSON.stringify(designBrief);
  const prompt = spritePrompt(designBriefJson, objectLabel, gender);

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return {
      ok: false,
      status: 500,
      body: { error: "GEMINI_API_KEY is not configured" },
    };
  }

  let body;
  try {
    const { runPipelineGeminiGenerate } = await import(
      pathToFileURL(path.join(__dirname, "generateImage.mjs")).href
    );
    body = await runPipelineGeminiGenerate(
      refB64,
      idleAllDirectionsB64,
      prompt,
    );
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String(err.message)
        : String(err);
    const status =
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof err.status === "number"
        ? err.status
        : err &&
            typeof err === "object" &&
            "statusCode" in err &&
            typeof err.statusCode === "number"
          ? err.statusCode
          : 500;
    return { ok: false, status, body: { error: message } };
  }

  let pngB64;
  try {
    pngB64 = await rescaleStage3AStripToPngBase64(
      body.imageBase64 ?? body.image,
    );
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String(err.message)
        : String(err);
    return {
      ok: false,
      status: 502,
      body: {
        error: `Stage 3A image could not be processed. ${message}`,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      image: pngB64,
      imageBase64: pngB64,
      mimeType: "image/png",
    },
  };
}

async function generateOneAnimState(
  characterB64,
  gender,
  designBrief,
  stateKey,
) {
  const spec = STATE_SPECS[stateKey];
  if (!spec) throw new Error(`Unknown animation state: ${stateKey}`);

  const posePath = path.join(REF_DIR, spec.file);
  let poseBuf;
  try {
    poseBuf = fs.readFileSync(posePath);
  } catch {
    throw new Error(`Could not read pose reference: ${posePath}`);
  }
  const poseB64 = poseBuf.toString("base64");
  const designBriefJson = JSON.stringify(designBrief);
  const { runPipelineGeminiStateGenerate } = await import(
    pathToFileURL(path.join(__dirname, "generateStatesImage.mjs")).href
  );
  const model =
    stateKey === "custom"
      ? "gemini-3-pro-image-preview"
      : "gemini-3.1-flash-image-preview";

  let lastErr = null;
  let lastImageBase64 = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const attemptNote =
      attempt > 1
        ? "Critical retry instruction: Previous output had incorrect dimensions or layout. Correct to exact grid math now."
        : "";
    const prompt = spriteStatePrompt(
      stateKey,
      spec.frames,
      spec.rows,
      spec.width,
      spec.height,
      designBriefJson,
      gender,
      spec.rowOrder,
      [spec.extra, attemptNote].filter(Boolean).join("\n"),
    );

    try {
      const { imageBase64 } = await runPipelineGeminiStateGenerate(
        characterB64,
        poseB64,
        prompt,
        model,
      );
      lastImageBase64 = imageBase64;
      return await coerceGeminiImageToPngBase64(
        imageBase64,
        spec.width,
        spec.height,
      );
    } catch (err) {
      lastErr = err;
    }
  }

  // Best-effort fallback: if Gemini returned an image but dimensions never matched
  // exactly, still return the latest image so Stage 3B doesn't hard-fail.
  if (lastImageBase64) {
    return lastImageBase64;
  }

  const message =
    lastErr && typeof lastErr === "object" && "message" in lastErr
      ? String(lastErr.message)
      : "Failed to generate valid state image";
  throw new Error(message);
}

function coerceDesignBrief(raw) {
  if (raw == null) {
    return { ok: false, error: "Missing designBrief object" };
  }
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return {
        ok: false,
        error:
          "designBrief must be a JSON object (got a string that is not valid JSON)",
      };
    }
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, error: "Missing designBrief object" };
  }
  return { ok: true, designBrief: v };
}

/**
 * Stage 3B — animation state sheets (raw Gemini PNG base64 per state).
 * Body: { character4ViewBase64, gender, designBrief, onlyState?: "idle"|... }
 */
async function generateStates(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, body: { error: "Invalid body" } };
  }

  const {
    character4ViewBase64,
    designBrief: designBriefRaw,
    onlyState,
    object: bodyObject,
    themeSummary: bodyThemeSummary,
  } = body;

  const coercedBrief = coerceDesignBrief(designBriefRaw);
  if (!coercedBrief.ok) {
    return { ok: false, status: 400, body: { error: coercedBrief.error } };
  }
  const designBrief = coercedBrief.designBrief;

  if (!character4ViewBase64 || typeof character4ViewBase64 !== "string") {
    return {
      ok: false,
      status: 400,
      body: { error: "Missing character4ViewBase64" },
    };
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return {
      ok: false,
      status: 500,
      body: { error: "GEMINI_API_KEY is not configured" },
    };
  }

  const seed =
    typeof designBrief.hair?.description === "string" &&
    designBrief.hair.description.trim()
      ? designBrief.hair.description.trim()
      : "sprite";
  const gender = coerceBinaryGender(body.gender ?? designBrief.gender, seed);
  ensureValidSkinTone(designBrief);

  let charB64;
  try {
    charB64 = await rescaleGeminiImageToPngBase64(
      character4ViewBase64,
      256,
      64,
    );
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String(err.message)
        : String(err);
    return {
      ok: false,
      status: 400,
      body: {
        error: `Stage 3A character strip could not be normalized to 256×64. ${message}`,
      },
    };
  }

  const objectLabel =
    typeof bodyObject === "string" && bodyObject.trim()
      ? bodyObject.trim()
      : Array.isArray(designBrief?.theme_elements) &&
          designBrief.theme_elements[0]
        ? String(designBrief.theme_elements[0])
        : "character";
  const themeSummary =
    typeof bodyThemeSummary === "string" && bodyThemeSummary.trim()
      ? bodyThemeSummary.trim()
      : typeof designBrief?.theme_summary === "string"
        ? designBrief.theme_summary
        : "";

  const statesToRun =
    onlyState != null && String(onlyState).trim() !== ""
      ? [String(onlyState).trim().toLowerCase()]
      : [...ANIM_STATES];

  for (const key of statesToRun) {
    if (!ANIM_STATES.includes(key)) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `onlyState must be one of: ${ANIM_STATES.join(", ")} (got "${onlyState}")`,
        },
      };
    }
  }

  const out = {
    idle: null,
    walk: null,
    custom: null,
    customSpec: null,
    errors: {},
  };

  // Idle + walk are now code-assembled from per-cell Gemini outputs.
  const stage3aBuffer = Buffer.from(charB64, "base64");

  const { runPipelineGeminiStateGenerate } = await import(
    pathToFileURL(path.join(__dirname, "generateStatesImage.mjs")).href
  );
  const { assembleIdleSheet } = await import(
    pathToFileURL(path.join(__dirname, "assembleSprite.mjs")).href
  );

  for (const stateKey of statesToRun) {
    if (stateKey === "idle") {
      try {
        const idleBuf = await assembleIdleSheet(stage3aBuffer);
        const idleB64 = idleBuf.toString("base64");
        enforceSheetDimensions(idleB64, 128, 256);
        out.idle = idleB64;
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err);
        out.errors.idle = message;
      }
      continue;
    }

    if (stateKey === "walk") {
      try {
        const sharpLib = (await import("sharp")).default;
        const {
          assembleWalkSheet,
          normaliseWalkCell,
          measureStage3AFrame,
          rescaleToWalkSheet,
          swapWalkSheetLeftRight,
          sliceWalkSheet,
        } = await import(
          pathToFileURL(path.join(__dirname, "assembleSprite.mjs")).href
        );

        const WALK_SHEET_W = 256;
        const WALK_SHEET_H = 256;
        const WALK_ATTEMPTS = 3;
        const walkModel = "gemini-3-pro-image-preview";

        const ref = await measureStage3AFrame(stage3aBuffer, 0);

        let walkSheetBuf = null;
        let lastDims = null;
        let lastErr = null;

        for (let attempt = 0; attempt < WALK_ATTEMPTS; attempt++) {
          const prompt =
            attempt === 0
              ? walkSheetPrompt()
              : walkSheetRetryPrompt(lastDims);

          try {
            const { imageBase64 } = await runPipelineGeminiStateGenerate(
              charB64,
              null,
              prompt,
              walkModel,
            );

            const rawBuf = Buffer.from(
              stripDataUrlBase64(imageBase64).replace(/\s/g, ""),
              "base64",
            );
            const meta = await sharpLib(rawBuf).metadata();
            if (!meta.width || !meta.height) {
              throw new Error("Could not read image dimensions from Gemini response.");
            }
            lastDims = { width: meta.width, height: meta.height };

            walkSheetBuf = await rescaleToWalkSheet(rawBuf);
            break;
          } catch (err) {
            lastErr = err;
            if (attempt === WALK_ATTEMPTS - 1) throw err;
          }
        }

        if (!walkSheetBuf) {
          throw lastErr ?? new Error("Walk sheet generation failed after all attempts.");
        }

        walkSheetBuf = await swapWalkSheetLeftRight(walkSheetBuf);

        const rawCells = await sliceWalkSheet(walkSheetBuf);

        const walkCells = {};
        for (const dir of ["UP", "LEFT", "DOWN", "RIGHT"]) {
          walkCells[dir] = await Promise.all(
            rawCells[dir].map((cell) => normaliseWalkCell(cell, ref)),
          );
        }

        const walkBuf = await assembleWalkSheet(walkCells);
        const walkB64 = walkBuf.toString("base64");
        enforceSheetDimensions(walkB64, WALK_SHEET_W, WALK_SHEET_H);
        out.walk = walkB64;
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err);
        out.errors.walk = message;
      }
      continue;
    }

    if (stateKey === "custom") {
      try {
        const { imageBase64, customSpec } = await generateCustomAnimState(
          charB64,
          gender,
          designBrief,
          objectLabel,
          themeSummary,
        );
        out.custom = imageBase64;
        out.customSpec = customSpec;
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : String(err);
        out.errors.custom = message;
      }
      continue;
    }

    // Fallback for future states (shouldn't happen in current 3-state flow).
    try {
      const b64 = await generateOneAnimState(
        charB64,
        gender,
        designBrief,
        stateKey,
      );
      out[stateKey] = b64;
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String(err.message)
          : String(err);
      out.errors[stateKey] = message;
    }
  }

  return { ok: true, status: 200, body: out };
}

module.exports = {
  interpret,
  brief,
  generate,
  generateStates,
};
