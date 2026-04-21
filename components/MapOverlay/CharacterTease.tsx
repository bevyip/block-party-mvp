import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  pickRandomTeasePhrases,
  TEASE_BUBBLE_COUNT,
} from "../../lib/briefPeekWords";
import { resolvePegSwatchHex } from "../../lib/pegSwatchColors";
import DecryptedText from "../DecryptedText";
import { particleCanvasSize, useOverlayFigureLayout } from "./figureLayout";
import {
  KEYWORD_CASCADE_TITLE_STYLE,
  type KeywordCascadeRow,
} from "./KeywordCascade";

export interface CharacterTeaseProps {
  paletteColors: string[];
  themeWords: string[];
  silhouetteHint: string;
  /**
   * When set (e.g. from pipeline `stage2_complete`), drives bubble copy from the
   * full character brief; otherwise falls back to `themeWords` + `silhouetteHint`.
   */
  peekWords?: string[];
  /** Map overlay: advance pipeline when tease is done. Dev / preview may pass a noop. */
  onComplete: () => void;
  /** Frozen keyword rails (same data as the keywords phase) sit between tease columns and the canvas. */
  keywords: KeywordCascadeRow[];
  /**
   * When set, the particle canvas renders in the center slot (dev preview).
   * Map overlay omits this — `ParticleCanvas` is fullscreen behind this component.
   */
  centerCanvas?: React.ReactNode;
}

/** Same as `KeywordCascade` keyword rails — must not overlap tease columns. */
const KEYWORD_RAIL_MAX = "clamp(88px, 22vw, 240px)";
/** Outer gutters for speech bubbles only. */
const TEASE_COL_MAX = "clamp(104px, 30vw, 300px)";
const SECTION_STACK_GAP = "clamp(28px, 4.5vh, 52px)";
const ROW_GAP = "clamp(8px, 1.8vw, 28px)";

/** Bubble shell fade + zoom; decrypt starts only after this completes. */
const BUBBLE_FADE_IN_MS = 800;
const HOLD_VISIBLE_MS = 980;

/** Slower than keyword cascade so tease reads clearly after the bubble fade. */
const TEASE_DECRYPT_SPEED_MS = 118;

/** Subtle scale variety (1 = largest); repeats every 5 tease items. */
const TEASE_BUBBLE_SCALE = [1, 0.97, 0.99, 0.95, 0.98] as const;

function teaseDisplayLower(s: string): string {
  return s.toLowerCase();
}

function teaseBubbleSizeMul(globalIndex: number): number {
  return TEASE_BUBBLE_SCALE[globalIndex % TEASE_BUBBLE_SCALE.length] ?? 1;
}

const styles = `
@keyframes teaseBubbleIn {
  from {
    opacity: 0;
    transform: scale(0.72);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
.map-tease-crypt {
  opacity: 0.4;
  font-family: "Roboto Mono", monospace;
}
`;

function teaseItemHoldMs(text: string, baseMs: number): number {
  const decryptMs = text.length * TEASE_DECRYPT_SPEED_MS;
  return Math.max(
    baseMs,
    BUBBLE_FADE_IN_MS + decryptMs + HOLD_VISIBLE_MS + 240,
  );
}

type Phase = { kind: "item"; index: number } | { kind: "done" };

type SlotAlign = "left" | "right";

/** Four stacked anchors per side (eight bubbles total, L/R from even/odd index). */
const TEASE_SIDE_BUBBLE_POSITIONS = [
  { x: 50, y: 12 },
  { x: 50, y: 34 },
  { x: 50, y: 56 },
  { x: 50, y: 78 },
] as const;

/** Always eight lines: random pick when `themeWords` has 8+; else cycle with hint. */
function buildEightTeaseLines(themeWords: string[], silhouetteHint: string): string[] {
  const words = themeWords.map((w) => w.trim()).filter(Boolean);
  const hint = silhouetteHint.trim();
  const base =
    hint.length > 0 ? [...words, hint] : words.length > 0 ? [...words] : ["—"];
  if (base.length >= TEASE_BUBBLE_COUNT) {
    return pickRandomTeasePhrases(base, TEASE_BUBBLE_COUNT);
  }
  const out: string[] = [];
  for (let i = 0; i < TEASE_BUBBLE_COUNT; i++)
    out.push(base[i % base.length]!);
  return out;
}

function titleTextAlign(slot: SlotAlign): React.CSSProperties["textAlign"] {
  return slot === "left" ? "right" : "left";
}

function KeywordSnapshotBlock({
  row,
  slot,
}: {
  row: KeywordCascadeRow;
  slot: SlotAlign;
}) {
  const ta = titleTextAlign(slot);
  const traitAlign: "left" | "right" = slot === "left" ? "right" : "left";
  const swatchJustify: "flex-end" | "flex-start" =
    slot === "left" ? "flex-end" : "flex-start";
  const traitFlexAlign = traitAlign === "right" ? "flex-end" : "flex-start";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: slot === "left" ? "flex-end" : "flex-start",
        textAlign: ta,
        gap: "0.55rem",
      }}
    >
      <div
        style={{
          ...KEYWORD_CASCADE_TITLE_STYLE,
          textAlign: ta,
          width: "100%",
        }}
      >
        {row.label}
      </div>
      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: slot === "left" ? "flex-end" : "flex-start",
          justifyContent: slot === "left" ? "flex-end" : "flex-start",
        }}
      >
        {row.traitLines && row.traitLines.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: traitFlexAlign,
              gap: "0.42rem",
              width: "100%",
            }}
          >
            {row.traitLines.map((trait, ti) => (
              <div
                key={`${trait}-${ti}`}
                className="font-google-sans-code"
                style={{
                  width: "100%",
                  fontSize: "clamp(0.95rem, 2.1vw, 1.35rem)",
                  fontWeight: 700,
                  color: "#ffffff",
                  lineHeight: 1.25,
                  wordBreak: "break-word",
                  textAlign: traitAlign,
                  textTransform: "lowercase",
                }}
              >
                {teaseDisplayLower(trait)}
              </div>
            ))}
          </div>
        ) : row.colorSwatches && row.colorSwatches.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: swatchJustify,
              alignItems: "center",
              gap: "0.5rem",
              width: "100%",
            }}
          >
            {row.colorSwatches.map((c, ci) => {
              const hex = resolvePegSwatchHex(c);
              const fill = hex ?? "#666";
              return (
              <span
                key={`${c}-${ci}`}
                title={c}
                style={{
                  display: "block",
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: fill,
                  boxShadow: hex
                    ? `0 0 12px ${hex}88`
                    : "inset 0 0 0 1px rgba(255,255,255,0.22)",
                }}
              />
              );
            })}
          </div>
        ) : (
          <div
            className="font-google-sans-code"
            style={{
              fontSize: "clamp(1.05rem, 2.6vw, 1.65rem)",
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.2,
              wordBreak: "normal",
              overflowWrap: "anywhere",
              width: "100%",
              textAlign: ta,
              textTransform: "lowercase",
            }}
          >
            {row.value.length > 0 ? teaseDisplayLower(row.value) : "—"}
          </div>
        )}
      </div>
    </div>
  );
}

function KeywordSnapshotRail({
  rows,
  slot,
}: {
  rows: KeywordCascadeRow[];
  slot: SlotAlign;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: SECTION_STACK_GAP,
        alignItems: slot === "left" ? "flex-end" : "flex-start",
        flex: "1 1 0",
        minWidth: 0,
        maxWidth: KEYWORD_RAIL_MAX,
        alignSelf: "center",
      }}
    >
      {rows.map((row, i) => (
        <React.Fragment key={`${row.label}-${i}`}>
          <KeywordSnapshotBlock row={row} slot={slot} />
        </React.Fragment>
      ))}
    </div>
  );
}

/** Softer than pure white; reads on dark particle overlay. */
const BUBBLE_FILL = "#e8e4de";
const BUBBLE_TEXT = "#1a1917";

function TeaseSpeechBubble({
  text,
  sizeMul,
}: {
  text: string;
  sizeMul: number;
}) {
  const halfW = 9;
  const height = 10;
  const overlapPx = 4;

  const [decryptReady, setDecryptReady] = useState(false);

  useEffect(() => {
    setDecryptReady(false);
    const t = window.setTimeout(() => setDecryptReady(true), BUBBLE_FADE_IN_MS);
    return () => window.clearTimeout(t);
  }, [text]);

  const fontSize = "clamp(0.85rem, 2vw, 1.1rem)";
  const displayText = teaseDisplayLower(text);

  const innerTypo: React.CSSProperties = {
    display: "inline-block",
    whiteSpace: "nowrap",
    fontSize,
    fontWeight: 700,
    color: BUBBLE_TEXT,
    lineHeight: 1.35,
    textAlign: "center",
    textTransform: "lowercase",
    transform: `scale(${sizeMul})`,
    transformOrigin: "center center",
  };

  return (
    <div
      style={{
        position: "relative",
        display: "inline-block",
        width: "max-content",
        maxWidth: "none",
        boxSizing: "border-box",
        background: BUBBLE_FILL,
        borderRadius: "clamp(4px, 0.9vmin, 7px)",
        padding: "clamp(8px, 1.6vmin, 12px) clamp(12px, 2.4vmin, 16px)",
        paddingBottom: "clamp(10px, 2vmin, 14px)",
        boxShadow:
          "0 6px 24px rgba(0,0,0,0.18), 0 1px 0 rgba(255,255,255,0.06) inset",
        transformOrigin: "center center",
        animation: `teaseBubbleIn ${BUBBLE_FADE_IN_MS}ms ease-in-out forwards`,
        opacity: 0,
      }}
    >
      {!decryptReady ? (
        <span
          className="font-google-sans-code"
          aria-hidden
          style={{
            ...innerTypo,
            visibility: "hidden",
          }}
        >
          {displayText}
        </span>
      ) : (
        <DecryptedText
          text={displayText}
          animateOn="view"
          sequential
          revealDirection="start"
          speed={TEASE_DECRYPT_SPEED_MS}
          useOriginalCharsOnly
          encryptedClassName="map-tease-crypt font-google-sans-code"
          className="font-google-sans-code"
          style={innerTypo}
          playTypingSound
        />
      )}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "100%",
          transform: "translateX(-50%)",
          marginTop: -overlapPx,
          width: 0,
          height: 0,
          borderStyle: "solid",
          borderWidth: `${height}px ${halfW}px 0 ${halfW}px`,
          borderColor: `${BUBBLE_FILL} transparent transparent transparent`,
        }}
      />
    </div>
  );
}

export default function CharacterTease({
  paletteColors: _paletteColors,
  themeWords,
  silhouetteHint,
  peekWords,
  onComplete: _onComplete,
  keywords,
  centerCanvas,
}: CharacterTeaseProps) {
  const figure = useOverlayFigureLayout();
  const canvasSize = particleCanvasSize(figure.R);

  const allItems = useMemo(() => {
    const usePeek =
      Array.isArray(peekWords) && peekWords.some((s) => s.trim().length > 0);
    if (usePeek) return buildEightTeaseLines(peekWords!, "");
    return buildEightTeaseLines(themeWords, silhouetteHint);
  }, [peekWords, themeWords, silhouetteHint]);

  const [phase, setPhase] = useState<Phase>(
    allItems.length > 0 ? { kind: "item", index: 0 } : { kind: "done" },
  );

  const teaseDoneNotifiedRef = useRef(false);
  useEffect(() => {
    if (phase.kind !== "done") {
      teaseDoneNotifiedRef.current = false;
      return;
    }
    if (teaseDoneNotifiedRef.current) return;
    teaseDoneNotifiedRef.current = true;
    _onComplete();
  }, [phase, _onComplete]);

  const wordTickMs = BUBBLE_FADE_IN_MS + HOLD_VISIBLE_MS;

  useEffect(() => {
    if (phase.kind === "done") return undefined;
    if (phase.kind !== "item") return undefined;

    const current = allItems[phase.index];
    if (current == null) return undefined;

    const holdMs = teaseItemHoldMs(current, wordTickMs);

    const t = window.setTimeout(() => {
      setPhase((prev) => {
        if (prev.kind !== "item") return prev;
        if (prev.index < allItems.length - 1) {
          return { kind: "item", index: prev.index + 1 };
        }
        return { kind: "done" };
      });
    }, holdMs);

    return () => window.clearTimeout(t);
  }, [phase, allItems, wordTickMs]);

  const visibleCount =
    phase.kind === "item" ? phase.index + 1 : allItems.length;

  const leftItems = allItems
    .slice(0, visibleCount)
    .filter((_, i) => i % 2 === 0);
  const rightItems = allItems
    .slice(0, visibleCount)
    .filter((_, i) => i % 2 === 1);

  const leftKeywordRows = keywords.slice(0, 3);
  const rightKeywordRows = keywords.slice(3, 5);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        pointerEvents: "none",
        padding: "clamp(16px, 3vmin, 40px) clamp(26px, 5.8vmin, 80px)",
        boxSizing: "border-box",
      }}
    >
      <style>{styles}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "nowrap",
          gap: ROW_GAP,
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          minHeight: canvasSize,
        }}
      >
        <div
          style={{
            position: "relative",
            flex: "1 1 0",
            minWidth: 0,
            maxWidth: TEASE_COL_MAX,
            alignSelf: "center",
            height: canvasSize,
            overflow: "visible",
          }}
        >
          {leftItems.map((w, bi) => {
            const pos =
              TEASE_SIDE_BUBBLE_POSITIONS[bi] ?? TEASE_SIDE_BUBBLE_POSITIONS[0];
            const globalIdx = bi * 2;
            return (
              <div
                key={`tl-${globalIdx}`}
                style={{
                  position: "absolute",
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: "translate(-50%, -50%)",
                  width: "max-content",
                  maxWidth: "none",
                }}
              >
                <TeaseSpeechBubble
                  text={w}
                  sizeMul={teaseBubbleSizeMul(globalIdx)}
                />
              </div>
            );
          })}
        </div>

        <KeywordSnapshotRail rows={leftKeywordRows} slot="left" />

        <div
          style={{
            width: canvasSize,
            height: canvasSize,
            flexShrink: 0,
          }}
        >
          {centerCanvas ?? null}
        </div>

        <KeywordSnapshotRail rows={rightKeywordRows} slot="right" />

        <div
          style={{
            position: "relative",
            flex: "1 1 0",
            minWidth: 0,
            maxWidth: TEASE_COL_MAX,
            alignSelf: "center",
            height: canvasSize,
            overflow: "visible",
          }}
        >
          {rightItems.map((w, bi) => {
            const pos =
              TEASE_SIDE_BUBBLE_POSITIONS[bi] ?? TEASE_SIDE_BUBBLE_POSITIONS[0];
            const globalIdx = bi * 2 + 1;
            return (
              <div
                key={`tr-${globalIdx}`}
                style={{
                  position: "absolute",
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: "translate(-50%, -50%)",
                  width: "max-content",
                  maxWidth: "none",
                }}
              >
                <TeaseSpeechBubble
                  text={w}
                  sizeMul={teaseBubbleSizeMul(globalIdx)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
