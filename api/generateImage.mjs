import { GoogleGenAI } from "@google/genai";

/**
 * POST /api/generate — Gemini image generation only (no REST proxy).
 */
export async function runPipelineGeminiGenerate(refB64, idleAllDirectionsB64, prompt) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image-preview",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: { mimeType: "image/png", data: refB64 },
          },
          {
            inlineData: { mimeType: "image/png", data: idleAllDirectionsB64 },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  let imageBase64 = null;
  let mimeType = "image/png";
  const parts = response.candidates?.[0]?.content?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        if (part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
        break;
      }
    }
  }

  if (!imageBase64) throw new Error("No image returned from Gemini");

  return { image: imageBase64, imageBase64, mimeType };
}
