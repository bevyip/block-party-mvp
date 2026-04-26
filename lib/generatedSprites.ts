export type CustomStateSpec = {
  stateName: string;
  frameCount: number;
  directionRows: number;
  description: string;
  looping: boolean;
  fps: number;
  rowOrder: "front" | "back_front" | "up_left_down_right";
};

/** Stage 2 `DesignBrief` slices stored per sprite on the manifest (`footwear` = brief `shoes`). */
export type ManifestStage2Hair = {
  style: string;
  color: string;
  description: string;
};
export type ManifestStage2Face = {
  expression: string;
  markings: string | null;
  description: string;
};
export type ManifestStage2Torso = {
  style: string;
  primary_color: string;
  secondary_color: string | null;
  description: string;
};
export type ManifestStage2Legs = {
  style: string;
  color: string;
  description: string;
};
export type ManifestStage2Footwear = { color: string; description: string };

export type ManifestStage2Appearance = {
  hair: ManifestStage2Hair;
  face: ManifestStage2Face;
  torso: ManifestStage2Torso;
  legs: ManifestStage2Legs;
  footwear: ManifestStage2Footwear;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Pulls Hair / Face / Torso / Legs / Footwear from a Stage 2 design brief for the manifest.
 * Returns undefined if `brief` is missing or not shaped like `DesignBrief`.
 *
 * Local dev (`npm run dev:api`) mirrors this in `api/manifestStage2.cjs` — keep them aligned.
 */
export function manifestStage2FromBrief(
  brief: unknown,
): ManifestStage2Appearance | undefined {
  if (!isRecord(brief)) return undefined;
  const hair = brief.hair;
  const face = brief.face;
  const torso = brief.torso;
  const legs = brief.legs;
  const shoes = brief.shoes;
  if (
    !isRecord(hair) ||
    !isRecord(face) ||
    !isRecord(torso) ||
    !isRecord(legs) ||
    !isRecord(shoes)
  ) {
    return undefined;
  }
  if (
    typeof hair.style !== "string" ||
    typeof hair.color !== "string" ||
    typeof hair.description !== "string"
  ) {
    return undefined;
  }
  if (
    typeof face.expression !== "string" ||
    typeof face.description !== "string" ||
    !("markings" in face)
  ) {
    return undefined;
  }
  const markings: string | null =
    face.markings === null || typeof face.markings === "string"
      ? (face.markings as string | null)
      : null;
  if (
    typeof torso.style !== "string" ||
    typeof torso.primary_color !== "string" ||
    typeof torso.description !== "string" ||
    !("secondary_color" in torso)
  ) {
    return undefined;
  }
  const secondary: string | null =
    torso.secondary_color === null || typeof torso.secondary_color === "string"
      ? (torso.secondary_color as string | null)
      : null;
  if (
    typeof legs.style !== "string" ||
    typeof legs.color !== "string" ||
    typeof legs.description !== "string"
  ) {
    return undefined;
  }
  if (typeof shoes.color !== "string" || typeof shoes.description !== "string") {
    return undefined;
  }
  return {
    hair: {
      style: hair.style,
      color: hair.color,
      description: hair.description,
    },
    face: {
      expression: face.expression,
      markings,
      description: face.description,
    },
    torso: {
      style: torso.style,
      primary_color: torso.primary_color,
      secondary_color: secondary,
      description: torso.description,
    },
    legs: {
      style: legs.style,
      color: legs.color,
      description: legs.description,
    },
    footwear: {
      color: shoes.color,
      description: shoes.description,
    },
  };
}

export type GeneratedSpriteEntry = {
  id: string;
  createdAt: string;
  object: string;
  gender: "male" | "female";
  /** Stage 2 appearance (replaces legacy `themeSummary` on the manifest). */
  hair?: ManifestStage2Hair;
  face?: ManifestStage2Face;
  torso?: ManifestStage2Torso;
  legs?: ManifestStage2Legs;
  footwear?: ManifestStage2Footwear;
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
