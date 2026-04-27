import fs from "node:fs";
import path from "node:path";
import {
  mergeCollectibleCardUrls,
  sortCollectibleCardFilenames,
  toPublicCardPaths,
} from "../lib/cardGallerySort";
import { listBlobCardEntries, readLocalCardBasenames } from "./collectibleCardInventory";

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void;
    end: () => void;
  };
};

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
