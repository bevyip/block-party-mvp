import type { GeneratedSpriteEntry } from "./generatedSprites";

export interface PersistedSpriteEntry {
  entry: GeneratedSpriteEntry;
  stateUrls: Record<string, string>;
}

const SESSION_KEY = "blockparty_session_sprites";

export function readSessionSprites(): PersistedSpriteEntry[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: PersistedSpriteEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const entry = rec.entry;
      const stateUrls = rec.stateUrls;
      if (!entry || typeof entry !== "object") continue;
      if (!stateUrls || typeof stateUrls !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.id !== "string") continue;
      out.push({
        entry: entry as GeneratedSpriteEntry,
        stateUrls: stateUrls as Record<string, string>,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function appendSessionSprite(p: PersistedSpriteEntry): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const list = readSessionSprites();
    const next = [...list.filter((x) => x.entry.id !== p.entry.id), p];
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / access errors
  }
}

export function clearSessionSprites(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
