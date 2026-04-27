import fs from "node:fs";
import path from "node:path";
import { list } from "@vercel/blob";

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void;
    end: () => void;
  };
};

/**
 * This file is intentionally self-contained (no `./other-api-module` imports). Vercel can fail to
 * bundle or resolve sibling `api/*.ts` modules, causing `FUNCTION_INVOCATION_FAILED` at runtime.
 *
 * Duplicated from `lib/cardGallerySort.ts` (sort) — keep in sync. Order: `CARD.png`, `CARD (1)`…
 */
const RE_CARD_NUMBERED = /^CARD \((\d+)\)\.png$/i;
const RE_CARD_BASE = /^CARD\.png$/i;
const RE_UPLOAD = /^upload-([a-z0-9]+)-/i;
const MAX_BLOB_LIST_PAGES = 40;

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

function readLocalCardBasenames(): string[] {
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

async function listBlobCardEntries(): Promise<
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
