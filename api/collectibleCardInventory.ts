import fs from "node:fs";
import path from "node:path";
import { list } from "@vercel/blob";

const MAX_BLOB_LIST_PAGES = 40;

/**
 * All PNG basenames in `public/cards` (no order).
 */
export function readLocalCardBasenames(): string[] {
  const dir = path.join(process.cwd(), "public", "cards");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter(
    (n) => n.toLowerCase().endsWith(".png") && !n.startsWith("."),
  );
}

/**
 * Vercel Blob objects under `cards/` (same as cards-gallery API).
 */
export async function listBlobCardEntries(): Promise<
  { basename: string; url: string }[]
> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const out: { basename: string; url: string }[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  let pages = 0;
  try {
    while (hasMore && pages < MAX_BLOB_LIST_PAGES) {
      pages += 1;
      const r = await list({
        prefix: "cards/",
        limit: 500,
        ...(cursor ? { cursor } : {}),
      });
      const batch = Array.isArray(r.blobs) ? r.blobs : [];
      for (const b of batch) {
        if (!b.url || typeof b.url !== "string") continue;
        let pathname =
          "pathname" in b &&
          typeof b.pathname === "string" &&
          b.pathname.length > 0
            ? b.pathname
            : "";
        if (!pathname) {
          try {
            pathname = new URL(b.url).pathname;
          } catch {
            continue;
          }
        }
        const lastSeg = pathname.split("/").filter(Boolean).pop() ?? "";
        let base = lastSeg;
        try {
          base = decodeURIComponent(lastSeg);
        } catch {
          base = lastSeg;
        }
        if (!base.toLowerCase().endsWith(".png")) continue;
        out.push({ basename: base, url: b.url });
      }
      const nextCursor =
        typeof r.cursor === "string" && r.cursor.length > 0
          ? r.cursor
          : undefined;
      if (Boolean(r.hasMore) && !nextCursor) {
        break;
      }
      hasMore = Boolean(r.hasMore);
      cursor = nextCursor;
    }
  } catch {
    return [];
  }
  return out;
}

/**
 * Union of local + blob basenames (for choosing the next `CARD (n).png` index).
 */
export async function getAllCollectibleCardBasenames(): Promise<string[]> {
  const s = new Set<string>(readLocalCardBasenames());
  const blobs = await listBlobCardEntries();
  for (const b of blobs) s.add(b.basename);
  return [...s];
}

/** Duplicated from `lib/cardGallerySort.ts` — lives here so upload route avoids `../lib/` on Vercel. */
const RE_CARD_INDEX = /^CARD \((\d+)\)\.png$/i;

export function maxCardIndexFromBasenames(basenames: string[]): number {
  let max = 0;
  for (const n of basenames) {
    const m = n.match(RE_CARD_INDEX);
    if (m) {
      const v = Number.parseInt(m[1]!, 10);
      if (v > max) max = v;
    }
  }
  return max;
}

export function nextNumberedCardBasename(basenames: string[]): string {
  return `CARD (${maxCardIndexFromBasenames(basenames) + 1}).png`;
}
