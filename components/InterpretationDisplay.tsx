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
    ? "text-[10px] leading-snug text-neutral-300"
    : "text-sm text-neutral-300";
  const labelCls = compact
    ? "text-[10px] uppercase tracking-wide text-neutral-500"
    : "text-xs uppercase text-neutral-500";
  const valueCls = compact
    ? "text-[11px] leading-snug text-neutral-200"
    : "text-xs text-neutral-200";
  const objectCls = compact
    ? "text-[11px] font-medium leading-snug text-white"
    : "text-xs font-medium text-white";
  const innerGap = compact ? "space-y-2.5" : "space-y-4";
  const themeEmoji = interpretation.theme_emoji;
  const keyTraits = interpretation.key_traits ?? [];
  const dominantColors = interpretation.dominant_colors ?? [];
  const pegColorsUsed = interpretation.peg_colors_used ?? [];

  return (
    <div className={className}>
      {!omitSectionTitle && <SectionTitle>Interpretation</SectionTitle>}
      <div className={`${omitSectionTitle ? "" : "mt-4"} ${innerGap}`}>
        <div>
          <p className={labelCls}>Object</p>
          <p className={objectCls}>{interpretation.object}</p>
        </div>
        <div>
          <p className={labelCls}>Mood</p>
          <p className={valueCls}>{interpretation.mood}</p>
        </div>
        <div>
          <p className={labelCls}>Emoji</p>
          <p className={valueCls} aria-label="Theme Emoji">
            {themeEmoji}
          </p>
        </div>
        <div>
          <p className={labelCls}>Gender read</p>
          <p className={valueCls}>{interpretation.gender}</p>
        </div>
        <div>
          <p className={`mb-2 ${labelCls}`}>Key traits</p>
          <ul className={`list-inside list-disc ${list}`}>
            {keyTraits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className={`mb-2 ${labelCls}`}>Dominant colors</p>
          <div className="flex flex-wrap gap-2">
            {dominantColors.map((c, i) => (
              <span key={`${c}-${i}`}>
                <ColorChip color={c} />
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className={`mb-2 ${labelCls}`}>Peg colors used</p>
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
