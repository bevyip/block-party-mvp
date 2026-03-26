import React from "react";
import { ColorChip } from "./ColorChip";
import type { Interpretation } from "../app/pipeline/types";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
      {children}
    </h2>
  );
}

export type InterpretationDisplayProps = {
  interpretation: Interpretation;
  children?: React.ReactNode;
  /** e.g. `p-6` for pipeline, `p-4` for narrow side panel */
  className?: string;
  /** Slightly tighter typography for narrow panels */
  compact?: boolean;
  /** Render content only when parent already shows section title. */
  omitSectionTitle?: boolean;
};

/**
 * Same interpretation card as the pipeline page (Object, mood, traits, colors…).
 */
export function InterpretationDisplay({
  interpretation,
  children,
  className = "rounded-xl border border-neutral-800 bg-neutral-900/50 p-6",
  compact = false,
  omitSectionTitle = false,
}: InterpretationDisplayProps) {
  const list = compact
    ? "text-xs text-neutral-300"
    : "text-sm text-neutral-300";
  const themeEmoji = interpretation.theme_emoji;
  const keyTraits = interpretation.key_traits ?? [];
  const dominantColors = interpretation.dominant_colors ?? [];
  const pegColorsUsed = interpretation.peg_colors_used ?? [];

  return (
    <div className={className}>
      {!omitSectionTitle && <SectionTitle>Interpretation</SectionTitle>}
      <div className={`${omitSectionTitle ? "" : "mt-4"} space-y-4`}>
        <div>
          <p className="text-xs uppercase text-neutral-500">Object</p>
          <p className="text-xs font-medium text-white">
            {interpretation.object}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-neutral-500">Mood</p>
          <p className="text-xs text-neutral-200">{interpretation.mood}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-neutral-500">Emoji</p>
          <p className="text-xs text-neutral-200" aria-label="Theme Emoji">
            {themeEmoji}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-neutral-500">Gender read</p>
          <p className="text-xs text-neutral-200">{interpretation.gender}</p>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase text-neutral-500">Key traits</p>
          <ul className={`list-inside list-disc ${list}`}>
            {keyTraits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase text-neutral-500">
            Dominant colors
          </p>
          <div className="flex flex-wrap gap-2">
            {dominantColors.map((c, i) => (
              <span key={`${c}-${i}`}>
                <ColorChip color={c} />
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase text-neutral-500">
            Peg colors used
          </p>
          <div className="flex flex-wrap gap-2">
            {pegColorsUsed.map((c, i) => (
              <span key={`${c}-${i}`}>
                <ColorChip color={c} />
              </span>
            ))}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
