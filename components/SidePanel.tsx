import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type {
  AnimState,
  DesignBrief,
  Interpretation,
} from "../app/pipeline/types";
import type {
  CustomStateSpec,
  GeneratedSpriteEntry,
} from "../lib/generatedSprites";
import { SpriteResult, ProcessingStatus } from "../types";
import { generateStage3AImage } from "../lib/pipelineStage3A";
import { removeBackground } from "../lib/removeBackground";
import { fileToBase64 } from "../utils/imageUtils.js";
import { ADD_TO_PARTY_PREFACE_MS } from "../constants";
import {
  broadcast,
  useMapChannel,
  type PipelineStage,
} from "../hooks/usePipelineChannel";
import { useChamberDrivenAddToParty } from "../hooks/useChamberDrivenAddToParty";
import { ColorChip } from "./ColorChip";
import { InterpretationDisplay } from "./InterpretationDisplay";
import { PipelineInputSection } from "./PipelineInputSection";
import { SPRITE_CHECKERBOARD_STYLE, SpriteStripView } from "./SpriteStripView";

const SIDE_PANEL_FILE_INPUT_ID = "side-panel-file-input";
const STAGE3A_LOADING_MESSAGES = [
  "Your character is choosing their outfit...",
  "Your character is doing their hair...",
  "Your character is picking their shoes...",
  "Your character is checking the mirror...",
  "Your character is getting dressed...",
] as const;

async function fetchInterpretationSafe(
  file: File,
): Promise<
  { ok: true; interpretation: Interpretation } | { ok: false; error: string }
> {
  try {
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      return { ok: false, error: "Please upload a PNG or JPG file." };
    }
    const mimeType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
    const imageBase64 = await fileToBase64(file);
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, mimeType }),
    });
    const data = (await res.json()) as {
      interpretation?: Interpretation;
      error?: string;
    };
    if (!res.ok)
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    if (!data.interpretation)
      return { ok: false, error: "Missing interpretation in response" };
    return { ok: true, interpretation: data.interpretation };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

interface SidePanelProps {
  onSpriteConfirm: (sprite: SpriteResult) => void;
  isSpawning: boolean;
  /**
   * True on `/map` embed: same JS bundle may run without mounting this panel; when mounted
   * with true, ignore `add_to_party_splay_complete` so only `/` SidePanel opens the overlay.
   */
  isMapOnly?: boolean;
  /** Map page only: inject live sprite from in-memory sheet URLs before save completes. */
  injectSpriteOptimistically?: (
    entry: GeneratedSpriteEntry,
    stateUrls: Record<string, string>,
  ) => void | Promise<void>;
  onGeneratedSpriteSaved?: (entry: GeneratedSpriteEntry) => void;
  /**
   * Map page (`/`): render `AddToPartyOverlay` outside the panel so `position: fixed`
   * is not clipped by the aside. Parent sets URL when ready; `onAddToPartyOverlayDone`
   * clears parent state when the handoff ends or aborts.
   */
  onAddToPartyOverlayReady?: (url: string) => void;
  onAddToPartyOverlayDone?: () => void;
}

export type SidePanelHandle = {
  /** After map-level overlay unmounts — broadcasts, save, reset (Add to Party complete). */
  runFinishAddToPartyAfterOverlay: () => void;
  /** User aborted portrait prep — broadcast + unlock (parent already cleared overlay URL). */
  runAbortAddToPartyOverlayFromMap: () => void;
};

type CollapsiblePanel =
  | "input"
  | "interpretation"
  | "brief"
  | "stage3a"
  | "stage3b"
  | null;

const STATE_SHEET_INFO: Record<
  "idle" | "walk",
  { frames: number; rows: number; w: number; h: number }
> = {
  idle: { frames: 2, rows: 4, w: 128, h: 256 },
  walk: { frames: 4, rows: 4, w: 256, h: 256 },
};

function emptyAnimUrls(): Record<AnimState, string | null> {
  return { idle: null, walk: null, custom: null };
}

function emptyAnimPhase(): Record<
  AnimState,
  "pending" | "loading" | "done" | "error"
> {
  return { idle: "pending", walk: "pending", custom: "pending" };
}

function stage3AVisualOneLiner(brief: DesignBrief): string {
  const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const summary = norm(brief.theme_summary);
  if (summary.length >= 28) {
    const m = summary.match(/^[\s\S]{1,600}?[.!?](?=\s|$)/);
    const one = (m ? m[0] : summary).trim();
    return /[.!?]$/.test(one) ? one : `${one}.`;
  }
  const h = brief.hair;
  const face = norm(brief.face?.description);
  const torso = brief.torso;
  const legs = brief.legs;
  const shoes = brief.shoes;
  let s = `A ${brief.gender} character`;
  if (h?.style || h?.color)
    s += ` with ${norm(h.style)} ${norm(h.color)} hair`.replace(/\s+/g, " ");
  if (face) s += `, ${face.charAt(0).toLowerCase()}${face.slice(1)}`;
  if (torso?.style || torso?.primary_color)
    s += `, wearing ${norm(torso.style)} in ${norm(torso.primary_color)}`;
  if (legs?.style) s += `, ${norm(legs.style)}`;
  if (shoes?.color) s += `, ${norm(shoes.color)} shoes`;
  if (!/[.!?]$/.test(s)) s += ".";
  if (s.length > 400) s = `${s.slice(0, 397)}…`;
  return s;
}

async function stage3ABase64ToSpriteResult(
  rawBase64: string,
): Promise<SpriteResult> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode Stage 3A image."));
    image.src = `data:image/png;base64,${rawBase64}`;
  });

  const frameToMatrix = (srcX: number): string[][] => {
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = 64;
    srcCanvas.height = 64;
    const srcCtx = srcCanvas.getContext("2d");
    if (!srcCtx) throw new Error("Could not create source canvas.");
    srcCtx.imageSmoothingEnabled = false;
    srcCtx.drawImage(img, srcX, 0, 64, 64, 0, 0, 64, 64);

    const downCanvas = document.createElement("canvas");
    downCanvas.width = 16;
    downCanvas.height = 16;
    const downCtx = downCanvas.getContext("2d");
    if (!downCtx) throw new Error("Could not create downsample canvas.");
    downCtx.imageSmoothingEnabled = false;
    downCtx.drawImage(srcCanvas, 0, 0, 64, 64, 0, 0, 16, 16);
    const data = downCtx.getImageData(0, 0, 16, 16).data;

    const out: string[][] = [];
    for (let y = 0; y < 16; y++) {
      const row: string[] = [];
      for (let x = 0; x < 16; x++) {
        const idx = (y * 16 + x) * 4;
        const r = data[idx] ?? 0;
        const g = data[idx + 1] ?? 0;
        const b = data[idx + 2] ?? 0;
        const a = data[idx + 3] ?? 0;
        if (a < 10 || (r < 12 && g < 12 && b < 12)) row.push("transparent");
        else {
          row.push(
            `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`,
          );
        }
      }
      out.push(row);
    }
    return out;
  };

  // Stage 3A strip order (prompts): down, left, right, up.
  const front = frameToMatrix(0);
  const left = frameToMatrix(64);
  const right = frameToMatrix(128);
  const back = frameToMatrix(192);

  const palette = Array.from(
    new Set(
      [...front, ...back, ...left, ...right]
        .flat()
        .filter((c) => c !== "transparent"),
    ),
  );

  return {
    matrix: { front, back, left, right },
    type: "humanoid",
    dimensions: { width: 16, height: 16 },
    palette,
  };
}

const ANIM_STATE_ORDER: AnimState[] = ["idle", "walk", "custom"];

const SidePanel = forwardRef<SidePanelHandle, SidePanelProps>(function SidePanel(
  {
    onSpriteConfirm,
    isSpawning,
    isMapOnly = false,
    injectSpriteOptimistically,
    onGeneratedSpriteSaved,
    onAddToPartyOverlayReady,
    onAddToPartyOverlayDone,
  },
  ref,
) {
  const mapStage3aUrlRef = useRef<string | null>(null);
  const isMapOnlyRef = useRef(false);
  isMapOnlyRef.current = Boolean(isMapOnly);
  const [processingState, setProcessingState] = useState<ProcessingStatus>(
    ProcessingStatus.IDLE,
  );
  const [spriteData, setSpriteData] = useState<SpriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [inputPreviewUrl, setInputPreviewUrl] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(
    null,
  );
  const [brief, setBrief] = useState<DesignBrief | null>(null);
  const [s2Loading, setS2Loading] = useState(false);
  const [s2Error, setS2Error] = useState<string | null>(null);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<CollapsiblePanel>("input");
  const prevSpawningRef = React.useRef(false);
  const prevLoadingRef = React.useRef(false);
  const [spritePipelineBusy, setSpritePipelineBusy] = useState(false);
  /** True only while idle/walk/custom API runs after "Generate States" (not during Generate Sprite). */
  const [isGeneratingStates, setIsGeneratingStates] = useState(false);
  const [isSavingToMap, setIsSavingToMap] = useState(false);
  const [stage3bReady, setStage3bReady] = useState(false);
  const [stage3bError, setStage3bError] = useState<string | null>(null);
  /** Raw Stage 3A PNG base64 (API output) — anchor for generate-states; not for display. */
  const [stage3aRawBase64, setStage3aRawBase64] = useState<string | null>(null);
  /** After removeBackground — matches pipeline page preview transparency. */
  const [stage3aPreviewUrl, setStage3aPreviewUrl] = useState<string | null>(
    null,
  );
  /** After first "Generate States" — show Stage 3B block below Generated Character. */
  const [showGeneratedStatesSection, setShowGeneratedStatesSection] =
    useState(false);
  const [animStateUrls, setAnimStateUrls] =
    useState<Record<AnimState, string | null>>(emptyAnimUrls);
  const [animStatePhase, setAnimStatePhase] =
    useState<Record<AnimState, "pending" | "loading" | "done" | "error">>(
      emptyAnimPhase,
    );
  const [animErrors, setAnimErrors] = useState<
    Partial<Record<AnimState, string>>
  >({});
  const [customSpec, setCustomSpec] = useState<CustomStateSpec | null>(null);
  const [stage3aLoadingMessage, setStage3aLoadingMessage] = useState(
    STAGE3A_LOADING_MESSAGES[0],
  );
  /** True while the Add-to-Party preview is delegated to the map page (outside this panel). */
  const [addToPartyViewOpen, setAddToPartyViewOpen] = useState(false);
  const addToPartyOverlayStage3aUrlRef = useRef<string | null>(null);
  const onAddToPartyOverlayReadyRef = useRef(onAddToPartyOverlayReady);
  const onAddToPartyOverlayDoneRef = useRef(onAddToPartyOverlayDone);
  useEffect(() => {
    onAddToPartyOverlayReadyRef.current = onAddToPartyOverlayReady;
  }, [onAddToPartyOverlayReady]);
  useEffect(() => {
    onAddToPartyOverlayDoneRef.current = onAddToPartyOverlayDone;
  }, [onAddToPartyOverlayDone]);
  /** After auto or manual add-to-party starts, ignore duplicate chamber-3 events until reset or count drops. */
  const autoAddToPartyLockRef = useRef(false);
  const resetChamberDrivenAddToPartyRef = useRef(() => {});

  const spriteDataRef = useRef(spriteData);
  const briefRef = useRef(brief);
  const interpretationRef = useRef(interpretation);
  const stage3aRawBase64Ref = useRef(stage3aRawBase64);
  const stage3aPreviewUrlRef = useRef(stage3aPreviewUrl);
  const animStateUrlsRef = useRef(animStateUrls);
  const customSpecRef = useRef(customSpec);

  useEffect(() => {
    spriteDataRef.current = spriteData;
  }, [spriteData]);
  useEffect(() => {
    briefRef.current = brief;
  }, [brief]);
  useEffect(() => {
    interpretationRef.current = interpretation;
  }, [interpretation]);
  useEffect(() => {
    stage3aRawBase64Ref.current = stage3aRawBase64;
  }, [stage3aRawBase64]);
  useEffect(() => {
    stage3aPreviewUrlRef.current = stage3aPreviewUrl;
  }, [stage3aPreviewUrl]);
  useEffect(() => {
    animStateUrlsRef.current = animStateUrls;
  }, [animStateUrls]);
  useEffect(() => {
    customSpecRef.current = customSpec;
  }, [customSpec]);

  useEffect(() => {
    const allDone = ANIM_STATE_ORDER.every((s) => animStatePhase[s] === "done");
    setStage3bReady(allDone);
    if (allDone) setStage3bError(null);
  }, [animStatePhase]);

  // Reset function to clear state
  const resetPanel = useCallback(() => {
    setProcessingState(ProcessingStatus.IDLE);
    setSpriteData(null);
    setError(null);
    setBuildError(null);
    setInterpretation(null);
    setBrief(null);
    setS2Loading(false);
    setS2Error(null);
    setInterpretError(null);
    setActivePanel("input");
    setSpritePipelineBusy(false);
    setIsGeneratingStates(false);
    setIsSavingToMap(false);
    setStage3bReady(false);
    setStage3bError(null);
    setStage3aRawBase64(null);
    setStage3aPreviewUrl(null);
    setShowGeneratedStatesSection(false);
    setAnimStateUrls(emptyAnimUrls());
    setAnimStatePhase(emptyAnimPhase());
    setAnimErrors({});
    setCustomSpec(null);
    setAddToPartyViewOpen(false);
    addToPartyOverlayStage3aUrlRef.current = null;
    onAddToPartyOverlayDoneRef.current?.();
    resetChamberDrivenAddToPartyRef.current();
    setInputPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
    const fileInput = document.getElementById(
      SIDE_PANEL_FILE_INPUT_ID,
    ) as HTMLInputElement | null;
    if (fileInput) fileInput.value = "";
  }, []);

  // Reset panel when spawning completes (transitions from true to false)
  React.useEffect(() => {
    if (prevSpawningRef.current && !isSpawning) {
      // Spawning just completed, reset the panel
      resetPanel();
    }
    prevSpawningRef.current = isSpawning;
  }, [isSpawning, resetPanel]);

  // After a run finishes, collapse the input strip (expand again via chevron).
  React.useEffect(() => {
    const loading = processingState === ProcessingStatus.PROCESSING;
    if (
      prevLoadingRef.current &&
      !loading &&
      processingState !== ProcessingStatus.IDLE
    ) {
      setActivePanel((p) => (p === "input" ? null : p));
    }
    prevLoadingRef.current = loading;
  }, [processingState]);

  const handleFileProcess = useCallback(async (file: File) => {
    try {
      setProcessingState(ProcessingStatus.PROCESSING);
      setActivePanel("input");
      setError(null);
      setBuildError(null);
      setInterpretation(null);
      setBrief(null);
      setS2Loading(false);
      setS2Error(null);
      setInterpretError(null);

      const interpResult = await fetchInterpretationSafe(file);

      if ("error" in interpResult) {
        setInterpretation(null);
        setInterpretError(interpResult.error);
        setActivePanel("input");
      } else {
        setInterpretation(interpResult.interpretation);
        setInterpretError(null);
        setActivePanel("interpretation");
      }

      setSpriteData(null);
      setBuildError(null);
      setStage3bReady(false);
      setStage3bError(null);
      setStage3aRawBase64(null);
      setStage3aPreviewUrl(null);
      setShowGeneratedStatesSection(false);
      setAnimStateUrls(emptyAnimUrls());
      setAnimStatePhase(emptyAnimPhase());
      setAnimErrors({});
      setCustomSpec(null);
      setProcessingState(ProcessingStatus.COMPLETE);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unknown error occurred",
      );
      setProcessingState(ProcessingStatus.ERROR);
    }
  }, []);

  const runBrief = useCallback(async () => {
    if (!interpretation) return;
    setS2Loading(true);
    setS2Error(null);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interpretation }),
      });
      const data = (await res.json()) as {
        designBrief?: DesignBrief;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!data.designBrief)
        throw new Error("Missing design brief in response");
      setBrief(data.designBrief);
      setSpriteData(null);
      setStage3bReady(false);
      setStage3bError(null);
      setBuildError(null);
      setStage3aRawBase64(null);
      setStage3aPreviewUrl(null);
      setShowGeneratedStatesSection(false);
      setAnimStateUrls(emptyAnimUrls());
      setAnimStatePhase(emptyAnimPhase());
      setAnimErrors({});
      setCustomSpec(null);
      setActivePanel("brief");
    } catch (e) {
      setS2Error(e instanceof Error ? e.message : "Stage 2 failed");
    } finally {
      setS2Loading(false);
    }
  }, [interpretation]);

  const generateAnimState = useCallback(
    async (state: AnimState): Promise<boolean> => {
      if (!brief || !interpretation || !stage3aRawBase64) return false;
      setAnimStatePhase((p) => ({ ...p, [state]: "loading" }));
      setAnimErrors((p) => {
        const next = { ...p };
        delete next[state];
        return next;
      });
      try {
        const res = await fetch("/api/generate-states", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character4ViewBase64: stage3aRawBase64,
            gender: brief.gender,
            designBrief: brief,
            onlyState: state,
            object: interpretation.object,
            themeSummary: brief.theme_summary,
          }),
        });
        const data = (await res.json()) as {
          idle?: string | null;
          walk?: string | null;
          custom?: string | null;
          customSpec?: CustomStateSpec | null;
          errors?: Record<string, string>;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.errors?.[state])
          throw new Error(data.errors[state] ?? `${state} failed`);
        const raw = state === "custom" ? data.custom : data[state];
        if (!raw || typeof raw !== "string")
          throw new Error("No image returned for this state");
        const cleaned = await removeBackground(`data:image/png;base64,${raw}`);
        setAnimStateUrls((p) => ({ ...p, [state]: cleaned }));
        if (state === "custom") {
          setCustomSpec(
            data.customSpec ?? {
              stateName: "special",
              frameCount: 3,
              directionRows: 1,
              description: "Custom animation",
              looping: true,
              fps: 8,
              rowOrder: "front",
            },
          );
        }
        setAnimStatePhase((p) => ({ ...p, [state]: "done" }));
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAnimStatePhase((p) => ({ ...p, [state]: "error" }));
        setAnimErrors((p) => ({ ...p, [state]: msg }));
        if (state === "custom") setCustomSpec(null);
        return false;
      }
    },
    [brief, interpretation, stage3aRawBase64],
  );

  const runStage3bPipeline = useCallback(async () => {
    setStage3bError(null);
    // Kick off all state generations at the same time.
    // This ensures no request waits for another one to finish.
    const results = await Promise.all(
      ANIM_STATE_ORDER.map((state) => generateAnimState(state)),
    );
    const allOk = results.every(Boolean);
    if (!allOk) {
      setStage3bError("One or more animation states failed.");
    }
  }, [generateAnimState]);

  const handleGenerateStates = useCallback(async () => {
    if (!brief || !interpretation || !stage3aRawBase64) return;
    setSpritePipelineBusy(true);
    setIsGeneratingStates(true);
    setShowGeneratedStatesSection(true);
    setActivePanel("stage3b");
    setAnimStatePhase(emptyAnimPhase());
    setAnimStateUrls(emptyAnimUrls());
    setAnimErrors({});
    setCustomSpec(null);
    setStage3bReady(false);
    setStage3bError(null);
    try {
      await runStage3bPipeline();
    } finally {
      setSpritePipelineBusy(false);
      setIsGeneratingStates(false);
    }
  }, [brief, interpretation, stage3aRawBase64, runStage3bPipeline]);

  const handleRetryAnimState = useCallback(
    (state: AnimState) => {
      void generateAnimState(state);
    },
    [generateAnimState],
  );

  const runGenerateSprite = useCallback(async () => {
    if (!brief || !interpretation) return;
    const randomIndex = Math.floor(
      Math.random() * STAGE3A_LOADING_MESSAGES.length,
    );
    setStage3aLoadingMessage(STAGE3A_LOADING_MESSAGES[randomIndex]);
    setSpritePipelineBusy(true);
    setBuildError(null);
    setStage3bError(null);
    setStage3bReady(false);
    setSpriteData(null);
    setStage3aRawBase64(null);
    setStage3aPreviewUrl(null);
    setShowGeneratedStatesSection(false);
    setAnimStateUrls(emptyAnimUrls());
    setAnimStatePhase(emptyAnimPhase());
    setAnimErrors({});
    setCustomSpec(null);
    try {
      const { rawBase64, cleanedDataUrl } = await generateStage3AImage(
        brief,
        interpretation,
      );
      const sprite = await stage3ABase64ToSpriteResult(rawBase64);
      setSpriteData(sprite);
      setStage3aRawBase64(rawBase64);
      setStage3aPreviewUrl(cleanedDataUrl);
      setActivePanel("stage3a");
    } catch (err: unknown) {
      setBuildError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpritePipelineBusy(false);
    }
  }, [brief, interpretation]);

  const isStage3ALoading =
    spritePipelineBusy && !isGeneratingStates && !stage3aRawBase64;

  const handleSelectTest = useCallback(
    async (url: string) => {
      try {
        setError(null);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load ${url}`);
        const blob = await res.blob();
        const file = new File([blob], "test-scan.jpg", {
          type: blob.type || "image/jpeg",
        });
        setInputPreviewUrl((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
          return URL.createObjectURL(file);
        });
        await handleFileProcess(file);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to load test image",
        );
      }
    },
    [handleFileProcess],
  );

  const beginAddToPartyFromMap = useCallback(
    (opts?: { skipSplayBroadcast?: boolean }) => {
      const spriteData = spriteDataRef.current;
      const brief = briefRef.current;
      const interpretation = interpretationRef.current;
      const stage3aRawBase64 = stage3aRawBase64Ref.current;
      if (!spriteData || !brief || !interpretation || !stage3aRawBase64) {
        return;
      }
      if (isSavingToMap || addToPartyViewOpen) {
        return;
      }
      const preview = stage3aPreviewUrlRef.current?.trim();
      const snapshot =
        preview && preview.length > 0
          ? preview
          : `data:image/png;base64,${stage3aRawBase64}`;
      addToPartyOverlayStage3aUrlRef.current = snapshot;

      autoAddToPartyLockRef.current = true;
      if (!opts?.skipSplayBroadcast) {
        window.setTimeout(() => {
          broadcast({ stage: "add_to_party_splay" });
        }, ADD_TO_PARTY_PREFACE_MS);
      }
      // Overlay mounts when the map broadcasts `add_to_party_splay_complete`
      // (chamber auto: `add_to_party_splay` is broadcast from MapOverlay after the same preface.)
    },
    [isSavingToMap, addToPartyViewOpen],
  );

  /** Map-only: stage3a URL from pipeline broadcast; overlay opens on `add_to_party_splay_complete`. */
  useMapChannel(
    useCallback((event: PipelineStage) => {
      if (event.stage === "pipeline_started") {
        mapStage3aUrlRef.current = null;
        return;
      }
      if (event.stage === "stage3a_complete") {
        mapStage3aUrlRef.current = event.payload.stage3aUrl;
        return;
      }
      if (event.stage !== "add_to_party_splay_complete") return;
      if (isMapOnlyRef.current) return;
      const url =
        addToPartyOverlayStage3aUrlRef.current ?? mapStage3aUrlRef.current;
      if (!url) return;
      addToPartyOverlayStage3aUrlRef.current = url;
      setAddToPartyViewOpen(true);
      onAddToPartyOverlayReadyRef.current?.(url);
    }, []),
  );

  const abortAddToPartyOverlay = useCallback(() => {
    broadcast({
      stage: "add_to_party_overlay_complete",
      payload: { skipPipelinePersist: true },
    });
    setAddToPartyViewOpen(false);
    addToPartyOverlayStage3aUrlRef.current = null;
    autoAddToPartyLockRef.current = false;
    resetChamberDrivenAddToPartyRef.current();
  }, []);

  const { resetChamberDrivenAddToParty } = useChamberDrivenAddToParty({
    addToPartyLockRef: autoAddToPartyLockRef,
    stage3bReady,
    canBeginAddToParty: Boolean(
      spriteData && brief && interpretation && stage3aRawBase64,
    ),
    isAddToPartyBlocked: isSavingToMap || addToPartyViewOpen,
    onBeginAddToParty: () =>
      beginAddToPartyFromMap({ skipSplayBroadcast: true }),
  });
  resetChamberDrivenAddToPartyRef.current = resetChamberDrivenAddToParty;

  const finishAddToParty = useCallback(() => {
    const spriteData = spriteDataRef.current;
    const brief = briefRef.current;
    const interpretation = interpretationRef.current;
    const stage3aRawBase64 = stage3aRawBase64Ref.current;
    const animStateUrls = animStateUrlsRef.current;
    const customSpec = customSpecRef.current;

    setAddToPartyViewOpen(false);

    broadcast({
      stage: "add_to_party_overlay_complete",
      payload: { skipPipelinePersist: true },
    });

    if (!spriteData || !brief || !interpretation || !stage3aRawBase64) {
      return;
    }
    if (isSavingToMap) return;

    setIsSavingToMap(true);
    setBuildError(null);

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const customName = customSpec?.stateName?.trim();

    const states: Record<string, string | null> = {
      idle: animStateUrls.idle ?? null,
      walk: animStateUrls.walk ?? null,
      ...(customSpec && animStateUrls.custom
        ? { custom: animStateUrls.custom }
        : {}),
    };

    const stateUrls: Record<string, string> = {};
    if (animStateUrls.idle) stateUrls.idle = animStateUrls.idle;
    if (animStateUrls.walk) stateUrls.walk = animStateUrls.walk;
    if (customName && animStateUrls.custom)
      stateUrls[customName] = animStateUrls.custom;

    const optimisticEntry: GeneratedSpriteEntry | null =
      injectSpriteOptimistically && Object.keys(stateUrls).length > 0
        ? {
            id,
            createdAt: new Date().toISOString(),
            object: interpretation.object,
            gender: interpretation.gender,
            themeSummary: brief.theme_summary,
            themeEmoji: interpretation.theme_emoji,
            states: Object.keys(stateUrls),
            hasPortrait: true,
            ...(customSpec
              ? { customStateName: customSpec.stateName, customSpec }
              : {}),
          }
        : null;

    onSpriteConfirm(spriteData);

    void (async () => {
      try {
        if (optimisticEntry && injectSpriteOptimistically) {
          await injectSpriteOptimistically(optimisticEntry, stateUrls);
        }
        const res = await fetch("/api/save-sprite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            gender: interpretation.gender,
            object: interpretation.object,
            themeSummary: brief.theme_summary,
            themeEmoji: interpretation.theme_emoji,
            brief,
            portrait: `data:image/png;base64,${stage3aRawBase64}`,
            states,
            ...(customSpec ? { customSpec } : {}),
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          id?: string;
          savedStates?: string[];
        };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        /** After disk + manifest are updated — map must not reload before save completes. */
        broadcast({ stage: "sprite_sent" });
        if (
          data.id &&
          Array.isArray(data.savedStates) &&
          onGeneratedSpriteSaved
        ) {
          onGeneratedSpriteSaved({
            id: data.id,
            createdAt: new Date().toISOString(),
            object: interpretation.object,
            gender: interpretation.gender,
            themeSummary: brief.theme_summary,
            themeEmoji: interpretation.theme_emoji,
            states: data.savedStates,
            hasPortrait: true,
            ...(customSpec
              ? { customStateName: customSpec.stateName, customSpec }
              : {}),
          });
        }
      } catch (err: unknown) {
        console.error("save-sprite failed:", err);
      } finally {
        setIsSavingToMap(false);
        resetPanel();
      }
    })();
  }, [
    isSavingToMap,
    onSpriteConfirm,
    injectSpriteOptimistically,
    onGeneratedSpriteSaved,
    resetPanel,
  ]);

  const finishAddToPartyImplRef = useRef(finishAddToParty);
  finishAddToPartyImplRef.current = finishAddToParty;
  const abortAddToPartyImplRef = useRef(abortAddToPartyOverlay);
  abortAddToPartyImplRef.current = abortAddToPartyOverlay;

  useImperativeHandle(
    ref,
    () => ({
      runFinishAddToPartyAfterOverlay: () => {
        finishAddToPartyImplRef.current();
      },
      runAbortAddToPartyOverlayFromMap: () => {
        abortAddToPartyImplRef.current();
      },
    }),
    [],
  );

  const handleConfirm = useCallback(() => {
    beginAddToPartyFromMap();
  }, [beginAddToPartyFromMap]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (processingState === ProcessingStatus.PROCESSING || spritePipelineBusy)
        return;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type.startsWith("image/")) {
          setInputPreviewUrl((prev) => {
            if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
            return URL.createObjectURL(file);
          });
          handleFileProcess(file);
        }
      }
    },
    [processingState, spritePipelineBusy, handleFileProcess],
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setInputPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      void handleFileProcess(file);
    }
  };

  const isUploadLoading = processingState === ProcessingStatus.PROCESSING;

  const showInputCollapseChrome =
    !isUploadLoading && processingState !== ProcessingStatus.IDLE;
  const inputExpanded =
    isUploadLoading || !showInputCollapseChrome || activePanel === "input";
  const interpretationExpanded = activePanel === "interpretation";
  const briefExpanded = activePanel === "brief";
  const stage3AExpanded = activePanel === "stage3a";
  const stage3bExpanded = activePanel === "stage3b";

  return (
    <div className="side-panel-responsive flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {/* Upload — collapsible after a completed run; keep "Input" title in header row */}
        <div className="flex-shrink-0 border-b border-neutral-800 px-3 pb-3 pt-0 short:px-3.5 short:pb-3.5">
          {showInputCollapseChrome ? (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                onClick={() =>
                  setActivePanel((p) => (p === "input" ? null : "input"))
                }
                aria-expanded={inputExpanded}
              >
                <span className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
                  Input
                </span>
                <svg
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-200 ${
                    inputExpanded ? "rotate-180" : ""
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {inputExpanded && (
                <div className="px-3 pb-3">
                  <PipelineInputSection
                    variant="narrow"
                    omitSectionTitle
                    previewUrl={inputPreviewUrl}
                    onFileChange={handleChange}
                    onSelectTest={(url) => void handleSelectTest(url)}
                    fileInputId={SIDE_PANEL_FILE_INPUT_ID}
                    accept="image/*"
                    disabled={isUploadLoading || spritePipelineBusy}
                    dropZoneHandlers={
                      isUploadLoading || spritePipelineBusy
                        ? undefined
                        : { onDrop: handleDrop, onDragOver: handleDragOver }
                    }
                  />
                </div>
              )}
            </div>
          ) : (
            <PipelineInputSection
              variant="narrow"
              previewUrl={inputPreviewUrl}
              onFileChange={handleChange}
              onSelectTest={(url) => void handleSelectTest(url)}
              fileInputId={SIDE_PANEL_FILE_INPUT_ID}
              accept="image/*"
              disabled={isUploadLoading || spritePipelineBusy}
              dropZoneHandlers={
                isUploadLoading || spritePipelineBusy
                  ? undefined
                  : { onDrop: handleDrop, onDragOver: handleDragOver }
              }
            />
          )}
          {error && !isUploadLoading && (
            <div className="px-3 pb-3 short:px-3.5">
              <div className="p-2 short:p-2 bg-red-900/20 border border-red-800 text-red-400 text-xs rounded text-center leading-relaxed short:leading-snug">
                {error}
              </div>
            </div>
          )}
        </div>

        {/* Loading: Google-style three-dot bounce in center while generating */}
        {isUploadLoading && (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 short:gap-3 p-4 short:p-3.5 border-t border-neutral-800">
            <div
              className="flex items-center justify-center gap-1.5"
              aria-hidden
            >
              <span className="loading-dot" />
              <span className="loading-dot" />
              <span className="loading-dot" />
            </div>
            <p className="text-[11px] font-medium text-neutral-400">
              Hmm, what could this be...?
            </p>
          </div>
        )}

        {/* Stage 1–style interpretation (same card as pipeline page) */}
        {!isUploadLoading && interpretation && (
          <div className="flex-shrink-0 border-b border-neutral-800 px-3 py-3 short:px-3.5 short:py-3.5">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                onClick={() =>
                  setActivePanel((p) =>
                    p === "interpretation" ? null : "interpretation",
                  )
                }
                aria-expanded={interpretationExpanded}
              >
                <span className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
                  Interpretation
                </span>
                <svg
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-200 ${
                    interpretationExpanded ? "rotate-180" : ""
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {interpretationExpanded && (
                <div className="px-3 pb-3">
                  <InterpretationDisplay
                    interpretation={interpretation}
                    compact
                    omitSectionTitle
                    className="p-0 short:p-0"
                  >
                    {!brief && (
                      <button
                        type="button"
                        disabled={s2Loading}
                        onClick={() => void runBrief()}
                        className="mt-4 w-full rounded-lg bg-violet-600 py-2.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                      >
                        {s2Loading
                          ? "Generating..."
                          : "Generate Character Brief"}
                      </button>
                    )}
                    {s2Error && (
                      <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-200">
                        {s2Error}
                      </div>
                    )}
                  </InterpretationDisplay>
                </div>
              )}
            </div>
          </div>
        )}
        {!isUploadLoading && interpretError && (
          <div className="flex-shrink-0 border-b border-neutral-800 px-3 py-2 short:px-3.5">
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-2 text-[11px] text-amber-200/90 short:leading-snug">
              <p className="font-medium text-amber-100/90">
                Interpretation unavailable
              </p>
              <p className="mt-1 text-amber-200/80">{interpretError}</p>
            </div>
          </div>
        )}

        {!isUploadLoading && brief && (
          <div className="flex-shrink-0 border-b border-neutral-800 px-3 py-3 short:px-3.5 short:py-3.5">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                onClick={() =>
                  setActivePanel((p) => (p === "brief" ? null : "brief"))
                }
                aria-expanded={briefExpanded}
              >
                <span className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
                  Character Brief
                </span>
                <svg
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-200 ${
                    briefExpanded ? "rotate-180" : ""
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {briefExpanded && (
                <div className="px-3 pb-3">
                  <div className="space-y-2 text-xs text-neutral-300">
                    <p>
                      <span className="text-neutral-500">Hair:</span>{" "}
                      {brief.hair?.style} - {brief.hair?.description}
                    </p>
                    <p>
                      <span className="text-neutral-500">Face:</span>{" "}
                      {brief.face?.expression} - {brief.face?.description}
                    </p>
                    <p>
                      <span className="text-neutral-500">Torso:</span>{" "}
                      {brief.torso?.style} - {brief.torso?.description}
                    </p>
                    <p>
                      <span className="text-neutral-500">Legs:</span>{" "}
                      {brief.legs?.style} - {brief.legs?.description}
                    </p>
                    <p>
                      <span className="text-neutral-500">Shoes:</span>{" "}
                      {brief.shoes?.color} - {brief.shoes?.description}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      brief.hair?.color,
                      brief.torso?.primary_color,
                      brief.legs?.color,
                      brief.shoes?.color,
                    ]
                      .filter(Boolean)
                      .map((c, i) => (
                        <span key={`${c}-${i}`}>
                          <ColorChip color={c as string} />
                        </span>
                      ))}
                  </div>
                  {!spriteData && !spritePipelineBusy && (
                    <button
                      type="button"
                      disabled={isUploadLoading || spritePipelineBusy}
                      onClick={() => void runGenerateSprite()}
                      className="mt-4 w-full rounded-lg bg-violet-600 py-2.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Generate Sprite
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {isStage3ALoading && (
          <div className="flex-1 min-h-[160px] px-3 py-6 short:px-3.5">
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-neutral-400">
              <div
                className="flex items-center justify-center gap-1.5"
                aria-hidden
              >
                <span className="loading-dot" />
                <span className="loading-dot" />
                <span className="loading-dot" />
              </div>
              <p className="text-[11px] font-medium text-neutral-400">
                {stage3aLoadingMessage}
              </p>
            </div>
          </div>
        )}

        {!isUploadLoading && spriteData && (
          <div className="flex-shrink-0 border-b border-neutral-800 px-3 py-3 short:px-3.5 short:py-3.5">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
              <div className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
                <span className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
                  Generated Character
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={spritePipelineBusy}
                    onClick={() => void runGenerateSprite()}
                    title="Regenerate Character"
                    aria-label="Regenerate Character"
                    className="shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-amber-200/90 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                      aria-hidden
                    >
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                      <path d="M16 16h5v5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActivePanel((p) =>
                        p === "stage3a" ? null : "stage3a",
                      )
                    }
                    aria-expanded={stage3AExpanded}
                    aria-label={
                      stage3AExpanded
                        ? "Collapse Generated Character"
                        : "Expand Generated Character"
                    }
                    className="shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-amber-200/90"
                  >
                    <svg
                      aria-hidden
                      className={`h-4 w-4 transition-transform duration-200 ${
                        stage3AExpanded ? "rotate-180" : ""
                      }`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        d="M6 9l6 6 6-6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              {stage3AExpanded && (
                <div className="px-3 pb-3">
                  {brief && (
                    <p className="text-xs text-neutral-400">
                      {stage3AVisualOneLiner(brief)}
                    </p>
                  )}
                  {stage3aPreviewUrl ? (
                    <div className="mt-4 min-w-0 w-full">
                      <SpriteStripView spriteImageUrl={stage3aPreviewUrl} />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-neutral-400">
                      4-view preview unavailable.
                    </p>
                  )}
                  {!showGeneratedStatesSection && (
                    <button
                      type="button"
                      disabled={
                        !brief ||
                        !interpretation ||
                        !stage3aRawBase64 ||
                        spritePipelineBusy
                      }
                      onClick={() => void handleGenerateStates()}
                      className="mt-4 w-full rounded-lg bg-violet-600 py-2.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Generate States
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!isUploadLoading && spriteData && showGeneratedStatesSection && (
          <div className="flex-shrink-0 border-b border-neutral-800 px-3 py-3 short:px-3.5 short:py-3.5">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                onClick={() =>
                  setActivePanel((p) => (p === "stage3b" ? null : "stage3b"))
                }
                aria-expanded={stage3bExpanded}
              >
                <span className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
                  Generated States
                </span>
                <svg
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-200 ${
                    stage3bExpanded ? "rotate-180" : ""
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {stage3bExpanded && (
                <div className="space-y-4 px-3 pb-3">
                  {ANIM_STATE_ORDER.map((state) => {
                    const phase = animStatePhase[state];
                    const url = animStateUrls[state];
                    const fixedInfo =
                      state === "idle" || state === "walk"
                        ? STATE_SHEET_INFO[state]
                        : null;
                    const customDims =
                      state === "custom" && customSpec
                        ? {
                            frames: customSpec.frameCount,
                            rows: customSpec.directionRows,
                            w: customSpec.frameCount * 64,
                            h: customSpec.directionRows * 64,
                          }
                        : null;
                    const info = fixedInfo ?? customDims;
                    const titleText =
                      state === "idle"
                        ? "Idle"
                        : state === "walk"
                          ? "Walk"
                          : customSpec && phase === "done"
                            ? `Custom (${customSpec.stateName})`
                            : "Custom";
                    const stateLoadingText =
                      state === "walk"
                        ? "Your character is practicing their walk…"
                        : state === "custom"
                          ? "Unlocking your character's special ability…"
                          : "Generating…";
                    const canRetryState =
                      !!stage3aRawBase64 &&
                      !!brief &&
                      !!interpretation &&
                      phase !== "loading" &&
                      phase !== "pending";
                    return (
                      <div
                        key={state}
                        className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 text-left text-xs font-medium text-neutral-300">
                            {titleText}
                          </span>
                          <button
                            type="button"
                            disabled={!canRetryState}
                            onClick={() => handleRetryAnimState(state)}
                            title="Regenerate This State"
                            aria-label={`Regenerate ${
                              state === "idle"
                                ? "Idle"
                                : state === "walk"
                                  ? "Walk"
                                  : "Custom"
                            } animation`}
                            className="shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-amber-200/90 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-4 w-4"
                              aria-hidden
                            >
                              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                              <path d="M3 3v5h5" />
                              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                              <path d="M16 16h5v5" />
                            </svg>
                          </button>
                        </div>
                        <div
                          className="mx-auto mt-2 flex min-h-[72px] max-w-full items-center justify-center overflow-hidden rounded border border-neutral-700"
                          style={
                            phase === "done" && url
                              ? SPRITE_CHECKERBOARD_STYLE
                              : {
                                  backgroundImage: "none",
                                  backgroundColor: "transparent",
                                }
                          }
                        >
                          {phase === "loading" && (
                            <div className="flex flex-col items-center justify-center gap-2 px-4 py-5 text-neutral-500">
                              <div
                                className="flex items-center justify-center gap-1.5"
                                aria-hidden
                              >
                                <span className="loading-dot" />
                                <span className="loading-dot" />
                                <span className="loading-dot" />
                              </div>
                              <span className="text-[10px] text-center">
                                {stateLoadingText}
                              </span>
                            </div>
                          )}
                          {url && phase === "done" && (
                            <img
                              src={url}
                              alt={`${state} sheet`}
                              className="max-h-36 w-auto max-w-full bg-transparent object-contain"
                              style={{ imageRendering: "pixelated" }}
                            />
                          )}
                          {phase === "pending" && (
                            <span className="p-3 text-[11px] text-neutral-600">
                              In Queue
                            </span>
                          )}
                          {phase === "error" && (
                            <span className="p-3 text-center text-[11px] text-red-400/90">
                              {animErrors[state] ?? "Failed"}
                            </span>
                          )}
                        </div>
                        {state === "custom" &&
                          customSpec &&
                          phase === "done" && (
                            <p className="mt-1 px-1 text-center text-[10px] leading-snug text-neutral-400">
                              {customSpec.description}
                            </p>
                          )}
                        {info && phase === "done" && (
                          <p className="mt-2 text-center text-[10px] text-neutral-500">
                            {info.frames} frames · {info.rows} rows · {info.w}×
                            {info.h}px
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {(buildError || (stage3bError && spriteData)) && !isUploadLoading && (
        <div className="flex-shrink-0 border-t border-neutral-800 p-4 short:p-3.5">
          {buildError && (
            <div className="mb-3 rounded-lg border border-red-800 bg-red-900/20 p-2.5 text-xs text-red-400">
              {buildError}
            </div>
          )}
          {stage3bError && spriteData && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-2.5 text-xs text-amber-200/90">
              <p className="font-medium text-amber-100/90">
                Animation states incomplete
              </p>
              <p className="mt-1 text-amber-200/80">{stage3bError}</p>
            </div>
          )}
        </div>
      )}

      {spriteData &&
        brief &&
        interpretation &&
        stage3bReady &&
        !isUploadLoading &&
        !addToPartyViewOpen &&
        !isSavingToMap && (
          <div className="mt-auto flex-shrink-0 border-t border-neutral-800 p-4 short:p-3.5">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSpawning}
              className={`w-full rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
                isSpawning
                  ? "cursor-not-allowed bg-neutral-700 text-neutral-500"
                  : "bg-amber-200 text-neutral-900 shadow-lg hover:bg-amber-300 hover:shadow-amber-300/50"
              }`}
            >
              Add To Party
            </button>
          </div>
        )}
    </div>
  );
});

export default SidePanel;
