import type { DesignBrief, Interpretation } from "../app/pipeline/types";
import { removeBackground } from "./removeBackground";

/**
 * Stage 3A: POST /api/generate, then client-side background removal.
 * Same sequence as Character pipeline page `runGenerate`.
 */
export async function generateStage3AImage(
  designBrief: DesignBrief,
  interpretation: Interpretation,
): Promise<{ rawBase64: string; cleanedDataUrl: string }> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ designBrief, interpretation }),
  });
  const data = (await res.json()) as {
    imageBase64?: string;
    image?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  const raw = data.imageBase64 ?? data.image;
  if (!raw || typeof raw !== "string") {
    throw new Error("No image in response");
  }
  const cleanedDataUrl = await removeBackground(
    `data:image/png;base64,${raw}`,
  );
  return { rawBase64: raw, cleanedDataUrl };
}
