import React, { useEffect, useRef, useState } from "react";
import { removeBackground } from "../lib/removeBackground";
import { setSpritePartyOverlayActive } from "../utils/audio.js";

type AddToPartyOverlayProps = {
  /** Stage 3A PNG — data URL or bare base64. */
  stage3aUrl: string;
  onComplete: () => void;
};

/** Random welcome line under the four direction previews. */
export const WELCOME_LINES = [
  "Welcome to the neighborhood.",
  "A new face on the block.",
  "Someone new just moved in.",
] as const;

// Each 64×64 Stage 3A frame scaled up with nearest-neighbor to this size
const CELL_DISPLAY = 256;

// Gap between sprites in the row
const GAP = 24;

/**
 * Bounce timeline (all delays are ms from the sequence effect start, same clock as `after()`).
 *
 */
const BOUNCE_STAGGER_MS = 700;
const BOUNCE_DURATION_MS = 1200;

/** Pause after intro fade-in; bounce schedule counts from here */
const SEQUENCE_START_MS = 550;
/** Extra wait after SEQUENCE_START_MS before the first bounce starts */
const FIRST_BOUNCE_DELAY_MS = 420;

// After last bounce: hold, then one smooth shrink + overlay fade (no pause mid-scale)
const HOLD_AFTER_MS = 1500;
/** Single continuous scale animation 1 → SHRINK_FINAL_SCALE; fade overlaps the tail */
const EXIT_SHRINK_MS = 2400;
const SHRINK_FINAL_SCALE = 0.26;

/**
 * Client Stage 3A PNG is post-`swapStage3ALeftRightColumns` (handlers.cjs):
 * strip columns 0–3 = DOWN, RIGHT, LEFT, UP.
 * Row display: Front, Left, Right, Back → cols 0, 2, 1, 3.
 */
const DISPLAY_FRAMES = [
  { key: "down", col: 0, label: "Front" },
  { key: "left", col: 2, label: "Left" },
  { key: "right", col: 1, label: "Right" },
  { key: "up", col: 3, label: "Back" },
] as const;

const TOTAL_FRAMES = DISPLAY_FRAMES.length;

/** Offset from SEQUENCE_START_MS until the last bounce animation has finished */
const ALL_BOUNCES_DONE_MS =
  FIRST_BOUNCE_DELAY_MS +
  (TOTAL_FRAMES - 1) * BOUNCE_STAGGER_MS +
  BOUNCE_DURATION_MS;

function toImageSrc(src: string): string {
  return src.startsWith("data:") ? src : `data:image/png;base64,${src}`;
}

/** Cut the horizontal strip into 4 separate PNG data URLs (nearest-neighbor scale). */
function sliceStage3AStripToCells(stripDataUrl: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (nw < 4 || nh < 1) {
        resolve([]);
        return;
      }
      const cellW = nw / 4;
      const urls: string[] = [];
      for (let col = 0; col < 4; col++) {
        const c = document.createElement("canvas");
        c.width = CELL_DISPLAY;
        c.height = CELL_DISPLAY;
        const ctx = c.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          img,
          col * cellW,
          0,
          cellW,
          nh,
          0,
          0,
          CELL_DISPLAY,
          CELL_DISPLAY,
        );
        urls.push(c.toDataURL("image/png"));
      }
      resolve(urls);
    };
    img.onerror = () => resolve([]);
    img.src = stripDataUrl;
  });
}

export function AddToPartyOverlay({
  stage3aUrl,
  onComplete,
}: AddToPartyOverlayProps) {
  const [cellUrls, setCellUrls] = useState<string[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [bouncingIndex, setBouncingIndex] = useState(-1);
  const [welcomeLine, setWelcomeLine] = useState<string | null>(null);

  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const loadingSoundRef = useRef<HTMLAudioElement | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setSpritePartyOverlayActive(true);
    return () => setSpritePartyOverlayActive(false);
  }, []);

  function after(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }

  // Strip → same border flood-fill BG removal as pipeline/SidePanel (black + white) → 4 cells
  useEffect(() => {
    let cancelled = false;
    setCellUrls(null);
    setVisible(false);
    setExiting(false);
    setBouncingIndex(-1);
    setWelcomeLine(null);
    doneRef.current = false;

    removeBackground(toImageSrc(stage3aUrl))
      .then((strip) => {
        if (cancelled) return Promise.resolve(null);
        return sliceStage3AStripToCells(strip);
      })
      .then((urls) => {
        if (cancelled || !urls || urls.length !== 4) return;
        setCellUrls(urls);
        setWelcomeLine(
          WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)] ??
            null,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [stage3aUrl]);

  // Ambient loading sound while the overlay is on screen
  useEffect(() => {
    if (!cellUrls) return;
    const audio = new Audio("/sounds/sprite-loading.mp3");
    audio.loop = true;
    audio.volume = 0.42;
    loadingSoundRef.current = audio;
    void audio.play().catch(() => {});
    return () => {
      audio.pause();
      if (loadingSoundRef.current === audio) loadingSoundRef.current = null;
    };
  }, [cellUrls]);

  useEffect(() => {
    if (!cellUrls) return;

    after(() => setVisible(true), 50);

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const idx = i;
      after(
        () => setBouncingIndex(idx),
        SEQUENCE_START_MS + FIRST_BOUNCE_DELAY_MS + idx * BOUNCE_STAGGER_MS,
      );
    }

    after(() => setBouncingIndex(-1), SEQUENCE_START_MS + ALL_BOUNCES_DONE_MS);

    const exitStart = SEQUENCE_START_MS + ALL_BOUNCES_DONE_MS + HOLD_AFTER_MS;
    after(() => setExiting(true), exitStart);

    after(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        const snd = loadingSoundRef.current;
        if (snd) {
          snd.pause();
          snd.currentTime = 0;
          loadingSoundRef.current = null;
        }
        onCompleteRef.current();
      }
    }, exitStart + EXIT_SHRINK_MS);

    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, [cellUrls]);

  if (!cellUrls) return null;

  const overlayOpacity = exiting ? 1 : visible ? 1 : 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: overlayOpacity,
        transition: exiting
          ? "none"
          : visible
            ? "opacity 400ms ease-out"
            : "none",
        animation: exiting
          ? `overlayExitFade ${EXIT_SHRINK_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`
          : "none",
      }}
      aria-hidden
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#000",
          opacity: 0.95,
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          animation: exiting
            ? `spriteRowExitShrink ${EXIT_SHRINK_MS}ms cubic-bezier(0.33, 0.08, 0.2, 1) forwards`
            : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "nowrap",
            alignItems: "center",
            justifyContent: "center",
            gap: `${GAP}px`,
          }}
        >
          {DISPLAY_FRAMES.map((frame, i) => {
            const isBouncing = bouncingIndex === i;
            const src = cellUrls[frame.col]!;

            return (
              <div
                key={frame.key}
                style={{
                  position: "relative",
                  width: `${CELL_DISPLAY}px`,
                  height: `${CELL_DISPLAY}px`,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  animation: isBouncing
                    ? `spriteBounceSingle ${BOUNCE_DURATION_MS}ms cubic-bezier(0.33, 0.0, 0.2, 1) forwards`
                    : "none",
                }}
              >
                <img
                  src={src}
                  alt={frame.label}
                  draggable={false}
                  width={CELL_DISPLAY}
                  height={CELL_DISPLAY}
                  style={{
                    width: `${CELL_DISPLAY}px`,
                    height: `${CELL_DISPLAY}px`,
                    imageRendering: "pixelated",
                    userSelect: "none",
                    display: "block",
                  }}
                />
              </div>
            );
          })}
        </div>
        {welcomeLine && (
          <p className="mt-20 mx-6 max-w-xl text-center text-xl font-normal italic tracking-wider text-white">
            {welcomeLine}
          </p>
        )}
      </div>

      <style>{`
        /* Single arc — no secondary rebound */
        @keyframes spriteBounceSingle {
          0%   { transform: translateY(0); }
          42%  { transform: translateY(-44px); }
          100% { transform: translateY(0); }
        }
        /* One continuous scale — no stop at 0.5 */
        @keyframes spriteRowExitShrink {
          0%   { transform: scale(1); }
          100% { transform: scale(${SHRINK_FINAL_SCALE}); }
        }
        /* Stay opaque until ~2/3 through shrink, then fade (scale keeps easing) */
        @keyframes overlayExitFade {
          0%,
          62% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

export default AddToPartyOverlay;
