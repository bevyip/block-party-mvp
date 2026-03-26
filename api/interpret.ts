import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const handlers = require("./handlers.cjs") as {
  interpret: (body: unknown) => Promise<{
    ok: boolean;
    status: number;
    body: unknown;
  }>;
};

export default async function handler(
  req: { method?: string; body?: unknown },
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

  const result = await handlers.interpret(req.body ?? {});
  res.setHeader("Content-Type", "application/json");
  res.status(result.status).json(result.body);
}

export const config = {
  api: {
    bodyParser: true,
  },
};
