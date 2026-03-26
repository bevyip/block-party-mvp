import fs from "fs";
import path from "path";

type CustomStateSpec = {
  stateName: string;
  frameCount: number;
  directionRows: number;
  description: string;
  looping: boolean;
  fps: number;
  rowOrder: "front" | "back_front" | "up_left_down_right";
};

type SaveSpriteBody = {
  /** Optional client-generated id so optimistic map injection matches on-disk folder names. */
  id?: string;
  gender: "male" | "female";
  object: string;
  themeSummary: string;
  brief: unknown;
  themeEmoji?: string;
  portrait: string;
  /** Keys are state filenames without .png (idle, walk, plus custom stateName). */
  states: Record<string, string | null | undefined>;
  customSpec?: CustomStateSpec;
};

function allocateSpriteId(requested: unknown): string {
  const fallback =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (typeof requested !== "string" || !/^[a-z0-9]{6,48}$/i.test(requested)) {
    return fallback;
  }
  return requested;
}

export default function handler(
  req: { method?: string; body?: unknown },
  res: {
    status: (code: number) => {
      json: (body: unknown) => void;
      end: () => void;
    };
  },
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = (req.body ?? {}) as SaveSpriteBody;
    const id = allocateSpriteId(body.id);
    const createdAt = new Date().toISOString();
    const baseDir = path.join(process.cwd(), "public", "generated-sprites", id);

    fs.mkdirSync(baseDir, { recursive: true });

    if (body.portrait) {
      const clean = body.portrait.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(
        path.join(baseDir, "portrait.png"),
        Buffer.from(clean, "base64"),
      );
    }

    const savedStates: string[] = [];
    for (const [state, b64] of Object.entries(body.states ?? {})) {
      if (!b64 || typeof b64 !== "string") continue;
      const clean = b64.replace(/^data:image\/[\w.+-]+;base64,/i, "");
      // Map key "custom" → customSpec.stateName.png so renderer matches manifest (customStateName).
      const fileBase =
        state === "custom" &&
        typeof body.customSpec?.stateName === "string" &&
        body.customSpec.stateName.trim()
          ? body.customSpec.stateName.trim()
          : state;
      fs.writeFileSync(
        path.join(baseDir, `${fileBase}.png`),
        Buffer.from(clean, "base64"),
      );
      savedStates.push(fileBase);
    }

    if (body.customSpec && Object.keys(body.customSpec).length > 0) {
      fs.writeFileSync(
        path.join(baseDir, "custom-spec.json"),
        JSON.stringify(body.customSpec, null, 2),
      );
    }

    const customName = body.customSpec?.stateName;
    const orderedStates = [
      ...(savedStates.includes("idle") ? ["idle"] : []),
      ...(savedStates.includes("walk") ? ["walk"] : []),
      ...(customName && savedStates.includes(customName) ? [customName] : []),
    ];
    const extra = savedStates.filter(
      (s) => s !== "idle" && s !== "walk" && s !== customName,
    );
    const manifestStates = [...orderedStates, ...extra];

    fs.writeFileSync(
      path.join(baseDir, "brief.json"),
      JSON.stringify(
        {
          object: body.object,
          gender: body.gender,
          themeSummary: body.themeSummary,
          brief: body.brief,
          createdAt,
        },
        null,
        2,
      ),
    );

    const manifestPath = path.join(
      process.cwd(),
      "public",
      "generated-sprites",
      "manifest.json",
    );

    let manifest = { sprites: [] as any[] };
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    }

    const entry: Record<string, unknown> = {
      id,
      createdAt,
      object: body.object,
      gender: body.gender,
      themeSummary: body.themeSummary,
      ...(body.themeEmoji ? { themeEmoji: body.themeEmoji } : {}),
      states: manifestStates,
      hasPortrait: !!body.portrait,
    };
    if (customName) {
      entry.customStateName = customName;
    }
    if (body.customSpec) {
      entry.customSpec = body.customSpec;
    }

    manifest.sprites.push(entry);

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return res.status(200).json({ success: true, id, savedStates: manifestStates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
