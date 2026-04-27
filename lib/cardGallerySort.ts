/**
 * Collectible card filenames under `public/cards` (PNG only).
 * Keep in sync with any server that lists the same folder.
 *
 * Do not import this module from `api/*.ts` — Vercel serverless can fail to bundle `../lib/`.
 * `api/cards-gallery.ts` duplicates sort/merge here; `api/collectibleCardInventory.ts` holds
 * `nextNumberedCardBasename` for uploads.
 *
 * Order: `CARD.png` first (index 0), then `CARD (1).png` … `CARD (n).png` ascending,
 * then legacy `upload-*.png` (by embedded timestamp), then any other names.
 */

const RE_CARD_NUMBERED = /^CARD \((\d+)\)\.png$/i;
const RE_CARD_BASE = /^CARD\.png$/i;
const RE_UPLOAD = /^upload-([a-z0-9]+)-/i;

type Sortable = { name: string; tier: 0 | 1 | 2; a: number; b: string };

function toSortable(name: string): Sortable {
  if (RE_CARD_BASE.test(name)) {
    return { name, tier: 0, a: 0, b: "" };
  }
  const mNum = name.match(RE_CARD_NUMBERED);
  if (mNum) {
    return {
      name,
      tier: 0,
      a: Number.parseInt(mNum[1]!, 10),
      b: "",
    };
  }
  const mUp = name.match(RE_UPLOAD);
  if (mUp) {
    const ts = Number.parseInt(mUp[1]!, 36);
    return {
      name,
      tier: 1,
      a: Number.isFinite(ts) ? ts : 0,
      b: "",
    };
  }
  return { name, tier: 2, a: 0, b: name.toLowerCase() };
}

function compareSortable(x: Sortable, y: Sortable): number {
  if (x.tier !== y.tier) return x.tier - y.tier;
  if (x.tier === 0 || x.tier === 1) {
    if (x.a !== y.a) return x.a - y.a;
  }
  if (x.tier === 2) {
    if (x.b !== y.b) return x.b < y.b ? -1 : 1;
  }
  return x.name.localeCompare(y.name, undefined, { sensitivity: "base" });
}

export function sortCollectibleCardFilenames(filenames: string[]): string[] {
  const pngs = filenames.filter(
    (n) => n.toLowerCase().endsWith(".png") && !n.startsWith("."),
  );
  const parsed = pngs.map((name) => toSortable(name));
  parsed.sort(compareSortable);
  return parsed.map((p) => p.name);
}

export function toPublicCardPaths(filenames: string[]): string[] {
  return filenames.map((n) => `/cards/${n}`);
}

/**
 * Merge repo paths (`/cards/…`) with blob `{ basename, url }`, prefer local URL when names clash,
 * then order: `CARD.png`, `CARD (1)`…`(n)`, `upload-*`, other.
 */
export function mergeCollectibleCardUrls(
  localPaths: string[],
  blobEntries: { basename: string; url: string }[],
): string[] {
  const urlByBase = new Map<string, string>();
  for (const u of localPaths) {
    const b = u.replace(/^\/cards\//, "");
    if (b) urlByBase.set(b, u);
  }
  for (const e of blobEntries) {
    if (!urlByBase.has(e.basename)) urlByBase.set(e.basename, e.url);
  }
  const sortedNames = sortCollectibleCardFilenames([...urlByBase.keys()]);
  return sortedNames.map((name) => urlByBase.get(name)!);
}

function basenameFromGalleryUrl(url: string): string {
  try {
    const pathname = url.startsWith("http")
      ? new URL(url).pathname
      : url.startsWith("/")
        ? url
        : `/${url}`;
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return url;
  }
}

/** Re-order a flat list of `/cards/…` or absolute blob URLs using the same filename rules. */
export function sortCollectibleGalleryUrls(urls: readonly string[]): string[] {
  const urlByBase = new Map<string, string>();
  for (const u of urls) {
    const b = basenameFromGalleryUrl(u);
    if (b) urlByBase.set(b, u);
  }
  const sortedNames = sortCollectibleCardFilenames([...urlByBase.keys()]);
  return sortedNames.map((name) => urlByBase.get(name)!);
}
