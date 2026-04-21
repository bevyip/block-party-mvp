export type Interpretation = {
  object: string;
  gender: "male" | "female";
  dominant_colors: string[];
  key_traits: string[];
  mood: string;
  peg_colors_used: string[];
  theme_emoji: string;
};

/** Stage 3B animation states (idle + walk fixed; custom is Gemini-designed). */
export type AnimState = "idle" | "walk" | "custom";

export type DesignBrief = {
  gender: "male" | "female";
  skin_tone: "light" | "fair" | "tan" | "dark";
  hair: { style: string; color: string; description: string };
  face: {
    expression: string;
    markings: string | null;
    description: string;
  };
  torso: {
    style: string;
    primary_color: string;
    secondary_color: string | null;
    description: string;
  };
  legs: { style: string; color: string; description: string };
  shoes: { color: string; description: string };
  theme_summary: string;
  theme_elements: string[];
  /**
   * Exactly eight short visual phrases for map speech bubbles — from the brief
   * model (normalized on the server). Optional on older stored briefs.
   */
  speech_tease_phrases?: string[];
};
