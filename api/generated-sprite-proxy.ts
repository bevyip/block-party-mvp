import { head } from "@vercel/blob";

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void;
    end: (chunk?: string) => void;
  };
  setHeader: (name: string, value: string) => void;
};

/**
 * `save-sprite` stores PNGs on Vercel Blob; the app still requests same-origin
 * `/generated-sprites/…` paths. When those files are not in `public/` (e.g. no PNGs in git),
 * resolve the blob by pathname and redirect the browser to the public blob URL.
 */
function safeRelativePath(raw: string | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const decoded = decodeURIComponent(raw.trim());
  if (!decoded || decoded.includes("..")) return null;
  const noLeading = decoded.replace(/^\/+/, "");
  if (!noLeading || noLeading.includes("\\")) return null;
  return noLeading;
}

export default async function handler(
  req: { method?: string; url?: string },
  res: ApiRes,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({
      error: "BLOB_READ_WRITE_TOKEN is not set; cannot resolve generated sprites on Blob.",
    });
    return;
  }

  let pathParam: string | undefined;
  try {
    const u = String(req.url ?? "").split("?")[1] ?? "";
    pathParam = new URLSearchParams(u).get("path") ?? undefined;
  } catch {
    pathParam = undefined;
  }

  const relative = safeRelativePath(pathParam);
  if (!relative) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  const blobPath = `generated-sprites/${relative}`;

  try {
    const meta = await head(blobPath, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    res.setHeader("Location", meta.url);
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
    res.status(302).end();
  } catch {
    res.status(404).end();
  }
}
