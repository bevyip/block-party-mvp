import React, { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { resolvePegSwatchHex } from "../../lib/pegSwatchColors";
import DecryptedText from "../DecryptedText";

export type KeywordCascadeRow = {
  label: string;
  value: string;
  /** When set, render color dots instead of value text (colors row). */
  colorSwatches?: string[];
  /**
   * When set (traits column), each entry is shown on its own row, revealed one
   * after another with the decrypt effect (ignores `value` for display).
   */
  traitLines?: string[];
};

export interface KeywordCascadeProps {
  keywords: KeywordCascadeRow[];
  onComplete: () => void;
  canvasSize: number;
  canvasNode: React.ReactNode;
}

/**
 * Pause after keywords mount so particles can gather into the sphere (~1.5s)
 * before the first title ("OBJECT IDENTIFIED") appears.
 */
const KEYWORD_CASCADE_START_DELAY_MS = 2000;

/** Time the header stays alone before the value / swatches phase begins. */
const TITLE_HOLD_MS = 1650;

/** Per-character interval for sequential decrypt (keep in sync with <DecryptedText speed={...} />). */
const DECRYPT_SPEED_MS = 74;

/** Extra time after decrypt estimate before the next column’s title appears. */
const AFTER_DECRYPT_PAD_MS = 1050;

/** Delay between revealing each color swatch (row, one-by-one). */
const SWATCH_STAGGER_MS = 540;

/** Extra time after the last swatch appears before the next keyword column. */
const SWATCH_TAIL_MS = 680;

const DONE_HOLD_MS = 1700;

/** Typography for the main keyword value under each label (matches `.font-google-sans-code`). */
export const KEYWORD_CASCADE_DESCRIPTION_STYLE: React.CSSProperties = {
  fontFamily: "'Roboto Mono', monospace",
  fontSize: "clamp(1.05rem, 2.6vw, 1.65rem)",
  fontWeight: 700,
  color: "#ffffff",
  lineHeight: 1.2,
  wordBreak: "normal",
  overflowWrap: "anywhere",
};

/** Small caps column headers (OBJECT IDENTIFIED, MOOD, …) — not monospace; matches body / overlay default. */
export const KEYWORD_CASCADE_TITLE_STYLE: React.CSSProperties = {
  fontSize: "0.58rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "#00ffe0",
  lineHeight: 1.35,
};

const layoutSpring = {
  type: "spring" as const,
  stiffness: 320,
  damping: 34,
  mass: 0.82,
};

function displayLower(s: string): string {
  return s.toLowerCase();
}

function traitLineDecryptWaitMs(trait: string): number {
  return Math.max(920, trait.length * DECRYPT_SPEED_MS + 520);
}

function traitsDescDurationMs(traits: string[]): number {
  return (
    traits.reduce((acc, t) => acc + traitLineDecryptWaitMs(t), 0) +
    Math.floor(AFTER_DECRYPT_PAD_MS * 0.35)
  );
}

function swatchesDescDurationMs(colors: string[]): number {
  const n = colors.length;
  if (n <= 0) {
    return 650;
  }
  return (
    Math.max(0, n - 1) * SWATCH_STAGGER_MS +
    SWATCH_TAIL_MS +
    Math.floor(AFTER_DECRYPT_PAD_MS * 0.3)
  );
}

/** Renders color dots in a horizontal row; each swatch appears after the previous. */
function ColorSwatchesRevealList({
  colors,
  alignItems = "center",
}: {
  colors: string[];
  /** Row `justify-content` (swatches hug inner edge on left/right columns). */
  alignItems?: "flex-start" | "flex-end" | "center";
}) {
  const colorsKey = useMemo(() => colors.join("\u0001"), [colors]);
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    setVisibleCount(1);
  }, [colorsKey]);

  useEffect(() => {
    if (visibleCount >= colors.length) {
      return undefined;
    }
    const id = window.setTimeout(
      () => setVisibleCount((c) => c + 1),
      SWATCH_STAGGER_MS,
    );
    return () => window.clearTimeout(id);
  }, [visibleCount, colors, colors.length]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: alignItems,
        alignItems: "center",
        gap: "0.5rem",
        width: "100%",
      }}
    >
      {colors.slice(0, visibleCount).map((c, i) => {
        const hex = resolvePegSwatchHex(c);
        const fill = hex ?? "#666";
        return (
        <motion.span
          key={`${c}-${i}`}
          layout
          title={c}
          initial={{ opacity: 0, scale: 0.4, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{
            layout: layoutSpring,
            opacity: { duration: 0.36, ease: [0.22, 1, 0.36, 1] },
            scale: { type: "spring", stiffness: 420, damping: 22 },
            y: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
          }}
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
  );
}

/** Renders traits in a vertical stack; each line mounts and decrypts after the previous finishes. */
function TraitsRevealList({
  traits,
  textAlign = "center",
}: {
  traits: string[];
  textAlign?: "left" | "right" | "center";
}) {
  const traitsKey = useMemo(() => traits.join("\u0001"), [traits]);
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    setVisibleCount(1);
  }, [traitsKey]);

  useEffect(() => {
    if (visibleCount >= traits.length) {
      return undefined;
    }
    const current = traits[visibleCount - 1];
    if (!current) {
      return undefined;
    }
    const wait = traitLineDecryptWaitMs(current);
    const id = window.setTimeout(() => setVisibleCount((c) => c + 1), wait);
    return () => window.clearTimeout(id);
  }, [visibleCount, traits, traits.length]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems:
          textAlign === "right"
            ? "flex-end"
            : textAlign === "left"
              ? "flex-start"
              : "center",
        justifyContent: "flex-start",
        gap: "0.42rem",
        width: "100%",
      }}
    >
      {traits.slice(0, visibleCount).map((trait, i) => (
        <div
          key={`${trait}-${i}`}
          style={{
            width: "100%",
            fontSize: "clamp(0.95rem, 2.1vw, 1.35rem)",
            fontWeight: 700,
            color: "#ffffff",
            lineHeight: 1.25,
            wordBreak: "break-word",
            textAlign,
            textTransform: "lowercase",
          }}
        >
          <DecryptedText
            key={`trait-dec-${i}-${trait}`}
            text={displayLower(trait)}
            animateOn="view"
            sequential
            revealDirection="start"
            speed={DECRYPT_SPEED_MS}
            encryptedClassName="opacity-40"
            useOriginalCharsOnly
            playTypingSound
          />
        </div>
      ))}
    </div>
  );
}

type CascadeState =
  | { kind: "delay" }
  | { kind: "title"; row: number }
  | { kind: "desc"; row: number }
  | { kind: "done" };

function descPhaseDurationMs(row: KeywordCascadeRow): number {
  if (row.colorSwatches && row.colorSwatches.length > 0) {
    return swatchesDescDurationMs(row.colorSwatches);
  }
  if (row.traitLines && row.traitLines.length > 0) {
    return traitsDescDurationMs(row.traitLines);
  }
  const t = row.value.length > 0 ? row.value : "—";
  return Math.max(1350, t.length * DECRYPT_SPEED_MS + AFTER_DECRYPT_PAD_MS);
}

type SlotAlign = "left" | "right";

/** Vertical gap between stacked keyword blocks (same on left and right). */
const SECTION_STACK_GAP = "clamp(28px, 4.5vh, 52px)";

export default function KeywordCascade({
  keywords,
  onComplete,
  canvasSize,
  canvasNode,
}: KeywordCascadeProps) {
  const total = keywords.length;

  const [state, setState] = useState<CascadeState>(() =>
    total === 0 ? { kind: "done" } : { kind: "delay" },
  );

  useEffect(() => {
    if (total === 0) {
      setState({ kind: "done" });
      return;
    }
    setState({ kind: "delay" });
  }, [keywords, total]);

  useEffect(() => {
    if (total === 0) {
      const id = window.setTimeout(() => onComplete(), 0);
      return () => window.clearTimeout(id);
    }

    if (state.kind === "done") {
      const id = window.setTimeout(() => onComplete(), DONE_HOLD_MS);
      return () => window.clearTimeout(id);
    }

    if (state.kind === "delay") {
      const id = window.setTimeout(() => {
        setState({ kind: "title", row: 0 });
      }, KEYWORD_CASCADE_START_DELAY_MS);
      return () => window.clearTimeout(id);
    }

    if (state.kind === "title") {
      const id = window.setTimeout(() => {
        setState({ kind: "desc", row: state.row });
      }, TITLE_HOLD_MS);
      return () => window.clearTimeout(id);
    }

    const row = keywords[state.row];
    if (!row) {
      setState({ kind: "done" });
      return undefined;
    }

    const wait = descPhaseDurationMs(row);
    const id = window.setTimeout(() => {
      if (state.row >= total - 1) {
        setState({ kind: "done" });
      } else {
        setState({ kind: "title", row: state.row + 1 });
      }
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, total, keywords, onComplete]);

  const titleTextAlign = (slot: SlotAlign): React.CSSProperties["textAlign"] =>
    slot === "left" ? "right" : "left";

  const columnLayout = (
    row: KeywordCascadeRow | undefined,
    colIndex: number,
    slot: SlotAlign,
  ) => {
    if (!row) return null;

    const isDone =
      state.kind === "done" ||
      ((state.kind === "title" || state.kind === "desc") &&
        colIndex < state.row);
    const isCurrent =
      (state.kind === "title" || state.kind === "desc") &&
      state.row === colIndex;
    if (!isDone && !isCurrent) {
      return null;
    }

    const showTitle = true;
    const showDesc = isDone || (isCurrent && state.kind === "desc");

    const enteringTitle =
      state.kind !== "done" && state.kind === "title" && state.row === colIndex;

    const ta = titleTextAlign(slot);
    const swatchAlign: "flex-start" | "flex-end" | "center" =
      slot === "left" ? "flex-end" : slot === "right" ? "flex-start" : "center";
    const traitAlign: "left" | "right" | "center" =
      slot === "left" ? "right" : slot === "right" ? "left" : "center";

    return (
      <motion.div
        key={`${row.label}-${colIndex}`}
        layout
        initial={
          enteringTitle
            ? { opacity: 0, scale: 0.92, filter: "blur(4px)" }
            : false
        }
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        transition={{
          layout: layoutSpring,
          opacity: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
          scale: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
          filter: { duration: 0.38 },
        }}
        style={{
          width: "100%",
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: slot === "left" ? "flex-end" : "flex-start",
          textAlign: ta,
          gap: "0.55rem",
          zIndex: 2,
        }}
      >
        {showTitle && (
          <div
            style={{
              ...KEYWORD_CASCADE_TITLE_STYLE,
              textAlign: ta,
              width: "100%",
            }}
          >
            {row.label}
          </div>
        )}
        {showDesc && (
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: slot === "left" ? "flex-end" : "flex-start",
              justifyContent: slot === "left" ? "flex-end" : "flex-start",
            }}
          >
            {row.traitLines && row.traitLines.length > 0 ? (
              <TraitsRevealList
                traits={row.traitLines}
                textAlign={traitAlign}
              />
            ) : row.colorSwatches && row.colorSwatches.length > 0 ? (
              <ColorSwatchesRevealList
                colors={row.colorSwatches}
                alignItems={swatchAlign}
              />
            ) : (
              <div
                style={{
                  ...KEYWORD_CASCADE_DESCRIPTION_STYLE,
                  width: "100%",
                  textAlign: ta,
                  textTransform: "lowercase",
                }}
              >
                <DecryptedText
                  key={`${row.label}-${colIndex}-${row.value}-dec`}
                  text={
                    row.value.length > 0 ? displayLower(row.value) : "—"
                  }
                  animateOn="view"
                  sequential
                  revealDirection="start"
                  speed={DECRYPT_SPEED_MS}
                  encryptedClassName="opacity-40"
                  useOriginalCharsOnly
                  playTypingSound
                />
              </div>
            )}
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "nowrap",
        gap: "clamp(8px, 1.8vw, 28px)",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: SECTION_STACK_GAP,
          alignItems: "flex-end",
          flex: "1 1 0",
          minWidth: 0,
          maxWidth: "clamp(88px, 22vw, 240px)",
        }}
      >
        {columnLayout(keywords[0], 0, "left")}
        {columnLayout(keywords[1], 1, "left")}
        {columnLayout(keywords[2], 2, "left")}
      </div>

      <div
        style={{
          width: canvasSize,
          height: canvasSize,
          flexShrink: 0,
        }}
      >
        {canvasNode}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: SECTION_STACK_GAP,
          alignItems: "flex-start",
          flex: "1 1 0",
          minWidth: 0,
          maxWidth: "clamp(88px, 22vw, 240px)",
        }}
      >
        {columnLayout(keywords[3], 3, "right")}
        {columnLayout(keywords[4], 4, "right")}
      </div>
    </div>
  );
}
