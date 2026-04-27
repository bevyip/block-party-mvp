import fs from "node:fs";
import path from "node:path";
import { listBlobCardEntries, readLocalCardBasenames } from "./collectibleCardInventory";

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void;
    end: () => void;
  };
};

/**
 * Duplicated from `lib/cardGallerySort.ts` so this route bundles on Vercel without `../lib/`.
 * Order: `CARD.png`, `CARD (1)`…`(n)`, `upload-*`, other.
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

function sortCollectibleCardFilenames(filenames: string[]): string[] {
  const pngs = filenames.filter(
    (n) => n.toLowerCase().endsWith(".png") && !n.startsWith("."),
  );
  const parsed = pngs.map((name) => toSortable(name));
  parsed.sort(compareSortable);
  return parsed.map((p) => p.name);
}

function toPublicCardPaths(filenames: string[]): string[] {
  return filenames.map((n) => `/cards/${n}`);
}

function mergeCollectibleCardUrls(
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

function localCardPaths(): string[] {
  const names = sortCollectibleCardFilenames(readLocalCardBasenames());
  return toPublicCardPaths(names);
}

export default async function handler(
  req: { method?: string },
  res: ApiRes,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const local = localCardPaths();
    const blobs = await listBlobCardEntries();
    const urls = mergeCollectibleCardUrls(local, blobs);
    res.status(200).json({ urls });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
