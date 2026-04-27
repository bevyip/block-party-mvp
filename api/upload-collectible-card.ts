import fs from "node:fs";
import path from "node:path";
import { list, put } from "@vercel/blob";
import sharp from "sharp";

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void;
    end: () => void;
  };
};

type Body = {
  imageBase64?: string;
};

const MAX_BLOB_LIST_PAGES = 40;
const RE_CARD_INDEX = /^CARD \((\d+)\)\.png$/i;

/**
 * Inlined (no other `api/*.ts` imports) so Vercel can bundle the function reliably.
 * Must match the listing logic in `api/cards-gallery.ts` / `lib/cardGallerySort`.
 */
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

async function listBlobCardEntriesForBasenamesOnly(): Promise<string[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const basenames: string[] = [];
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
        basenames.push(base);
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
  return basenames;
}

async function getAllCollectibleCardBasenames(): Promise<string[]> {
  const s = new Set<string>(readLocalCardBasenames());
  for (const b of await listBlobCardEntriesForBasenamesOnly()) s.add(b);
  return [...s];
}

function maxCardIndexFromBasenames(basenames: string[]): number {
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

function nextNumberedCardBasename(basenames: string[]): string {
  return `CARD (${maxCardIndexFromBasenames(basenames) + 1}).png`;
}

export default async function handler(
  req: { method?: string; body?: unknown },
  res: ApiRes,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = (req.body ?? {}) as Body;
  const raw =
    typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
  if (!raw) {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  const clean = raw.replace(/^data:image\/[\w.+-]+;base64,/i, "");
  let input: Buffer;
  try {
    input = Buffer.from(clean, "base64");
  } catch {
    res.status(400).json({ error: "Invalid base64" });
    return;
  }

  if (input.length < 32) {
    res.status(400).json({ error: "Image data too small" });
    return;
  }
  if (input.length > 18 * 1024 * 1024) {
    res.status(413).json({ error: "Image too large (max ~18MB raw)" });
    return;
  }

  let png: Buffer;
  try {
    png = await sharp(input).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    res.status(400).json({ error: "Could not decode image (use PNG or JPEG)" });
    return;
  }

  let filename: string;
  try {
    const basenames = await getAllCollectibleCardBasenames();
    filename = nextNumberedCardBasename(basenames);
  } catch {
    res.status(500).json({ error: "Could not list existing cards" });
    return;
  }

  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(`cards/${filename}`, png, {
        access: "public",
        contentType: "image/png",
        allowOverwrite: true,
      });
      res.status(200).json({
        ok: true,
        url: blob.url,
        filename,
        storage: "blob",
      });
      return;
    }

    if (process.env.VERCEL) {
      res.status(503).json({
        error:
          "Uploads on Vercel require BLOB_READ_WRITE_TOKEN. Run locally with npm run dev:api to write to public/cards.",
      });
      return;
    }

    const dir = path.join(process.cwd(), "public", "cards");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), png);
    res.status(200).json({
      ok: true,
      url: `/cards/${filename}`,
      filename,
      storage: "filesystem",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};
