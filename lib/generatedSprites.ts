export type CustomStateSpec = {
  stateName: string;
  frameCount: number;
  directionRows: number;
  description: string;
  looping: boolean;
  fps: number;
  rowOrder: "front" | "back_front" | "up_left_down_right";
};

export type GeneratedSpriteEntry = {
  id: string;
  createdAt: string;
  object: string;
  gender: "male" | "female";
  themeSummary: string;
  themeEmoji?: string;
  states: string[];
  hasPortrait: boolean;
  customStateName?: string;
  customSpec?: CustomStateSpec;
};

export type GeneratedSpriteManifest = {
  sprites: GeneratedSpriteEntry[];
};

export function getSpriteAssetPath(
  id: string,
  asset: "portrait" | "idle" | "walk" | "run" | "sit" | "emote",
): string {
  return `/generated-sprites/${id}/${asset}.png`;
}

export async function fetchGeneratedManifest(): Promise<GeneratedSpriteManifest> {
  try {
    const res = await fetch("/generated-sprites/manifest.json", {
      cache: "no-store",
    });
    if (!res.ok) return { sprites: [] };
    return res.json();
  } catch {
    return { sprites: [] };
  }
}

export function collectGeneratedSpriteUrls(
  entries: GeneratedSpriteEntry[],
): string[] {
  const urls: string[] = [];
  for (const entry of entries) {
    for (const st of ["idle", "walk"] as const) {
      if (entry.states.includes(st)) {
        urls.push(getSpriteAssetPath(entry.id, st));
      }
    }
    if (entry.customStateName) {
      urls.push(
        `/generated-sprites/${entry.id}/${entry.customStateName}.png`,
      );
    }
    if (entry.hasPortrait) {
      urls.push(getSpriteAssetPath(entry.id, "portrait"));
    }
  }
  return urls;
}
