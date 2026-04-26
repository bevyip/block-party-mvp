import fs from "node:fs";
import path from "node:path";
import { list } from "@vercel/blob";
import {
  sortCollectibleCardFilenames,
  toPublicCardPaths,
} from "../lib/cardGallerySort";

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void;
    end: () => void;
  };
};

function localCardPaths(): string[] {
  const dir = path.join(process.cwd(), "public", "cards");
  try {
    const names = sortCollectibleCardFilenames(fs.readdirSync(dir));
    return toPublicCardPaths(names);
  } catch {
    return [];
  }
}

async function blobCardEntries(): Promise<{ basename: string; url: string }[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const out: { basename: string; url: string }[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const r = await list({
      prefix: "cards/",
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    for (const b of r.blobs) {
      const pathname =
        "pathname" in b && typeof b.pathname === "string"
          ? b.pathname
          : new URL(b.url).pathname;
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
    hasMore = Boolean(r.hasMore);
    cursor = r.cursor;
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
