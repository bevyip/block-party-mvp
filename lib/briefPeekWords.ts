import type { DesignBrief } from "../app/pipeline/types";

/** How many speech bubbles the map tease shows. */
export const TEASE_BUBBLE_COUNT = 8;

/**
 * Shuffle a copy of `phrases` and return up to `count` items (no repeats).
 * If there are fewer than `count` phrases, returns all of them (caller may pad).
 */
export function pickRandomTeasePhrases(
  phrases: readonly string[],
  count: number = TEASE_BUBBLE_COUNT,
): string[] {
  const trimmed = phrases
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);
  if (trimmed.length === 0) return [];
  const copy = [...trimmed];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = t;
  }
  return copy.slice(0, Math.min(count, copy.length));
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "with",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "their",
  "her",
  "his",
  "its",
  "this",
  "that",
  "these",
  "those",
  "who",
  "which",
]);

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function looksLikeHexToken(s: string): boolean {
  const t = s.trim();
  if (/^#?[0-9a-fA-F]{6}$/i.test(t)) return true;
  if (/^#?[0-9a-fA-F]{3}$/i.test(t)) return true;
  return false;
}

function pushUnique(
  out: string[],
  seen: Set<string>,
  raw: string,
  maxLen = 36,
): void {
  let t = norm(raw);
  if (!t) return;
  if (t.length > maxLen) t = `${t.slice(0, maxLen - 1)}…`;
  const key = t.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(t);
}

/** Pull a few vocabulary tokens from a prose field (adjectives / nouns). */
function tokensFromProse(s: string, maxTake: number): string[] {
  const parts = norm(s)
    .split(/[\s,.;:]+/)
    .map((p) => p.replace(/^['"([{]+|['")\]}]+$/g, ""))
    .filter(Boolean);
  const picked: string[] = [];
  for (const p of parts) {
    if (picked.length >= maxTake) break;
    if (p.length < 2) continue;
    const low = p.toLowerCase();
    if (STOP.has(low)) continue;
    if (looksLikeHexToken(p) || p.includes("#")) continue;
    picked.push(p);
  }
  return picked;
}

/**
 * Fallback tease tokens when `speech_tease_phrases` is missing: hair/face/torso/legs/shoes
 * and `theme_summary` only — excludes theme_elements, skin_tone, and hex-like tokens.
 */
export function buildPeekWordsFromBrief(
  b: DesignBrief,
  maxTotal = 28,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = norm(raw);
    if (!t || looksLikeHexToken(t) || t.includes("#")) return;
    pushUnique(out, seen, raw);
  };

  add(b.hair.style);
  add(b.hair.color);
  for (const w of tokensFromProse(b.hair.description ?? "", 3)) add(w);

  add(b.face.expression);
  if (b.face.markings) add(b.face.markings);
  for (const w of tokensFromProse(b.face.description ?? "", 4)) add(w);

  add(b.torso.style);
  for (const w of tokensFromProse(b.torso.description ?? "", 3)) add(w);

  add(b.legs.style);
  add(b.legs.color);
  for (const w of tokensFromProse(b.legs.description ?? "", 2)) add(w);

  add(b.shoes.color);
  for (const w of tokensFromProse(b.shoes.description ?? "", 2)) add(w);

  const summary = norm(b.theme_summary);
  if (summary.length > 0) {
    const head = summary.split(/[,;]/)[0] ?? summary;
    for (const w of tokensFromProse(head, 5)) add(w);
  }

  return out.slice(0, maxTotal);
}
