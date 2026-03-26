import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const handlers = require("./handlers.cjs") as {
  generateStates: (body: unknown) => Promise<{
    ok: boolean;
    status: number;
    body: unknown;
  }>;
};

/**
 * Optional Vite/Node handler mirror for POST /api/generate-states.
 * Dev API traffic is served by api-server.cjs (same handlers).
 */
export default async function handler(
  req: { method?: string; body?: unknown },
  res: {
    status: (code: number) => { json: (body: unknown) => void; end: () => void };
    setHeader: (name: string, value: string) => void;
  },
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const result = await handlers.generateStates(req.body ?? {});
  res.setHeader("Content-Type", "application/json");
  res.status(result.status).json(result.body);
}

/** Vercel / serverless: allow large Stage 3B JSON (base64 + brief). */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "32mb",
    },
  },
};
