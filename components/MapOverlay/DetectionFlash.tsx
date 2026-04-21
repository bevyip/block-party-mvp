import React, { useCallback, useEffect, useRef, useState } from "react";
import DecryptedText from "../DecryptedText";
import {
  playTranslationAlertSfx,
  startTranslationDetectingSfx,
  stopTranslationDetectingSfx,
} from "../../utils/audio";

export interface DetectionFlashProps {
  /** Fires once the subtitle `DecryptedText` sequential animation has fully finished. */
  onTranslationDecryptComplete: () => void;
}

/** Total scan line animation window before title (slower sweep = easier to read). */
const SCAN_BOUNCE_MS = 4000;
const TITLE_ANIM_S = 2.4;
const SUB_AFTER_TITLE_S = 1.1;
const SUB_DUR_S = 0.85;

const TRANSLATION_SEQUENCE_LINE = "Initializing translation sequence...";

/** Same moment the subtitle CSS animation begins (title delay + pause). */
const SUBTITLE_REVEAL_DELAY_MS = SCAN_BOUNCE_MS + SUB_AFTER_TITLE_S * 1000;

/** One stroke top → bottom; `alternate` × 3 = down + up + down (1.5 round-trips), same timing each way. */
const SCAN_STROKE_ITERATIONS = 3;
const scanStrokeDurationS = SCAN_BOUNCE_MS / 1000 / SCAN_STROKE_ITERATIONS;

const styles = `
@keyframes mapOverlayScanStroke {
  0% { transform: translateY(-12%); opacity: 0.85; }
  100% { transform: translateY(110vh); opacity: 0.35; }
}
@keyframes mapOverlayTitle {
  0%, 18% { opacity: 0; color: #ffffff; text-shadow: none; transform: translateY(4px); }
  22% { opacity: 1; color: #ffffff; transform: translateY(0); }
  28% { opacity: 0.15; }
  34% { opacity: 1; }
  40% { opacity: 0.3; }
  46%, 100% { opacity: 1; color: #ffffff; text-shadow: none; }
}
@keyframes mapOverlaySub {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

export default function DetectionFlash({
  onTranslationDecryptComplete,
}: DetectionFlashProps) {
  const [subtitleReady, setSubtitleReady] = useState(false);
  const handoffSentRef = useRef(false);

  useEffect(() => {
    startTranslationDetectingSfx();
    const stopScanId = window.setTimeout(
      () => stopTranslationDetectingSfx(),
      SCAN_BOUNCE_MS,
    );
    const alertId = window.setTimeout(() => {
      playTranslationAlertSfx();
    }, SCAN_BOUNCE_MS);
    const subtitleId = window.setTimeout(
      () => setSubtitleReady(true),
      SUBTITLE_REVEAL_DELAY_MS,
    );
    return () => {
      window.clearTimeout(stopScanId);
      window.clearTimeout(alertId);
      window.clearTimeout(subtitleId);
      stopTranslationDetectingSfx();
    };
  }, []);

  const onSubtitleDecryptComplete = useCallback(() => {
    if (handoffSentRef.current) return;
    handoffSentRef.current = true;
    onTranslationDecryptComplete();
  }, [onTranslationDecryptComplete]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 9999,
        background: "#0a0a0f",
        overflow: "hidden",
      }}
    >
      <style>{styles}</style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 3,
          background:
            "linear-gradient(180deg, transparent, rgba(0, 255, 224, 0.95), transparent)",
          boxShadow:
            "0 0 20px rgba(0, 255, 224, 0.65), 0 0 48px rgba(0, 255, 224, 0.28)",
          animation: `mapOverlayScanStroke ${scanStrokeDurationS}s linear ${SCAN_STROKE_ITERATIONS} alternate forwards`,
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
          textAlign: "center",
          padding: "0 24px",
        }}
      >
        <p
          className="font-google-sans-code text-2xl font-bold tracking-tight text-white uppercase"
          style={{
            margin: 0,
            animation: `mapOverlayTitle ${TITLE_ANIM_S}s ease forwards`,
            animationDelay: `${SCAN_BOUNCE_MS / 1000}s`,
            animationFillMode: "both",
          }}
        >
          NEW INPUT DETECTED
        </p>
        <p
          className="font-google-sans-code mt-2 max-w-2xl text-sm text-neutral-400"
          style={{
            opacity: 0,
            animation: `mapOverlaySub ${SUB_DUR_S}s ease ${
              SCAN_BOUNCE_MS / 1000 + SUB_AFTER_TITLE_S
            }s forwards`,
          }}
        >
          {subtitleReady ? (
            <DecryptedText
              text={TRANSLATION_SEQUENCE_LINE}
              animateOn="view"
              sequential
              revealDirection="start"
              speed={42}
              parentClassName="text-neutral-400"
              className="text-neutral-300"
              encryptedClassName="text-neutral-600 opacity-90"
              useOriginalCharsOnly
              playTypingSound
              onDecryptComplete={onSubtitleDecryptComplete}
            />
          ) : (
            <span aria-hidden className="invisible">
              {TRANSLATION_SEQUENCE_LINE}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
