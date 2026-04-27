/**
 * One-off: upload every PNG in public/cards to Vercel Blob under prefix cards/
 * (same layout as runtime uploads). Requires BLOB_READ_WRITE_TOKEN.
 *
 * Usage:
 *   node scripts/sync-public-cards-to-blob.mjs           # skip if basename already in blob
 *   node scripts/sync-public-cards-to-blob.mjs --force # upload / overwrite all
 *   node scripts/sync-public-cards-to-blob.mjs --dry-run
 *
 * Loads .env.local then .env from repo root (run from repo root).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { list, put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

config({ path: path.join(root, ".env.local") });
config({ path: path.join(root, ".env") });

/** Same rules as lib/cardGallerySort.ts */
const RE_CARD_NUMBERED = /^CARD \((\d+)\)\.png$/i;
const RE_CARD_BASE = /^CARD\.png$/i;
const RE_UPLOAD = /^upload-([a-z0-9]+)-/i;

function toSortable(name) {
  if (RE_CARD_BASE.test(name)) {
    return { name, tier: 0, a: 0, b: "" };
  }
  const mNum = name.match(RE_CARD_NUMBERED);
  if (mNum) {
    return { name, tier: 0, a: Number.parseInt(mNum[1], 10), b: "" };
  }
  const mUp = name.match(RE_UPLOAD);
  if (mUp) {
    const ts = Number.parseInt(mUp[1], 36);
    return { name, tier: 1, a: Number.isFinite(ts) ? ts : 0, b: "" };
  }
  return { name, tier: 2, a: 0, b: name.toLowerCase() };
}

function compareSortable(x, y) {
  if (x.tier !== y.tier) return x.tier - y.tier;
  if (x.tier === 0 || x.tier === 1) {
    if (x.a !== y.a) return x.a - y.a;
  }
  if (x.tier === 2) {
    if (x.b !== y.b) return x.b < y.b ? -1 : 1;
  }
  return x.name.localeCompare(y.name, undefined, { sensitivity: "base" });
}

function sortCollectibleCardFilenames(filenames) {
  const pngs = filenames.filter(
    (n) => n.toLowerCase().endsWith(".png") && !n.startsWith("."),
  );
  const parsed = pngs.map((name) => toSortable(name));
  parsed.sort(compareSortable);
  return parsed.map((p) => p.name);
}

async function existingBlobBasenames() {
  const set = new Set();
  let cursor;
  let hasMore = true;
  while (hasMore) {
    const r = await list({
      prefix: "cards/",
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    for (const b of r.blobs) {
      const pathname =
        typeof b.pathname === "string"
          ? b.pathname
          : new URL(b.url).pathname;
      const base = pathname.split("/").filter(Boolean).pop();
      if (base) set.add(base);
    }
    hasMore = Boolean(r.hasMore);
    cursor = r.cursor;
  }
  return set;
}

function parseArgs(argv) {
  return {
    force: argv.includes("--force"),
    dryRun: argv.includes("--dry-run"),
  };
}

async function main() {
  const { force, dryRun } = parseArgs(process.argv.slice(2));

  const cardsDir = path.join(root, "public", "cards");
  if (!fs.existsSync(cardsDir)) {
    console.error(`No directory: ${cardsDir}`);
    process.exit(1);
  }

  const names = sortCollectibleCardFilenames(fs.readdirSync(cardsDir));
  if (names.length === 0) {
    console.log("No PNG files in public/cards.");
    process.exit(0);
  }

  if (dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.log(
      "[dry-run] No BLOB_READ_WRITE_TOKEN — local PNGs that would upload to cards/:",
    );
    for (const name of names) {
      console.log(`  cards/${name}`);
    }
    console.log(`[dry-run] ${names.length} file(s).`);
    process.exit(0);
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      "Missing BLOB_READ_WRITE_TOKEN. Set it in .env.local (or env) and retry.",
    );
    process.exit(1);
  }

  const already = force ? new Set() : await existingBlobBasenames();
  let uploaded = 0;
  let skipped = 0;

  console.log(
    dryRun
      ? "[dry-run] Would sync these files to blob prefix cards/:"
      : "Syncing public/cards → Vercel Blob (prefix cards/)…",
  );

  for (const name of names) {
    const localPath = path.join(cardsDir, name);
    const blobPath = `cards/${name}`;

    if (!force && already.has(name)) {
      console.log(`  skip (already in blob): ${name}`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  ${force ? "put" : "put if missing"}: ${blobPath}`);
      continue;
    }

    const buf = fs.readFileSync(localPath);
    await put(blobPath, buf, {
      access: "public",
      contentType: "image/png",
      allowOverwrite: true,
    });
    console.log(`  uploaded: ${blobPath} (${buf.length} bytes)`);
    uploaded += 1;
  }

  if (dryRun) {
    console.log(`[dry-run] ${names.length} file(s) considered.`);
    process.exit(0);
  }

  console.log(`Done. uploaded=${uploaded}, skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
