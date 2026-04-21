import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  broadcast,
  useMapChannel,
  type PipelineStage,
} from "../../hooks/usePipelineChannel";
import {
  ADD_TO_PARTY_PREFACE_MS,
  ADD_TO_PARTY_SPLAY_MS,
} from "../../constants";
import ParticleCanvas from "./ParticleCanvas";
import { resetParticlePulse } from "./particlePulse";
import DetectionFlash from "./DetectionFlash";
import KeywordCascade, {
  KEYWORD_CASCADE_DESCRIPTION_STYLE,
  type KeywordCascadeRow,
} from "./KeywordCascade";
import CharacterTease from "./CharacterTease";
import ChamberReveal from "./ChamberReveal";
import { AddToPartyOverlay } from "../AddToPartyOverlay";
import {
  OVERLAY_PARTICLE_CANVAS_BG,
  particleCanvasSize,
  useOverlayFigureLayout,
} from "./figureLayout";
import {
  setMapTranslationBgmDucked,
  setPipelineDetectionMapAudioSuppressed,
} from "../../utils/audio";

export { default as DecryptedText } from "../DecryptedText";
export type {
  DecryptedTextOwnProps,
  DecryptedTextProps,
} from "../DecryptedText";

type OverlayPhase =
  | "hidden"
  | "detection"
  | "keywords"
  | "tease"
  | "crystallizing"
  | "chamber_reveal"
  | "complete";

type Stage1Payload = Extract<
  PipelineStage,
  { stage: "stage1_complete" }
>["payload"];
type Stage2Payload = Extract<
  PipelineStage,
  { stage: "stage2_complete" }
>["payload"];

const SPIRIT_LINES = [
  "Spirit forming...",
  "Weaving the essence...",
  "Almost here...",
  "Taking shape...",
  "Preparing your character...",
];

/** After last tease bubble: hold, then fade all tease text before crystallizing. */
const TEASE_POST_BUBBLES_PAUSE_MS = 1000;
const TEASE_TEXT_FADE_OUT_MS = 750;

/**
 * If `stage3b_started` arrives while the map is still in detection / keywords /
 * tease, we queue the chamber transition until crystallizing is shown, then hold
 * this long so the crystallization beat is visible (pipeline tab can outpace the map).
 */
const QUEUED_STAGE3B_CRYSTALLIZING_HOLD_MS = 3000;

/** Crossfade when leaving crystallizing spirit line for chamber circles (ms). */
const CRYSTALLIZING_TO_CHAMBER_FADE_MS = 550;

/** After the third chamber fills, hold before Roman labels + rings ease out. */
const CHAMBER_FILLED_HOLD_MS = 480;
/** Subtle fade of the three-chamber chrome before / while particles splay outward. */
const CHAMBER_CHROME_FADE_OUT_MS = 720;

const hbStyles = `
@keyframes mapHeartbeatPulse {
  0% { opacity: 0; }
  33.333% { opacity: 1; }
  100% { opacity: 0; }
}
`;

function buildKeywordRows(p: Stage1Payload | null): KeywordCascadeRow[] {
  if (!p) {
    return [
      { label: "OBJECT IDENTIFIED", value: "—" },
      { label: "MOOD", value: "—" },
      { label: "SYMBOL", value: "—" },
      { label: "TRAITS", value: "", traitLines: ["—"] },
      { label: "COLORS IDENTIFIED", value: "", colorSwatches: [] },
    ];
  }
  return [
    { label: "OBJECT IDENTIFIED", value: p.object },
    { label: "MOOD", value: p.mood },
    { label: "SYMBOL", value: p.emoji },
    {
      label: "TRAITS",
      value: "",
      traitLines: p.traits.length > 0 ? p.traits : ["—"],
    },
    { label: "COLORS IDENTIFIED", value: "", colorSwatches: p.colors },
  ];
}

type MapOverlayProps = {
  /**
   * `/map` only: this instance schedules `add_to_party_splay` after the third chamber
   * (on `/`, SidePanel broadcasts that). Particle splay + `add_to_party_splay_complete`
   * run on every route when `add_to_party_splay` fires.
   */
  ownsHandoff?: boolean;
  /**
   * Map page: reload manifest / inject new sprite after map-only Add-to-Party completes.
   * BroadcastChannel does not echo to the same document, so call this in addition to `sprite_sent`.
   */
  onSpriteAdded?: () => void | Promise<void>;
};

export default function MapOverlay({
  ownsHandoff = false,
  onSpriteAdded,
}: MapOverlayProps) {
  const [overlayPhase, setOverlayPhase] = useState<OverlayPhase>("hidden");
  /**
   * Map sprite loop runs in rAF and can tick before passive effects flush. Updating
   * `setPipelineDetectionMapAudioSuppressed` here (sync with the state update) keeps
   * boops/eating off for the whole translation sequence without a one-frame leak.
   */
  const goToOverlayPhase = useCallback((next: OverlayPhase) => {
    const translationVisible = next !== "hidden";
    setPipelineDetectionMapAudioSuppressed(translationVisible);
    setMapTranslationBgmDucked(translationVisible);
    setOverlayPhase(next);
  }, []);
  const overlayPhaseRef = useRef<OverlayPhase>("hidden");
  useEffect(() => {
    overlayPhaseRef.current = overlayPhase;
  }, [overlayPhase]);

  const stage1Ref = useRef<Stage1Payload | null>(null);
  const stage2Ref = useRef<Stage2Payload | null>(null);
  /** Bump only on stage1 so `KeywordCascade` does not reset when stage2 arrives during a keyword hold. */
  const [stage1DataTick, setStage1DataTick] = useState(0);
  /** Keyword cascade has finished (including colors row); may wait here for `stage2_complete` before tease. */
  const keywordsReadyForTeaseRef = useRef(false);

  const [teaseLeaving, setTeaseLeaving] = useState(false);
  /** After all speech bubbles: pause → fade tease copy out → then crystallizing. */
  type TeaseEndSeq = null | "pause" | "fading";
  const [teaseEndSeq, setTeaseEndSeq] = useState<TeaseEndSeq>(null);
  const teaseEndSeqRef = useRef<TeaseEndSeq>(null);
  useEffect(() => {
    teaseEndSeqRef.current = teaseEndSeq;
  }, [teaseEndSeq]);

  const [chambersComplete, setChambersComplete] = useState(0);
  /** Roman numerals + rings fade after all three chambers fill. */
  const [chamberFilledChromeLeaving, setChamberFilledChromeLeaving] =
    useState(false);
  /** Same canvas as the humanoid: outward burst, then blank until overlay completes. */
  const [handoffSplayExitActive, setHandoffSplayExitActive] = useState(false);
  /**
   * Particle splay when this instance did not schedule the `/map` chamber handoff
   * (e.g. SidePanel on `/` broadcast `add_to_party_splay`). On non-`/map` routes the
   * splay-complete timer runs so SidePanel can open the overlay.
   */
  const [localSplayActive, setLocalSplayActive] = useState(false);
  /**
   * True only for the `add_to_party_splay` this instance is about to emit after the third chamber
   * (`/map`). Used so a `/` SidePanel splay does not start the handoff timer on `/map` (double
   * `add_to_party_splay_complete`).
   */
  const ownChamberSplayPendingRef = useRef(false);
  const [heartbeatActive, setHeartbeatActive] = useState(false);
  const [showAddToPartyOverlay, setShowAddToPartyOverlay] = useState(false);
  const [addToPartyStage3aUrl, setAddToPartyStage3aUrl] = useState<
    string | null
  >(null);
  const stage3aUrlRef = useRef<string | null>(null);
  const [spiritLine, setSpiritLine] = useState(0);
  const [spiritOpaque, setSpiritOpaque] = useState(false);
  const spiritLineRef = useRef(0);
  spiritLineRef.current = spiritLine;

  /** Snapshot spirit copy that fades out when entering chamber_reveal from crystallizing. */
  const [spiritExitText, setSpiritExitText] = useState<string | null>(null);
  const [spiritExitFading, setSpiritExitFading] = useState(false);
  /** Chamber circles opacity crossfade (false only for one frame pair at transition start). */
  const [chamberRevealFadeIn, setChamberRevealFadeIn] = useState(true);
  const prevOverlayPhaseRef = useRef<OverlayPhase>(overlayPhase);

  /**
   * Pipeline may emit Stage 3A while the map is still in detection / keywords /
   * tease. Hold crystallizing + tease-leave until tease bubbles finish; buffer
   * the heartbeat if the API returns first.
   */
  const deferredStage3aIntroRef = useRef(false);
  const deferredStage3aHeartbeatRef = useRef(false);
  /** `stage3b_started` fired before overlay reached crystallizing — advance after hold. */
  const pendingStage3bAfterCrystallizingRef = useRef(false);

  const timersRef = useRef<number[]>([]);
  const pushTimer = useCallback((id: number) => {
    timersRef.current.push(id);
  }, []);
  useEffect(
    () => () => {
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
    },
    [],
  );

  /** Reset map SFX + BGM duck when leaving the map route (phase is driven via `goToOverlayPhase`). */
  useEffect(() => {
    return () => {
      setPipelineDetectionMapAudioSuppressed(false);
      setMapTranslationBgmDucked(false);
    };
  }, []);

  useEffect(() => {
    if (chambersComplete < 3) {
      setChamberFilledChromeLeaving(false);
      return undefined;
    }
    const id = window.setTimeout(() => {
      setChamberFilledChromeLeaving(true);
    }, CHAMBER_FILLED_HOLD_MS);
    pushTimer(id);
    return () => window.clearTimeout(id);
  }, [chambersComplete, pushTimer]);

  /**
   * When particle splay ends, broadcast `add_to_party_splay_complete` for SidePanel.
   * `/map` (`ownsHandoff`): only after our chamber-driven handoff. `/` etc.: after local splay
   * (SidePanel button) — do not timer-broadcast on `/map` for a foreign splay (would duplicate).
   */
  useEffect(() => {
    const shouldRunCompleteTimer =
      handoffSplayExitActive || (localSplayActive && !ownsHandoff);
    if (!shouldRunCompleteTimer) return undefined;
    const id = window.setTimeout(() => {
      broadcast({ stage: "add_to_party_splay_complete" });
    }, ADD_TO_PARTY_SPLAY_MS);
    pushTimer(id);
    return () => window.clearTimeout(id);
  }, [handoffSplayExitActive, localSplayActive, ownsHandoff, pushTimer]);

  useEffect(() => {
    if (overlayPhase !== "crystallizing") {
      setSpiritOpaque(false);
      return undefined;
    }
    setSpiritLine(0);
    setSpiritOpaque(false);
    const fadeIn = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setSpiritOpaque(true));
    });
    const iv = window.setInterval(() => {
      setSpiritLine((i) => (i + 1) % SPIRIT_LINES.length);
    }, 4000);
    return () => {
      window.cancelAnimationFrame(fadeIn);
      window.clearInterval(iv);
    };
  }, [overlayPhase]);

  useLayoutEffect(() => {
    const prev = prevOverlayPhaseRef.current;
    if (overlayPhase !== "chamber_reveal" && overlayPhase !== "complete") {
      setSpiritExitText(null);
      setSpiritExitFading(false);
      setChamberRevealFadeIn(true);
      prevOverlayPhaseRef.current = overlayPhase;
      return;
    }
    if (prev === "crystallizing" && overlayPhase === "chamber_reveal") {
      setChamberRevealFadeIn(false);
      setSpiritExitText(SPIRIT_LINES[spiritLineRef.current]);
      setSpiritExitFading(false);
    } else if (overlayPhase === "complete" && prev === "chamber_reveal") {
      setChamberRevealFadeIn(true);
      setSpiritExitText(null);
      setSpiritExitFading(false);
    } else if (overlayPhase === "chamber_reveal" && prev !== "crystallizing") {
      setChamberRevealFadeIn(true);
    }
    prevOverlayPhaseRef.current = overlayPhase;
  }, [overlayPhase]);

  useEffect(() => {
    if (overlayPhase !== "chamber_reveal") return undefined;
    if (spiritExitText === null || spiritExitFading) return undefined;

    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!cancelled) {
          setSpiritExitFading(true);
          setChamberRevealFadeIn(true);
        }
      });
    });
    const id = window.setTimeout(() => {
      if (!cancelled) {
        setSpiritExitText(null);
        setSpiritExitFading(false);
      }
    }, CRYSTALLIZING_TO_CHAMBER_FADE_MS + 90);
    pushTimer(id);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [overlayPhase, spiritExitText, spiritExitFading, pushTimer]);

  useEffect(() => {
    if (overlayPhase !== "crystallizing") return undefined;
    if (!pendingStage3bAfterCrystallizingRef.current) return undefined;
    const id = window.setTimeout(() => {
      pendingStage3bAfterCrystallizingRef.current = false;
      if (overlayPhaseRef.current !== "crystallizing") return;
      setChambersComplete(0);
      goToOverlayPhase("chamber_reveal");
    }, QUEUED_STAGE3B_CRYSTALLIZING_HOLD_MS);
    pushTimer(id);
    return () => window.clearTimeout(id);
  }, [overlayPhase, pushTimer, goToOverlayPhase]);

  const onPipelineEvent = useCallback(
    (event: PipelineStage) => {
      switch (event.stage) {
        case "pipeline_started":
          keywordsReadyForTeaseRef.current = false;
          deferredStage3aIntroRef.current = false;
          deferredStage3aHeartbeatRef.current = false;
          pendingStage3bAfterCrystallizingRef.current = false;
          ownChamberSplayPendingRef.current = false;
          setTeaseEndSeq(null);
          goToOverlayPhase("detection");
          setChambersComplete(0);
          setHandoffSplayExitActive(false);
          setLocalSplayActive(false);
          setChamberFilledChromeLeaving(false);
          setShowAddToPartyOverlay(false);
          setAddToPartyStage3aUrl(null);
          stage3aUrlRef.current = null;
          resetParticlePulse();
          break;
        case "stage1_complete":
          stage1Ref.current = event.payload;
          setStage1DataTick((t) => t + 1);
          break;
        case "stage2_complete":
          stage2Ref.current = event.payload;
          if (
            keywordsReadyForTeaseRef.current &&
            overlayPhaseRef.current === "keywords"
          ) {
            goToOverlayPhase("tease");
          }
          break;
        case "stage3a_started": {
          const ph = overlayPhaseRef.current;
          if (ph === "detection" || ph === "keywords" || ph === "tease") {
            deferredStage3aIntroRef.current = true;
            break;
          }
          deferredStage3aIntroRef.current = false;
          if (ph === "tease") {
            setTeaseLeaving(true);
            const id = window.setTimeout(() => setTeaseLeaving(false), 500);
            pushTimer(id);
          }
          if (ph !== "chamber_reveal" && ph !== "complete") {
            goToOverlayPhase("crystallizing");
          }
          break;
        }
        case "stage3a_complete":
          stage3aUrlRef.current = event.payload.stage3aUrl;
          if (deferredStage3aIntroRef.current) {
            deferredStage3aHeartbeatRef.current = true;
            break;
          }
          setHeartbeatActive(true);
          {
            const id1 = window.setTimeout(() => setHeartbeatActive(false), 450);
            pushTimer(id1);
          }
          break;
        case "stage3b_started": {
          const ph = overlayPhaseRef.current;
          if (ph === "crystallizing") {
            pendingStage3bAfterCrystallizingRef.current = false;
            setChambersComplete(0);
            goToOverlayPhase("chamber_reveal");
          } else if (
            ph === "detection" ||
            ph === "keywords" ||
            ph === "tease"
          ) {
            pendingStage3bAfterCrystallizingRef.current = true;
          } else if (ph === "hidden" || ph === "complete") {
            /** Map opened mid-run or chamber already done — no narrative queue to honor. */
            pendingStage3bAfterCrystallizingRef.current = false;
            setChambersComplete(0);
            goToOverlayPhase("chamber_reveal");
          }
          break;
        }
        case "stage3b_chambers_sync": {
          const count = Math.max(
            0,
            Math.min(3, Math.floor(event.payload.count)),
          );
          setChambersComplete(count);
          if (count >= 3) {
            goToOverlayPhase("complete");
            // `/map` only: MapOverlay broadcasts splay. On `/`, SidePanel owns that broadcast.
            if (ownsHandoff) {
              const id = window.setTimeout(() => {
                ownChamberSplayPendingRef.current = true;
                broadcast({ stage: "add_to_party_splay" });
              }, ADD_TO_PARTY_PREFACE_MS);
              pushTimer(id);
            }
          } else if (overlayPhaseRef.current === "complete") {
            goToOverlayPhase("chamber_reveal");
          }
          break;
        }
        case "sprite_sent":
          keywordsReadyForTeaseRef.current = false;
          deferredStage3aIntroRef.current = false;
          deferredStage3aHeartbeatRef.current = false;
          pendingStage3bAfterCrystallizingRef.current = false;
          setTeaseEndSeq(null);
          goToOverlayPhase("hidden");
          stage1Ref.current = null;
          stage2Ref.current = null;
          setChambersComplete(0);
          setTeaseLeaving(false);
          setHeartbeatActive(false);
          setHandoffSplayExitActive(false);
          setLocalSplayActive(false);
          ownChamberSplayPendingRef.current = false;
          setChamberFilledChromeLeaving(false);
          setShowAddToPartyOverlay(false);
          setAddToPartyStage3aUrl(null);
          stage3aUrlRef.current = null;
          break;
        case "add_to_party_splay":
          if (ownsHandoff && ownChamberSplayPendingRef.current) {
            ownChamberSplayPendingRef.current = false;
            setHandoffSplayExitActive(true);
          } else {
            setLocalSplayActive(true);
          }
          break;
        case "add_to_party_splay_complete":
          if (!ownsHandoff) break;
          if (!stage3aUrlRef.current) break;
          setAddToPartyStage3aUrl(stage3aUrlRef.current);
          setShowAddToPartyOverlay(true);
          break;
        case "add_to_party_overlay_complete":
          setHandoffSplayExitActive(false);
          setLocalSplayActive(false);
          break;
        default:
          break;
      }
    },
    [pushTimer, ownsHandoff, goToOverlayPhase],
  );

  useMapChannel(onPipelineEvent);

  const onAddToPartyComplete = useCallback(() => {
    setShowAddToPartyOverlay(false);
    setAddToPartyStage3aUrl(null);
    stage3aUrlRef.current = null;
    broadcast({ stage: "add_to_party_overlay_complete" });
    broadcast({ stage: "sprite_sent" });
    void onSpriteAdded?.();
  }, [onSpriteAdded]);

  const figure = useOverlayFigureLayout();
  const canvasSize = particleCanvasSize(figure.R);

  const onTranslationDecryptComplete = useCallback(() => {
    keywordsReadyForTeaseRef.current = false;
    goToOverlayPhase("keywords");
  }, [goToOverlayPhase]);

  const onKeywordsCascadeComplete = useCallback(() => {
    keywordsReadyForTeaseRef.current = true;
    if (stage2Ref.current) {
      setTeaseEndSeq(null);
      goToOverlayPhase("tease");
    }
  }, [goToOverlayPhase]);

  const finalizeTeaseToCrystallizing = useCallback(() => {
    if (overlayPhaseRef.current !== "tease") return;
    setTeaseEndSeq(null);
    goToOverlayPhase("crystallizing");
    const pulse = deferredStage3aHeartbeatRef.current;
    deferredStage3aIntroRef.current = false;
    deferredStage3aHeartbeatRef.current = false;
    if (pulse) {
      setHeartbeatActive(true);
      const id1 = window.setTimeout(() => setHeartbeatActive(false), 450);
      pushTimer(id1);
    }
  }, [pushTimer, goToOverlayPhase]);

  const handleTeaseAllBubblesShown = useCallback(() => {
    setTeaseEndSeq("pause");
    const id = window.setTimeout(() => {
      setTeaseEndSeq("fading");
    }, TEASE_POST_BUBBLES_PAUSE_MS);
    pushTimer(id);
  }, [pushTimer]);

  const onTeaseTextFadeTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.propertyName !== "opacity") return;
      if (teaseEndSeqRef.current !== "fading") return;
      finalizeTeaseToCrystallizing();
    },
    [finalizeTeaseToCrystallizing],
  );

  const keywordRows = useMemo(
    () => buildKeywordRows(stage1Ref.current),
    [stage1DataTick],
  );

  if (
    overlayPhase === "hidden" &&
    !handoffSplayExitActive &&
    !localSplayActive
  ) {
    return null;
  }

  /** Crystallizing keeps the same cycling morphs as tease/keywords; only spirit copy changes. */
  const particlePhase: React.ComponentProps<typeof ParticleCanvas>["phase"] =
    handoffSplayExitActive || localSplayActive
      ? "chamber_reveal"
      : overlayPhase === "detection"
        ? "drift"
        : overlayPhase === "keywords" ||
            overlayPhase === "tease" ||
            overlayPhase === "crystallizing"
          ? "assembling"
          : "chamber_reveal";

  const s2 = stage2Ref.current;

  /** Fullscreen particle layer: use real chamber count, or full humanoid during add-to-party splay (overlay may be `hidden` but canvas must stay formed). */
  const fullscreenParticleChambers =
    overlayPhase === "chamber_reveal" || overlayPhase === "complete"
      ? chambersComplete
      : handoffSplayExitActive || localSplayActive
        ? Math.max(3, chambersComplete)
        : 0;

  /** Keywords+ : opaque backdrop so the map never shows through (detection stays over the live map). */
  const showSolidBackdrop =
    overlayPhase === "keywords" ||
    overlayPhase === "tease" ||
    overlayPhase === "crystallizing" ||
    overlayPhase === "chamber_reveal" ||
    overlayPhase === "complete" ||
    handoffSplayExitActive ||
    localSplayActive;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        pointerEvents: "none",
      }}
    >
      {showSolidBackdrop && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            background: OVERLAY_PARTICLE_CANVAS_BG,
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        {heartbeatActive && (
          <>
            <style>{hbStyles}</style>
            <div
              aria-hidden
              className="map-overlay-heartbeat"
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(circle at 50% 45%, rgba(255,255,255,0.35) 0%, transparent 55%)",
                animation: "mapHeartbeatPulse 450ms ease-in-out forwards",
                pointerEvents: "none",
              }}
            />
          </>
        )}
        {overlayPhase === "detection" && (
          <DetectionFlash
            onTranslationDecryptComplete={onTranslationDecryptComplete}
          />
        )}

        {overlayPhase === "keywords" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "clamp(16px, 3vmin, 40px)",
              boxSizing: "border-box",
              width: "100%",
              height: "100%",
              maxHeight: "100dvh",
              overflowX: "hidden",
              overflowY: "auto",
            }}
          >
            <KeywordCascade
              keywords={keywordRows}
              onComplete={onKeywordsCascadeComplete}
              canvasSize={canvasSize}
              canvasNode={
                <ParticleCanvas
                  phase={particlePhase}
                  chambersComplete={0}
                  size={canvasSize}
                  assemblingAutoCycle
                />
              }
            />
          </div>
        )}

        {overlayPhase !== "keywords" && (
          <>
            <ParticleCanvas
              phase={particlePhase}
              chambersComplete={fullscreenParticleChambers}
              assemblingAutoCycle
              splayExitActive={handoffSplayExitActive || localSplayActive}
            />
          </>
        )}
        {(overlayPhase === "tease" || teaseLeaving) && (
          <div
            onTransitionEnd={onTeaseTextFadeTransitionEnd}
            style={{
              position: "absolute",
              inset: 0,
              opacity: teaseLeaving || teaseEndSeq === "fading" ? 0 : 1,
              transition: teaseLeaving
                ? "opacity 500ms ease"
                : teaseEndSeq === "fading"
                  ? `opacity ${TEASE_TEXT_FADE_OUT_MS}ms ease`
                  : teaseEndSeq === "pause"
                    ? "none"
                    : "opacity 0.2s ease",
            }}
          >
            <CharacterTease
              paletteColors={s2?.paletteColors ?? []}
              themeWords={s2?.themeWords ?? []}
              silhouetteHint={s2?.silhouetteHint ?? ""}
              peekWords={s2?.peekWords}
              keywords={keywordRows}
              onComplete={handleTeaseAllBubblesShown}
            />
          </div>
        )}
        {(overlayPhase === "crystallizing" || spiritExitText !== null) && (
          <p
            style={{
              ...KEYWORD_CASCADE_DESCRIPTION_STYLE,
              position: "absolute",
              left: "50%",
              bottom: "8vh",
              transform: "translateX(-50%)",
              margin: 0,
              opacity:
                spiritExitText !== null
                  ? spiritExitFading
                    ? 0
                    : 1
                  : spiritOpaque
                    ? 1
                    : 0,
              transition:
                spiritExitText !== null
                  ? `opacity ${CRYSTALLIZING_TO_CHAMBER_FADE_MS}ms ease`
                  : "opacity 1s ease",
              textAlign: "center",
              maxWidth: "90vw",
            }}
          >
            {spiritExitText ?? SPIRIT_LINES[spiritLine]}
          </p>
        )}
        {(overlayPhase === "chamber_reveal" || overlayPhase === "complete") && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              opacity: chamberRevealFadeIn ? 1 : 0,
              transition: `opacity ${CRYSTALLIZING_TO_CHAMBER_FADE_MS}ms ease`,
            }}
          >
            <div
              style={{
                opacity: chamberFilledChromeLeaving ? 0 : 1,
                transition: `opacity ${CHAMBER_CHROME_FADE_OUT_MS}ms ease`,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              <ChamberReveal chambersComplete={chambersComplete} />
            </div>
          </div>
        )}
      </div>
      {showAddToPartyOverlay && addToPartyStage3aUrl && (
        <AddToPartyOverlay
          stage3aUrl={addToPartyStage3aUrl}
          onComplete={onAddToPartyComplete}
          onAbort={onAddToPartyComplete}
        />
      )}
    </div>
  );
}
