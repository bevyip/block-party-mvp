import fs from "fs";
import path from "path";

type ApiRes = {
  status: (code: number) => {
    json: (body: unknown) => void;
    end: () => void;
  };
};

export default function handler(
  req: { method?: string },
  res: ApiRes,
) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rootDir = path.join(process.cwd(), "public", "generated-sprites");
    fs.mkdirSync(rootDir, { recursive: true });

    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      fs.rmSync(path.join(rootDir, entry.name), { recursive: true, force: true });
    }

    const manifestPath = path.join(rootDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({ sprites: [] }, null, 2));

    return res.status(200).json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
