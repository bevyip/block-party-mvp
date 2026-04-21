import React from "react";
import { KEYWORD_CASCADE_TITLE_STYLE } from "./KeywordCascade";

export interface ChamberRevealProps {
  /** How many of the three animation states were manually approved (0–3), in any order. */
  chambersComplete: number;
  /** Merged onto the root (e.g. opacity transition from map overlay). */
  rootStyle?: React.CSSProperties;
}

const ROMAN = ["I", "II", "III"] as const;

/** Subtle pulse on the next empty ring so the beat reads as “waiting for approval”. */
const CHAMBER_NEXT_GLOW_STYLES = `
@keyframes mapChamberNextGlow {
  0%, 100% {
    box-shadow: 0 0 5px rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.22);
  }
  50% {
    box-shadow:
      0 0 14px rgba(255, 255, 255, 0.38),
      0 0 28px rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.52);
  }
}
`;

/**
 * Three chamber steps as rings → solid white by approval count from the pipeline
 * (first approval fills I, second fills II, etc., regardless of idle/walk/custom).
 */
export default function ChamberReveal({
  chambersComplete,
  rootStyle,
}: ChamberRevealProps) {
  const awaitingIndex = chambersComplete < 3 ? chambersComplete : null;

  return (
    <div
      role="status"
      aria-label={`Chamber progress: ${chambersComplete} of 3 approved`}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "6vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        gap: "clamp(2.25rem, 9vw, 5.25rem)",
        padding: "0 clamp(20px, 6vw, 72px)",
        pointerEvents: "none",
        ...rootStyle,
      }}
    >
      <style>{CHAMBER_NEXT_GLOW_STYLES}</style>
      {[0, 1, 2].map((i) => {
        const done = chambersComplete > i;
        const isNextAwaiting = !done && awaitingIndex === i;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              aria-hidden
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                boxSizing: "border-box",
                border: done
                  ? "2px solid rgba(255,255,255,0.95)"
                  : "2px solid rgba(255,255,255,0.22)",
                background: done ? "#ffffff" : "transparent",
                boxShadow: done
                  ? "0 0 20px rgba(255,255,255,0.28), inset 0 0 12px rgba(0,0,0,0.06)"
                  : isNextAwaiting
                    ? "0 0 5px rgba(255, 255, 255, 0.14)"
                    : "none",
                transition: isNextAwaiting
                  ? "background 0.5s ease"
                  : "border-color 0.5s ease, background 0.5s ease, box-shadow 0.5s ease",
                animation: isNextAwaiting
                  ? "mapChamberNextGlow 2.1s ease-in-out infinite"
                  : undefined,
              }}
            />
            <span
              style={{
                ...KEYWORD_CASCADE_TITLE_STYLE,
                textAlign: "center",
                color: done ? "#00ffe0" : "rgba(0, 255, 224, 0.38)",
                transition: "color 0.45s ease",
              }}
            >
              {ROMAN[i]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
