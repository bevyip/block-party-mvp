// Vercel serverless function: proxy Gemini API so the key stays server-side.

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export default async function handler(
  req: { method?: string; body?: object },
  res: {
    status: (code: number) => {
      json: (body: unknown) => void;
      end: () => void;
    };
    setHeader: (name: string, value: string) => void;
  },
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey?.trim()) {
    res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    return;
  }

  const url = `${GEMINI_URL}?key=${apiKey}`;
  const proxyRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body ?? {}),
  });

  const data = await proxyRes.json().catch(() => ({}));
  res.setHeader("Content-Type", "application/json");
  res.status(proxyRes.status).json(data);
}

export const config = {
  api: {
    bodyParser: true,
  },
};
