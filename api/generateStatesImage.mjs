import { GoogleGenAI } from "@google/genai";

/**
 * Stage 3B — Gemini image generation with style + pose reference images.
 * @param {Record<string, unknown>} [extraGenerateConfig] Merged into GenerateContentConfig (e.g. imageConfig for aspect ratio).
 */
export async function runPipelineGeminiStateGenerate(
  charB64,
  poseRefB64,
  prompt,
  model = "gemini-3.1-flash-image-preview",
  extraGenerateConfig = {},
) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const parts = [
    {
      inlineData: { mimeType: "image/png", data: charB64 },
    },
  ];
  if (poseRefB64 != null && poseRefB64 !== "") {
    parts.push({
      inlineData: { mimeType: "image/png", data: poseRefB64 },
    });
  }
  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      ...extraGenerateConfig,
    },
  });

  let imageBase64 = null;
  let mimeType = "image/png";
  const textParts = [];
  const responseParts = response.candidates?.[0]?.content?.parts;
  if (responseParts) {
    for (const part of responseParts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        if (part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
      }
      if (part.text) textParts.push(part.text);
    }
  }

  if (!imageBase64) throw new Error("No image returned from Gemini");

  return { imageBase64, mimeType, text: textParts.join("\n") };
}
