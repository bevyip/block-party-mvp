import React, { useEffect, useRef, useState } from "react";
import { setSpritePartyOverlayActive } from "../utils/audio.js";

type AddToPartyOverlayProps = {
  stage3aUrl: string;
  onComplete: () => void;
  /** Close overlay and unblock map if portrait prep fails (no save). */
  onAbort?: () => void;
};

export const WELCOME_LINES = [
  "Welcome to the neighborhood.",
  "A new face on the block.",
  "Someone new just moved in.",
] as const;

const CELL_DISPLAY = 256;
const FRONT_STRIP_COL = 0;

// Sequence: overlay fade-in → hero intro → settle → hold → exit (shrink + fades). onComplete at end of EXIT_SHRINK_MS.
/** Brief beat after mount so dimmer can start before hero copy (post–particle handoff). */
const OVERLAY_VISIBLE_DELAY_MS = 140;
/** Fullscreen dimmer eases in first. */
const BACKDROP_FADE_IN_MS = 720;
/** Sprite + welcome line share one gentle opacity rise. */
const CONTENT_FADE_IN_MS = 1100;
const HERO_INTRO_MS = 3800;
const HERO_SETTLE_PAUSE_MS = 160;
const CONTENT_READY_BEFORE_EXIT_MS =
  OVERLAY_VISIBLE_DELAY_MS + HERO_INTRO_MS + HERO_SETTLE_PAUSE_MS;
const HOLD_AFTER_MS = 260;
const EXIT_SHRINK_MS = 1900;
const WELCOME_LINE_EXIT_FADE_MS = 1000;
const SHRINK_FINAL_SCALE = 0.26;

function toImageSrc(src: string): string {
  const s = src.trim();
  if (
    s.startsWith("data:") ||
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("blob:") ||
    s.startsWith("/") ||
    s.startsWith("./") ||
    s.startsWith("../")
  ) {
    return s;
  }
  return `data:image/png;base64,${s}`;
}

/**
 * 4-across horizontal strip (typical Stage 3A) → first cell (front);
 * otherwise scale full image into the hero square (nearest-neighbor).
 * `minWideAspect`: treat as 4×1 strip when width/height ≥ this (API strips are ~4:1).
 */
function imageToFrontPartyCell(
  stripDataUrl: string,
  minWideAspect = 1.85,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const finish = () => {
      try {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        console.log("[partyOverlay] finish", { nw, nh, aspect: nw / nh });
        if (nw < 1 || nh < 1) {
          resolve(null);
          return;
        }
        const c = document.createElement("canvas");
        c.width = CELL_DISPLAY;
        c.height = CELL_DISPLAY;
        const ctx = c.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.imageSmoothingEnabled = false;
        const aspect = nw / nh;
        const useStripCell = aspect >= minWideAspect;
        if (useStripCell) {
          const cellW = nw / 4;
          const col = FRONT_STRIP_COL;
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
        } else {
          ctx.drawImage(img, 0, 0, nw, nh, 0, 0, CELL_DISPLAY, CELL_DISPLAY);
        }
        const result = c.toDataURL("image/png");
        console.log("[partyOverlay] toDataURL ok", result.slice(0, 40));
        resolve(result);
      } catch (e) {
        console.error("[partyOverlay] finish threw", e);
        resolve(null);
      }
    };
    img.onload = () => {
      if (typeof img.decode === "function") {
        img.decode().then(finish).catch(finish);
      } else {
        finish();
      }
    };
    img.onerror = () => {
      console.error("[partyOverlay] img.onerror", stripDataUrl.slice(0, 60));
      resolve(null);
    };
    img.src = stripDataUrl;
  });
}

export function AddToPartyOverlay({
  stage3aUrl,
  onComplete,
  onAbort,
}: AddToPartyOverlayProps) {
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  /** Image decode / matting failed even after fallback — show message instead of hanging. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [welcomeLine, setWelcomeLine] = useState<string | null>(null);
  const [dimmerIn, setDimmerIn] = useState(false);

  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onAbortRef = useRef(onAbort);
  onAbortRef.current = onAbort;
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setSpritePartyOverlayActive(true);
    return () => setSpritePartyOverlayActive(false);
  }, []);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setDimmerIn(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  function after(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }

  useEffect(() => {
    let cancelled = false;
    setFrontUrl(null);
    setLoadFailed(false);
    setVisible(false);
    setExiting(false);
    setWelcomeLine(null);
    doneRef.current = false;

    const src = toImageSrc(stage3aUrl);

    void (async () => {
      console.log(
        "[partyOverlay] stage3aUrl received",
        stage3aUrl.slice(0, 60),
      );
      const cell = await imageToFrontPartyCell(src);
      console.log(
        "[partyOverlay] cell result",
        cell ? cell.slice(0, 40) : null,
      );
      if (cancelled) return;
      if (cell) {
        setFrontUrl(cell);
        setWelcomeLine(
          WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)] ??
            null,
        );
      } else {
        setLoadFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stage3aUrl]);

  useEffect(() => {
    if (!frontUrl) return;

    after(() => setVisible(true), OVERLAY_VISIBLE_DELAY_MS);

    const exitStart = CONTENT_READY_BEFORE_EXIT_MS + HOLD_AFTER_MS;
    after(() => setExiting(true), exitStart);

    after(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onCompleteRef.current();
      }
    }, exitStart + EXIT_SHRINK_MS);

    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, [frontUrl]);

  useEffect(() => {
    if (!loadFailed) return undefined;
    const id = window.setTimeout(() => {
      onAbortRef.current?.();
    }, 3000);
    return () => window.clearTimeout(id);
  }, [loadFailed]);

  const overlayOpacity = exiting ? 1 : visible ? 1 : 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        pointerEvents: "none",
        opacity: 1,
      }}
      aria-busy={!frontUrl && !loadFailed}
      aria-hidden={!frontUrl && !loadFailed}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#000",
          opacity: dimmerIn ? 0.95 : 0,
          transition: `opacity ${BACKDROP_FADE_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      />

      {!frontUrl && !loadFailed ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 15,
              letterSpacing: "0.04em",
              color: "rgba(255,255,255,0.5)",
              textAlign: "center",
              opacity: dimmerIn ? 1 : 0,
              transition: `opacity ${Math.min(520, BACKDROP_FADE_IN_MS)}ms ease-out`,
            }}
          >
            Preparing your portrait…
          </p>
        </div>
      ) : null}

      {loadFailed ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            gap: 20,
          }}
        >
          <p
            style={{
              margin: 0,
              maxWidth: 360,
              fontSize: 14,
              lineHeight: 1.5,
              color: "rgba(255,200,200,0.85)",
              textAlign: "center",
            }}
          >
            {"Couldn't load the character preview. Try "}
            <strong>Add to Party</strong> again from the panel, or refresh the
            page.
          </p>
          {onAbort ? (
            <button
              type="button"
              onClick={() => onAbortRef.current?.()}
              style={{
                pointerEvents: "auto",
                cursor: "pointer",
                padding: "10px 20px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.35)",
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.92)",
              }}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      {frontUrl ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: overlayOpacity,
            transition: exiting
              ? "none"
              : visible
                ? `opacity ${CONTENT_FADE_IN_MS}ms cubic-bezier(0.25, 0.1, 0.25, 1)`
                : "none",
            animation: exiting
              ? `overlayExitFade ${EXIT_SHRINK_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards`
              : "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                animation: exiting
                  ? `spriteRowExitShrink ${EXIT_SHRINK_MS}ms cubic-bezier(0.33, 0.08, 0.2, 1) forwards`
                  : "none",
                transformOrigin: "center center",
              }}
            >
              <div
                style={{
                  width: `${CELL_DISPLAY}px`,
                  height: `${CELL_DISPLAY}px`,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  animation: exiting
                    ? "none"
                    : `partyHeroIntro ${HERO_INTRO_MS}ms cubic-bezier(0.04, 0.88, 0.1, 1) ${OVERLAY_VISIBLE_DELAY_MS}ms both forwards`,
                }}
              >
                <img
                  src={frontUrl}
                  alt="Front"
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
            </div>
            {welcomeLine ? (
              <p
                className="mt-16 mx-6 max-w-xl text-center text-xl font-normal italic tracking-wider text-white"
                style={{
                  animation: exiting
                    ? `welcomeLineExitFade ${WELCOME_LINE_EXIT_FADE_MS}ms cubic-bezier(0.33, 0.1, 0.55, 1) forwards`
                    : "none",
                }}
              >
                {welcomeLine}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <style>{`
        @keyframes partyHeroIntro {
          0% {
            transform: scale(0.9);
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes welcomeLineExitFade {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }
        @keyframes spriteRowExitShrink {
          0% {
            transform: scale(1);
          }
          100% {
            transform: scale(${SHRINK_FINAL_SCALE});
          }
        }
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
