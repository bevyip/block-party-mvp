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
