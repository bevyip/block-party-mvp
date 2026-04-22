import { get, put } from "@vercel/blob";

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

const BLOB_PREFIX = "generated-sprites";

function allocateSpriteId(requested: unknown): string {
  const fallback =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (typeof requested !== "string" || !/^[a-z0-9]{6,48}$/i.test(requested)) {
    return fallback;
  }
  return requested;
}

async function readManifest(): Promise<{ sprites: Record<string, unknown>[] }> {
  try {
    const r = await get(`${BLOB_PREFIX}/manifest.json`, { access: "public" });
    if (!r || r.statusCode !== 200 || !r.stream) {
      return { sprites: [] };
    }
    const text = await new Response(r.stream).text();
    const parsed = JSON.parse(text) as { sprites?: unknown[] };
    const sprites = Array.isArray(parsed.sprites)
      ? (parsed.sprites as Record<string, unknown>[])
      : [];
    return { sprites };
  } catch {
    return { sprites: [] };
  }
}

export default async function handler(
  req: { method?: string; body?: unknown },
  res: {
    status: (code: number) => {
      json: (body: unknown) => void;
      end: () => void;
    };
  },
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({
      error:
        "Blob storage is not configured. Set BLOB_READ_WRITE_TOKEN for Vercel Blob.",
    });
    return;
  }

  try {
    const body = (req.body ?? {}) as SaveSpriteBody;
    const id = allocateSpriteId(body.id);
    const createdAt = new Date().toISOString();
    const basePath = `${BLOB_PREFIX}/${id}`;

    const putPublicPng = (pathname: string, buffer: Buffer) =>
      put(pathname, buffer, {
        access: "public",
        contentType: "image/png",
        allowOverwrite: true,
      });

    let portraitUrl: string | undefined;

    if (body.portrait) {
      const clean = body.portrait.replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(clean, "base64");
      const blob = await putPublicPng(`${basePath}/portrait.png`, buf);
      portraitUrl = blob.url;
    }

    const savedStates: string[] = [];
    const stateUrls: Record<string, string> = {};

    for (const [state, b64] of Object.entries(body.states ?? {})) {
      if (!b64 || typeof b64 !== "string") continue;
      const clean = b64.replace(/^data:image\/[\w.+-]+;base64,/i, "");
      const fileBase =
        state === "custom" &&
        typeof body.customSpec?.stateName === "string" &&
        body.customSpec.stateName.trim()
          ? body.customSpec.stateName.trim()
          : state;
      const buf = Buffer.from(clean, "base64");
      const blob = await putPublicPng(`${basePath}/${fileBase}.png`, buf);
      savedStates.push(fileBase);
      stateUrls[fileBase] = blob.url;
    }

    if (body.customSpec && Object.keys(body.customSpec).length > 0) {
      await put(`${basePath}/custom-spec.json`, JSON.stringify(body.customSpec, null, 2), {
        access: "public",
        contentType: "application/json",
        allowOverwrite: true,
      });
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

    await put(
      `${basePath}/brief.json`,
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
      {
        access: "public",
        contentType: "application/json",
        allowOverwrite: true,
      },
    );

    const manifest = await readManifest();

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

    const manifestBlob = await put(
      `${BLOB_PREFIX}/manifest.json`,
      JSON.stringify(manifest, null, 2),
      {
        access: "public",
        contentType: "application/json",
        allowOverwrite: true,
      },
    );

    res.status(200).json({
      success: true,
      id,
      savedStates: manifestStates,
      stateUrls,
      ...(portraitUrl ? { portraitUrl } : {}),
      manifestUrl: manifestBlob.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
