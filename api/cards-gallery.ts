import fs from "node:fs";
import path from "node:path";
import { list } from "@vercel/blob";

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void;
    end: () => void;
  };
};

/** Duplicated from `lib/cardGallerySort.ts` so this route bundles on Vercel without `../lib/`. */
function sortCollectibleCardFilenames(filenames: string[]): string[] {
  const pngs = filenames.filter(
    (n) => n.toLowerCase().endsWith(".png") && !n.startsWith("."),
  );
  const parsed = pngs.map((name) => {
    const stem = name.replace(/\.png$/i, "");
    const m = stem.match(/^(.+?) \((\d+)\)$/);
    if (m) {
      return {
        name,
        order: Number.parseInt(m[2]!, 10),
        tie: m[1]!,
      };
    }
    return { name, order: 0, tie: stem };
  });
  parsed.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.tie !== b.tie) return a.tie.localeCompare(b.tie);
    return a.name.localeCompare(b.name);
  });
  return parsed.map((p) => p.name);
}

function toPublicCardPaths(filenames: string[]): string[] {
  return filenames.map((n) => `/cards/${n}`);
}

function localCardPaths(): string[] {
  const dir = path.join(process.cwd(), "public", "cards");
  try {
    const names = sortCollectibleCardFilenames(fs.readdirSync(dir));
    return toPublicCardPaths(names);
  } catch {
    return [];
  }
}

const MAX_LIST_PAGES = 40;

async function blobCardEntries(): Promise<{ basename: string; url: string }[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const out: { basename: string; url: string }[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  let pages = 0;
  try {
    while (hasMore && pages < MAX_LIST_PAGES) {
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
          "pathname" in b && typeof b.pathname === "string" && b.pathname.length > 0
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
        typeof r.cursor === "string" && r.cursor.length > 0 ? r.cursor : undefined;
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
    const localBasenames = new Set(
      local.map((u) => u.replace(/^\/cards\//, "")),
    );
    const blobs = await blobCardEntries();
    const extra = blobs.filter((b) => !localBasenames.has(b.basename));
    extra.sort((a, b) => a.basename.localeCompare(b.basename));
    const urls = [...local, ...extra.map((e) => e.url)];
    res.status(200).json({ urls });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
