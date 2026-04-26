import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
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

function allocateFilename(): string {
  return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`;
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

  const filename = allocateFilename();

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
