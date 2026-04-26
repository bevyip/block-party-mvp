/**
 * Collectible card filenames under `public/cards` (PNG only).
 * Keep in sync with any server that lists the same folder.
 */
export function sortCollectibleCardFilenames(filenames: string[]): string[] {
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

export function toPublicCardPaths(filenames: string[]): string[] {
  return filenames.map((n) => `/cards/${n}`);
}

/**
 * Merge repo paths (`/cards/…`) with blob `{ basename, url }`, prefer local URL when names clash,
 * then order by the same rules as `sortCollectibleCardFilenames` (base template before `(n)` variants).
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
