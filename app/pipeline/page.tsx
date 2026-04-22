import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  broadcast,
  useMapChannel,
  type PipelineStage,
} from "../../hooks/usePipelineChannel";
import { ColorChip } from "../../components/ColorChip";
import { InterpretationDisplay } from "../../components/InterpretationDisplay";
import { PipelineInputSection } from "../../components/PipelineInputSection";
import { generateStage3AImage } from "../../lib/pipelineStage3A";
import { removeBackground } from "../../lib/removeBackground";
import {
  SpriteStripView,
  SPRITE_CHECKERBOARD_STYLE,
} from "../../components/SpriteStripView";
import type {
  CustomStateSpec,
  GeneratedSpriteEntry,
} from "../../lib/generatedSprites";
import { appendSessionSprite } from "../../lib/session-sprites";
import {
  buildPeekWordsFromBrief,
  pickRandomTeasePhrases,
  TEASE_BUBBLE_COUNT,
} from "../../lib/briefPeekWords";
import { resolvePegSwatchHex } from "../../lib/pegSwatchColors";
import type { AnimState, DesignBrief, Interpretation } from "./types";

/** Footer / bottom-of-card primary actions (same look as “Generate all animation states”). */
const PIPELINE_PRIMARY =
  "rounded-lg bg-violet-700 text-sm font-semibold text-white hover:bg-violet-600 disabled:opacity-40";

function uniqueColors(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const hex = resolvePegSwatchHex(c) ?? c;
    const k = hex.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(resolvePegSwatchHex(c) ?? c);
    }
  }
  return out;
}

async function loadImageAsBase64(url: string): Promise<{
  base64: string;
  mimeType: "image/png" | "image/jpeg";
  previewUrl: string;
}> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  const blob = await res.blob();
  const mimeType =
    blob.type === "image/jpeg" || blob.type === "image/jpg"
      ? "image/jpeg"
      : "image/png";
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
      resolve({ base64, mimeType, previewUrl: dataUrl });
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

async function readFileAsBase64(file: File): Promise<{
  base64: string;
  mimeType: "image/png" | "image/jpeg";
  previewUrl: string;
}> {
  const mimeType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    throw new Error("Please upload a PNG or JPG file.");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
      resolve({ base64, mimeType, previewUrl: dataUrl });
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
      {children}
    </h2>
  );
}

/** Circular-arrow refresh; inherits `currentColor` from the button. */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 16v5h5" />
    </svg>
  );
}

/** Checkmark for manual map-chamber approval (Stage 3B). */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** One visual sentence for Stage 3A (first sentence of theme_summary, else composed like a person description). */
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
  if (h?.style || h?.color) {
    s += ` with ${norm(h.style)} ${norm(h.color)} hair`.replace(/\s+/g, " ");
  }
  if (face) s += `, ${face.charAt(0).toLowerCase()}${face.slice(1)}`;
  if (torso?.style || torso?.primary_color) {
    s += `, wearing ${norm(torso.style)} in ${norm(torso.primary_color)}`;
  }
  if (legs?.style) s += `, ${norm(legs.style)}`;
  if (shoes?.color) s += `, ${norm(shoes.color)} shoes`;
  if (!/[.!?]$/.test(s)) s += ".";
  if (s.length > 400) s = `${s.slice(0, 397)}…`;
  return s;
}

/** Stage 3B generation order (idle + walk first for map use). */
const ANIM_ORDER: AnimState[] = ["idle", "walk", "custom"];

/** Row order in Stage 3B UI */
const ANIM_DISPLAY_ORDER: AnimState[] = ["idle", "walk", "custom"];

const STATE_SHEET_INFO: Record<
  "idle" | "walk",
  { frames: number; rows: number; w: number; h: number }
> = {
  idle: { frames: 2, rows: 4, w: 128, h: 256 },
  walk: { frames: 4, rows: 4, w: 256, h: 256 },
};

function emptyAnimUrls(): Record<AnimState, string | null> {
  return {
    idle: null,
    walk: null,
    custom: null,
  };
}

function emptyAnimPhase(): Record<
  AnimState,
  "pending" | "loading" | "done" | "error"
> {
  return {
    idle: "pending",
    walk: "pending",
    custom: "pending",
  };
}

function emptyAnimApproved(): Record<AnimState, boolean> {
  return { idle: false, walk: false, custom: false };
}

function canShowAnimStateRetry(
  phase: "pending" | "loading" | "done" | "error",
  fourViewReady: boolean,
): boolean {
  return fourViewReady && (phase === "done" || phase === "error");
}

type PipelineOutputCardId =
  | "stage3b"
  | "stage3a"
  | "brief"
  | "interpretation"
  | "scan";

const PIPELINE_STAGE_ORDER: PipelineOutputCardId[] = [
  "scan",
  "interpretation",
  "brief",
  "stage3a",
  "stage3b",
];

const PIPELINE_STAGE_TITLES: Record<PipelineOutputCardId, string> = {
  scan: "Original scan",
  interpretation: "Interpretation (Stage 1)",
  brief: "Character brief (Stage 2)",
  stage3a: "4-view character (Stage 3A)",
  stage3b: "Animation states (Stage 3B)",
};

function ChevronDownIcon({
  expanded,
  className,
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`text-current transition-transform duration-200 ${
        expanded ? "rotate-180" : ""
      } ${className ?? ""}`}
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Prior stage in the left column; chevron toggles body open in-place (narrow rail). */
function PipelineStageLeftRailCard({
  title,
  expanded,
  onToggleExpanded,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-neutral-800 bg-neutral-900/50">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-800/60 px-3 py-2.5">
        <span className="min-w-0 text-xs font-semibold uppercase tracking-wider text-amber-200/90">
          {title}
        </span>
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-amber-700/40 hover:bg-neutral-800 hover:text-amber-100"
        >
          <ChevronDownIcon expanded={expanded} />
        </button>
      </div>
      {expanded ? (
        <div className="min-w-0 overflow-auto px-3 pb-3 pt-2">{children}</div>
      ) : null}
    </div>
  );
}

/** Active pipeline stage — always the wide right column. */
function PipelineStageMainPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50">
      <div className="flex shrink-0 items-center gap-3 border-b border-neutral-800/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold uppercase tracking-wider text-amber-200/90">
              {title}
            </span>
            <span className="rounded border border-emerald-700/50 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200/90">
              Active
            </span>
          </div>
        </div>
      </div>
      <div className="min-h-0 min-w-0 overflow-auto px-4 pb-4 pt-3">
        {children}
      </div>
    </div>
  );
}

function SaveToMapBlock({
  saveState,
  savedId,
  s3bRunning,
  onSave,
  disabled,
  title,
  alignEnd,
}: {
  saveState: "idle" | "saving" | "saved" | "error";
  savedId: string | null;
  s3bRunning: boolean;
  onSave: () => void;
  disabled: boolean;
  title?: string;
  /** Right-align content (e.g. header toolbar next to stage tabs). */
  alignEnd?: boolean;
}) {
  return (
    <div
      className={`flex flex-col ${alignEnd ? "items-end text-right" : "items-center"}`}
    >
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        title={saveState === "error" ? "Retry save to map" : title}
        aria-label={saveState === "error" ? "Retry save to map" : undefined}
        className={`${PIPELINE_PRIMARY} cursor-pointer px-6 py-3 disabled:cursor-not-allowed`}
      >
        {saveState === "idle" && "Save to Map"}
        {saveState === "saving" && "Saving..."}
        {saveState === "saved" && "Saved to Map ✅"}
        {saveState === "error" && <RefreshIcon className="mx-auto" />}
      </button>
      {saveState === "saved" && (
        <div
          className={`mt-2 max-w-sm space-y-1 text-xs text-emerald-200/90 text-center"
          }`}
        >
          {s3bRunning && (
            <p>
              Animation states are still generating. Re-save when complete for
              full animation.
            </p>
          )}
          {savedId && <p>Saved ID: {savedId}</p>}
        </div>
      )}
    </div>
  );
}

export default function PipelinePage() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<"image/png" | "image/jpeg" | null>(
    null,
  );

  const [interpretation, setInterpretation] = useState<Interpretation | null>(
    null,
  );
  const [brief, setBrief] = useState<DesignBrief | null>(null);
  /** PNG data URL after Stage 3 + client-side background removal */
  const [spriteImageUrl, setSpriteImageUrl] = useState<string | null>(null);
  /** Raw Stage 3A PNG base64 (before removeBackground) — style anchor for Stage 3B */
  const [fourViewRawBase64, setFourViewRawBase64] = useState<string | null>(
    null,
  );

  const [animStateUrls, setAnimStateUrls] =
    useState<Record<AnimState, string | null>>(emptyAnimUrls);
  const [animStatePhase, setAnimStatePhase] =
    useState<Record<AnimState, "pending" | "loading" | "done" | "error">>(
      emptyAnimPhase,
    );
  const [animErrors, setAnimErrors] = useState<Record<string, string>>({});
  const [customSpec, setCustomSpec] = useState<CustomStateSpec | null>(null);
  const [animStateApproved, setAnimStateApproved] =
    useState<Record<AnimState, boolean>>(emptyAnimApproved);
  const animStateApprovedRef = useRef(emptyAnimApproved());

  const setAnimApprovals = useCallback(
    (next: Record<AnimState, boolean>, syncMap: boolean) => {
      animStateApprovedRef.current = next;
      setAnimStateApproved(next);
      if (syncMap) {
        const count = ANIM_ORDER.filter((s) => next[s]).length;
        broadcast({
          stage: "stage3b_chambers_sync",
          payload: { count },
        });
      }
    },
    [],
  );

  const [s1Loading, setS1Loading] = useState(false);
  const [s2Loading, setS2Loading] = useState(false);
  const [s3Loading, setS3Loading] = useState(false);
  const [s3bRunning, setS3bRunning] = useState(false);
  /** After first “Generate all animation states”, show Stage 3B beside scan + 4-view below. */
  const [stage3bPanelVisible, setStage3bPanelVisible] = useState(false);

  const [s1Error, setS1Error] = useState<string | null>(null);
  const [s2Error, setS2Error] = useState<string | null>(null);
  const [s3Error, setS3Error] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [savedId, setSavedId] = useState<string | null>(null);
  /** After "Run pipeline", input column is replaced by the original scan preview. */
  const [showPipelineInput, setShowPipelineInput] = useState(true);

  const hasImage = Boolean(imageBase64 && mimeType);
  const stage3bComplete = ANIM_ORDER.every((s) => animStatePhase[s] === "done");
  const allAnimStatesApproved = useMemo(
    () => ANIM_ORDER.every((s) => animStateApproved[s]),
    [animStateApproved],
  );

  /** Left rail: per-stage expand (body hidden when false). */
  const [leftRailExpanded, setLeftRailExpanded] = useState<
    Partial<Record<PipelineOutputCardId, boolean>>
  >({});

  const activePipelineCardId = useMemo((): PipelineOutputCardId => {
    if (stage3bPanelVisible && fourViewRawBase64 && brief && spriteImageUrl) {
      return "stage3b";
    }
    if (fourViewRawBase64 && spriteImageUrl) return "stage3a";
    if (brief) return "brief";
    if (interpretation) return "interpretation";
    return "scan";
  }, [
    stage3bPanelVisible,
    fourViewRawBase64,
    brief,
    spriteImageUrl,
    interpretation,
  ]);

  const visibleStages = useMemo((): PipelineOutputCardId[] => {
    const v: PipelineOutputCardId[] = [];
    if (!showPipelineInput && previewUrl) v.push("scan");
    if (interpretation) v.push("interpretation");
    if (brief) v.push("brief");
    if (spriteImageUrl && fourViewRawBase64) v.push("stage3a");
    if (stage3bPanelVisible && fourViewRawBase64 && brief && spriteImageUrl) {
      v.push("stage3b");
    }
    return v;
  }, [
    showPipelineInput,
    previewUrl,
    interpretation,
    brief,
    spriteImageUrl,
    fourViewRawBase64,
    stage3bPanelVisible,
  ]);

  const dockedStages = useMemo(() => {
    return PIPELINE_STAGE_ORDER.filter(
      (id) => visibleStages.includes(id) && id !== activePipelineCardId,
    );
  }, [visibleStages, activePipelineCardId]);

  const selectTest = useCallback(async (url: string) => {
    setShowPipelineInput(true);
    setLeftRailExpanded({});
    setS1Error(null);
    setS2Error(null);
    setS3Error(null);
    setInterpretation(null);
    setBrief(null);
    setSpriteImageUrl(null);
    setFourViewRawBase64(null);
    setAnimStateUrls(emptyAnimUrls());
    setAnimStatePhase(emptyAnimPhase());
    setAnimErrors({});
    setCustomSpec(null);
    setAnimApprovals(emptyAnimApproved(), true);
    setStage3bPanelVisible(false);
    try {
      const {
        base64,
        mimeType: mt,
        previewUrl: p,
      } = await loadImageAsBase64(url);
      setImageBase64(base64);
      setMimeType(mt);
      setPreviewUrl(p);
    } catch (e) {
      setS1Error(e instanceof Error ? e.message : "Failed to load test image");
    }
  }, []);

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setShowPipelineInput(true);
    setLeftRailExpanded({});
    setS1Error(null);
    setS2Error(null);
    setS3Error(null);
    setInterpretation(null);
    setBrief(null);
    setSpriteImageUrl(null);
    setFourViewRawBase64(null);
    setAnimStateUrls(emptyAnimUrls());
    setAnimStatePhase(emptyAnimPhase());
    setAnimErrors({});
    setAnimApprovals(emptyAnimApproved(), true);
    setStage3bPanelVisible(false);
    try {
      const {
        base64,
        mimeType: mt,
        previewUrl: p,
      } = await readFileAsBase64(file);
      setImageBase64(base64);
      setMimeType(mt);
      setPreviewUrl(p);
    } catch (err) {
      setS1Error(err instanceof Error ? err.message : "Invalid file");
    }
  }, []);

  const runInterpret = useCallback(async () => {
    if (!imageBase64 || !mimeType) return;
    setShowPipelineInput(false);
    setS1Loading(true);
    setS1Error(null);
    try {
      const res = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, mimeType }),
      });
      const data = (await res.json()) as {
        interpretation?: Interpretation;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!data.interpretation)
        throw new Error("Missing interpretation in response");
      broadcast({ stage: "pipeline_started" });
      setInterpretation(data.interpretation);
      broadcast({
        stage: "stage1_complete",
        payload: {
          object: data.interpretation.object ?? "",
          mood: data.interpretation.mood ?? "",
          emoji: data.interpretation.theme_emoji ?? "",
          traits: data.interpretation.key_traits ?? [],
          colors: data.interpretation.peg_colors_used ?? [],
        },
      });
      setBrief(null);
      setSpriteImageUrl(null);
      setFourViewRawBase64(null);
      setAnimStateUrls(emptyAnimUrls());
      setAnimStatePhase(emptyAnimPhase());
      setAnimErrors({});
      setCustomSpec(null);
      setAnimApprovals(emptyAnimApproved(), true);
      setStage3bPanelVisible(false);
      setS2Error(null);
      setS3Error(null);
    } catch (e) {
      setS1Error(e instanceof Error ? e.message : "Stage 1 failed");
    } finally {
      setS1Loading(false);
    }
  }, [imageBase64, mimeType]);

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
      {
        const b = data.designBrief;
        const paletteColors = uniqueColors(
          [
            b.hair?.color,
            b.torso?.primary_color,
            b.torso?.secondary_color,
            b.legs?.color,
            b.shoes?.color,
          ].filter((c): c is string => Boolean(c)),
        );
        const themeWords = b.theme_elements ?? [];
        const silhouetteHint =
          (b.hair.description ?? "").trim().split(/\s+/)[0] ?? "";
        const trimmedSpeech = Array.isArray(b.speech_tease_phrases)
          ? b.speech_tease_phrases
              .map((s) => String(s).trim())
              .filter((s) => s.length > 0)
          : [];
        const peekWords =
          trimmedSpeech.length >= TEASE_BUBBLE_COUNT
            ? pickRandomTeasePhrases(trimmedSpeech, TEASE_BUBBLE_COUNT)
            : pickRandomTeasePhrases(
                buildPeekWordsFromBrief(b),
                TEASE_BUBBLE_COUNT,
              );
        broadcast({
          stage: "stage2_complete",
          payload: {
            paletteColors,
            themeWords,
            silhouetteHint,
            peekWords,
          },
        });
      }
      setSpriteImageUrl(null);
      setFourViewRawBase64(null);
      setAnimStateUrls(emptyAnimUrls());
      setAnimStatePhase(emptyAnimPhase());
      setAnimErrors({});
      setCustomSpec(null);
      setAnimApprovals(emptyAnimApproved(), true);
      setStage3bPanelVisible(false);
      setS3Error(null);
    } catch (e) {
      setS2Error(e instanceof Error ? e.message : "Stage 2 failed");
    } finally {
      setS2Loading(false);
    }
  }, [interpretation]);

  const runGenerate = useCallback(async () => {
    if (!brief || !interpretation) return;
    setStage3bPanelVisible(false);
    setS3Loading(true);
    setS3Error(null);
    try {
      broadcast({ stage: "stage3a_started" });
      const { rawBase64, cleanedDataUrl } = await generateStage3AImage(
        brief,
        interpretation,
      );
      setFourViewRawBase64(rawBase64);
      setSpriteImageUrl(cleanedDataUrl);
      broadcast({
        stage: "stage3a_complete",
        payload: { stage3aUrl: cleanedDataUrl },
      });
      setAnimStateUrls(emptyAnimUrls());
      setAnimStatePhase(emptyAnimPhase());
      setAnimErrors({});
      setCustomSpec(null);
      setAnimApprovals(emptyAnimApproved(), true);
      setSaveState("idle");
      setSavedId(null);
    } catch (e) {
      setS3Error(e instanceof Error ? e.message : "Stage 3 failed");
    } finally {
      setS3Loading(false);
    }
  }, [brief, interpretation]);

  const tryAnother = useCallback(() => {
    setShowPipelineInput(true);
    setLeftRailExpanded({});
    setPreviewUrl(null);
    setImageBase64(null);
    setMimeType(null);
    setInterpretation(null);
    setBrief(null);
    setSpriteImageUrl(null);
    setFourViewRawBase64(null);
    setAnimStateUrls(emptyAnimUrls());
    setAnimStatePhase(emptyAnimPhase());
    setAnimErrors({});
    setCustomSpec(null);
    setAnimApprovals(emptyAnimApproved(), true);
    setStage3bPanelVisible(false);
    setS1Error(null);
    setS2Error(null);
    setS3Error(null);
    setS3bRunning(false);
    setSaveState("idle");
    setSavedId(null);
  }, [setAnimApprovals]);

  const handleSave = useCallback(
    async (options?: { emitSpriteSent?: boolean }) => {
      if (!interpretation || !brief || !fourViewRawBase64) return;
      setSaveState("saving");
      try {
        const states: Record<string, string | null> = {
          idle: animStateUrls.idle ?? null,
          walk: animStateUrls.walk ?? null,
        };
        if (customSpec && animStateUrls.custom) {
          states[customSpec.stateName] = animStateUrls.custom;
        }
        const res = await fetch("/api/save-sprite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gender: interpretation.gender,
            object: interpretation.object,
            themeSummary: brief.theme_summary,
            themeEmoji: interpretation.theme_emoji,
            brief,
            portrait: `data:image/png;base64,${fourViewRawBase64}`,
            states,
            ...(customSpec ? { customSpec } : {}),
          }),
        });
        const data = (await res.json()) as {
          id?: string;
          savedStates?: string[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const id = data.id;
        if (id) {
          const stateUrls: Record<string, string> = {};
          if (animStateUrls.idle) stateUrls.idle = animStateUrls.idle;
          if (animStateUrls.walk) stateUrls.walk = animStateUrls.walk;
          const customName = customSpec?.stateName?.trim();
          if (customName && animStateUrls.custom) {
            stateUrls[customName] = animStateUrls.custom;
          }
          if (Object.keys(stateUrls).length > 0) {
            const states =
              Array.isArray(data.savedStates) && data.savedStates.length > 0
                ? data.savedStates
                : Object.keys(stateUrls);
            const entry: GeneratedSpriteEntry = {
              id,
              createdAt: new Date().toISOString(),
              object: interpretation.object,
              gender: interpretation.gender,
              themeSummary: brief.theme_summary,
              themeEmoji: interpretation.theme_emoji,
              states,
              hasPortrait: true,
              ...(customSpec
                ? {
                    customStateName: customSpec.stateName,
                    customSpec,
                  }
                : {}),
            };
            appendSessionSprite({ entry, stateUrls });
          }
        }
        setSavedId(data.id ?? null);
        setSaveState("saved");
        if (options?.emitSpriteSent !== false) {
          broadcast({ stage: "sprite_sent" });
        }
      } catch (err) {
        console.error(err);
        setSaveState("error");
      }
    },
    [interpretation, brief, fourViewRawBase64, animStateUrls, customSpec],
  );

  useMapChannel(
    useCallback(
      (event: PipelineStage) => {
        if (event.stage !== "add_to_party_overlay_complete") return;
        if (event.payload?.skipPipelinePersist === true) return;
        void handleSave();
      },
      [handleSave],
    ),
  );

  const generateAnimState = useCallback(
    async (state: AnimState) => {
      if (!fourViewRawBase64 || !brief) return;
      const ap = animStateApprovedRef.current;
      if (ap[state]) {
        const next = { ...ap, [state]: false };
        setAnimApprovals(next, true);
      }
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
            character4ViewBase64: fourViewRawBase64,
            gender: brief.gender,
            designBrief: brief,
            onlyState: state,
            object: interpretation?.object,
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
          throw new Error(data.errors[state] ?? "State failed");
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAnimStatePhase((p) => ({ ...p, [state]: "error" }));
        setAnimErrors((p) => ({ ...p, [state]: msg }));
        if (state === "custom") setCustomSpec(null);
      }
    },
    [fourViewRawBase64, brief, interpretation?.object, setAnimApprovals],
  );

  const approveAnimState = useCallback(
    (state: AnimState) => {
      if (animStatePhase[state] !== "done") return;
      const prev = animStateApprovedRef.current;
      if (prev[state]) return;
      setAnimApprovals({ ...prev, [state]: true }, true);
    },
    [animStatePhase, setAnimApprovals],
  );

  const runAllAnimStates = useCallback(async () => {
    if (!fourViewRawBase64 || !brief) return;
    setStage3bPanelVisible(true);
    setAnimApprovals(emptyAnimApproved(), true);
    broadcast({ stage: "stage3b_started" });
    setS3bRunning(true);
    try {
      for (const state of ANIM_ORDER) {
        await generateAnimState(state);
      }
    } finally {
      setS3bRunning(false);
    }
  }, [fourViewRawBase64, brief, generateAnimState, setAnimApprovals]);

  const briefColors = useMemo(() => {
    if (!brief) return [];
    const raw = [
      brief.hair?.color,
      brief.torso?.primary_color,
      brief.torso?.secondary_color,
      brief.legs?.color,
      brief.shoes?.color,
    ].filter(Boolean) as string[];
    return uniqueColors(raw);
  }, [brief]);

  const stage3AOneLiner = useMemo(
    () => (brief ? stage3AVisualOneLiner(brief) : ""),
    [brief],
  );

  const renderStage3AFourViewCard = useCallback(
    (opts?: { embedded?: boolean; railCompact?: boolean }) => {
      const embedded = opts?.embedded ?? false;
      const railCompact = opts?.railCompact ?? false;
      const rc = embedded && railCompact;
      return (
        <div
          className={
            embedded
              ? rc
                ? "space-y-2"
                : "space-y-3"
              : "rounded-xl border border-neutral-800 bg-neutral-950 p-4 md:p-6"
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {!embedded ? (
                <SectionTitle>4-view character (Stage 3A)</SectionTitle>
              ) : null}
              {!embedded ? (
                <p className="mt-2 text-sm text-neutral-400">
                  {stage3AOneLiner}
                </p>
              ) : (
                <p
                  className={
                    rc
                      ? "text-[11px] leading-snug text-neutral-400"
                      : "text-sm text-neutral-400"
                  }
                >
                  {stage3AOneLiner}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={s3Loading || s3bRunning || !brief || !interpretation}
                aria-label={
                  s3Loading
                    ? "Regenerating 4-view…"
                    : "Retry 4-view character (resets Stage 3B)"
                }
                title={
                  s3bRunning
                    ? "Wait until Stage 3B finishes — retrying now can overlap API calls."
                    : s3Loading
                      ? "Regenerating…"
                      : "Regenerate the 4-view sprite (resets Stage 3B progress)"
                }
                onClick={() => void runGenerate()}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded border border-amber-700/50 bg-amber-950/40 text-amber-100 hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshIcon
                  className={s3Loading ? "animate-spin" : undefined}
                />
              </button>
            </div>
          </div>
          {s3Error && (
            <div
              className={
                rc
                  ? "mt-2 rounded-lg border border-red-900/60 bg-red-950/40 p-2 text-[10px] text-red-200"
                  : "mt-3 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-200"
              }
            >
              <p className="font-medium">Stage 3A error</p>
              <p className="mt-1 text-red-300/90">{s3Error}</p>
            </div>
          )}
          <div className={rc ? "mt-2 w-full min-w-0" : "mt-4 w-full min-w-0"}>
            {spriteImageUrl ? (
              <SpriteStripView spriteImageUrl={spriteImageUrl} />
            ) : null}
          </div>
          <button
            type="button"
            disabled={s3bRunning || !fourViewRawBase64 || !brief || s3Loading}
            onClick={() => void runAllAnimStates()}
            className={`${PIPELINE_PRIMARY} w-full max-w-md ${
              rc ? "mt-3 py-2 text-xs" : "mt-6 py-3"
            }`}
          >
            {s3bRunning ? "Generating…" : "Generate all animation states"}
          </button>
          {Object.keys(animErrors).length > 0 && (
            <p
              className={
                rc
                  ? "mt-2 text-[10px] leading-snug text-red-300/90"
                  : "mt-3 text-xs text-red-300/90"
              }
            >
              Some states failed — use the refresh on each state card or run all
              again.
            </p>
          )}
        </div>
      );
    },
    [
      stage3AOneLiner,
      s3Loading,
      s3bRunning,
      brief,
      interpretation,
      s3Error,
      fourViewRawBase64,
      spriteImageUrl,
      animErrors,
      runGenerate,
      runAllAnimStates,
    ],
  );

  const renderStage3BPanel = useCallback(
    (opts?: { railCompact?: boolean }) => {
      const rc = opts?.railCompact ?? false;
      return (
        <div className="flex min-w-0 flex-col">
          <div
            className={
              rc
                ? "grid w-full auto-rows-auto grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3"
                : "grid w-full auto-rows-auto grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-3"
            }
          >
            {ANIM_DISPLAY_ORDER.map((state) => {
              const phase = animStatePhase[state];
              const url = animStateUrls[state];
              const fourViewReady = Boolean(fourViewRawBase64 && brief);
              const showRetry = canShowAnimStateRetry(phase, fourViewReady);
              const retryDisabled = s3bRunning || phase === "loading";
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
              return (
                <div
                  key={state}
                  className={
                    rc
                      ? "flex h-fit min-h-0 w-full min-w-0 flex-col self-start overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/80 p-2"
                      : "flex h-fit min-h-0 w-full min-w-0 flex-col self-start overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/80 p-3"
                  }
                >
                  <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-neutral-800/60 pb-2">
                    <span
                      className={
                        rc
                          ? "font-mono text-xs capitalize text-neutral-200"
                          : "font-mono text-sm capitalize text-neutral-200"
                      }
                    >
                      {state === "custom" && customSpec
                        ? `${state} (${customSpec.stateName})`
                        : state}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                      <span
                        className={
                          rc
                            ? "text-[10px] text-neutral-500"
                            : "text-xs text-neutral-500"
                        }
                      >
                        {phase === "pending" && "Pending"}
                        {phase === "loading" && (
                          <span className="text-amber-200">Generating…</span>
                        )}
                        {phase === "done" && animStateApproved[state] && (
                          <span className="text-emerald-300">Confirmed</span>
                        )}
                        {phase === "error" && (
                          <span className="text-red-400">Failed</span>
                        )}
                      </span>
                      <div className="flex h-9 min-h-9 shrink-0 items-center gap-1">
                        {showRetry ? (
                          <button
                            type="button"
                            disabled={retryDisabled}
                            aria-label={`Regenerate ${state}`}
                            title="Regenerate this state"
                            onClick={() => void generateAnimState(state)}
                            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded border border-amber-700/50 bg-amber-950/40 text-amber-100 hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <RefreshIcon />
                          </button>
                        ) : null}
                        {phase === "done" && !animStateApproved[state] ? (
                          <button
                            type="button"
                            aria-label={`Confirm ${state} for map (next chamber)`}
                            title="Confirm for map (fills next chamber I / II / III)"
                            onClick={() => approveAnimState(state)}
                            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded border border-emerald-600/45 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40"
                          >
                            <CheckIcon />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex w-full shrink-0 items-center justify-center overflow-auto rounded-lg border border-neutral-700 p-2"
                    style={SPRITE_CHECKERBOARD_STYLE}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={`${state} sprite sheet`}
                        className="h-auto max-h-full w-full max-w-full object-contain bg-transparent"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <span
                        className={
                          rc
                            ? "p-4 text-[10px] text-neutral-600"
                            : "p-6 text-xs text-neutral-600"
                        }
                      >
                        {phase === "pending"
                          ? "Pending"
                          : phase === "loading"
                            ? "Generating…"
                            : "—"}
                      </span>
                    )}
                  </div>
                  {state === "custom" && customSpec && phase === "done" && (
                    <p
                      className={
                        rc
                          ? "mt-1.5 shrink-0 text-center text-[10px] leading-snug text-neutral-400"
                          : "mt-2 shrink-0 text-center text-xs leading-snug text-neutral-400"
                      }
                    >
                      {customSpec.description}
                    </p>
                  )}
                  <p
                    className={
                      rc
                        ? "mt-1.5 shrink-0 text-center text-[10px] text-neutral-500"
                        : "mt-2 shrink-0 text-center text-xs text-neutral-500"
                    }
                  >
                    {info ? (
                      <>
                        {info.frames} frames × {info.rows} rows · {info.w}×
                        {info.h}px
                      </>
                    ) : state === "custom" ? (
                      <span>Gemini chooses grid (SPEC)</span>
                    ) : (
                      ""
                    )}
                  </p>
                </div>
              );
            })}
          </div>
          {Object.keys(animErrors).length > 0 && (
            <p
              className={
                rc
                  ? "mt-2 text-[10px] leading-snug text-red-300/90"
                  : "mt-3 text-xs text-red-300/90"
              }
            >
              Some states failed — use the refresh on each state card or run all
              again from the 4-view card.
            </p>
          )}
        </div>
      );
    },
    [
      animStatePhase,
      animStateUrls,
      animStateApproved,
      animErrors,
      brief,
      fourViewRawBase64,
      customSpec,
      s3bRunning,
      generateAnimState,
      approveAnimState,
    ],
  );

  const showSaveFooter =
    interpretation &&
    brief &&
    spriteImageUrl &&
    fourViewRawBase64 &&
    previewUrl;

  const pipelineStageBody = useCallback(
    (stageId: PipelineOutputCardId, opts?: { railCompact?: boolean }) => {
      const rc = opts?.railCompact ?? false;
      const briefDlClass = rc
        ? "mt-3 space-y-2.5 text-[11px] leading-snug"
        : "mt-4 space-y-4 text-sm";
      const briefDtClass = rc
        ? "text-[10px] font-medium text-neutral-500"
        : "text-xs text-neutral-500";
      const briefDdClass = "text-neutral-200";
      const briefPillClass = rc
        ? "rounded-full border border-neutral-600 bg-neutral-800 px-2 py-0.5 text-[10px] text-amber-100/90"
        : "rounded-full border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs text-amber-100/90";
      const errBoxClass = rc
        ? "mt-3 rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-[11px] text-red-200"
        : "mt-4 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200";
      const primaryRailBtn = rc
        ? `${PIPELINE_PRIMARY} mt-4 w-full py-2 text-xs`
        : `${PIPELINE_PRIMARY} mt-6 w-full py-3`;

      switch (stageId) {
        case "scan":
          if (!previewUrl) return null;
          return (
            <>
              <img
                src={previewUrl}
                alt="Lite Brite scan"
                className="w-full rounded-lg border border-neutral-700 object-contain"
              />
              {s1Loading ? (
                <p
                  className={
                    rc
                      ? "mt-2 text-[10px] text-amber-200/90"
                      : "mt-3 text-xs text-amber-200/90"
                  }
                >
                  Interpreting scan…
                </p>
              ) : null}
              {s1Error ? (
                <div className={errBoxClass}>
                  <p className="font-medium">Stage 1 error</p>
                  <p className="mt-1 text-red-300/90">{s1Error}</p>
                  <button
                    type="button"
                    onClick={() => void runInterpret()}
                    aria-label="Retry stage 1: interpret scan"
                    title="Retry this step"
                    className="mt-3 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded bg-red-900/80 text-red-100 hover:bg-red-800"
                  >
                    <RefreshIcon />
                  </button>
                </div>
              ) : null}
            </>
          );
        case "interpretation":
          if (!interpretation) return null;
          return (
            <InterpretationDisplay
              interpretation={interpretation}
              omitSectionTitle
              compact={rc}
              className="border-0 bg-transparent p-0"
            >
              {!brief && (
                <button
                  type="button"
                  disabled={s2Loading}
                  onClick={() => void runBrief()}
                  className={primaryRailBtn}
                >
                  Generate character brief
                </button>
              )}
              {s2Error && (
                <div className={errBoxClass}>
                  <p className="font-medium">Stage 2 error</p>
                  <p className="mt-1">{s2Error}</p>
                  <button
                    type="button"
                    onClick={() => void runBrief()}
                    aria-label="Retry stage 2: character brief"
                    title="Retry this step"
                    className="mt-3 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded bg-red-900/80 text-red-100 hover:bg-red-800"
                  >
                    <RefreshIcon />
                  </button>
                </div>
              )}
            </InterpretationDisplay>
          );
        case "brief":
          if (!brief) return null;
          return (
            <>
              <div className={`flex flex-wrap ${rc ? "gap-1.5" : "gap-2"}`}>
                {briefColors.map((c, i) => (
                  <span key={`${c}-${i}`}>
                    <ColorChip color={c} />
                  </span>
                ))}
              </div>
              <dl className={briefDlClass}>
                <div>
                  <dt className={briefDtClass}>Hair</dt>
                  <dd className={briefDdClass}>
                    {brief.hair.style} — {brief.hair.description}
                  </dd>
                </div>
                <div>
                  <dt className={briefDtClass}>Face</dt>
                  <dd className={briefDdClass}>
                    {brief.face.expression}
                    {brief.face.markings
                      ? ` · ${brief.face.markings}`
                      : ""} — {brief.face.description}
                  </dd>
                </div>
                <div>
                  <dt className={briefDtClass}>Torso</dt>
                  <dd className={briefDdClass}>
                    {brief.torso.style} — {brief.torso.description}
                  </dd>
                </div>
                <div>
                  <dt className={briefDtClass}>Legs</dt>
                  <dd className={briefDdClass}>
                    {brief.legs.style} ({brief.legs.color}) —{" "}
                    {brief.legs.description}
                  </dd>
                </div>
                <div>
                  <dt className={briefDtClass}>Shoes</dt>
                  <dd className={briefDdClass}>
                    {brief.shoes.color} — {brief.shoes.description}
                  </dd>
                </div>
                <div>
                  <dt className={briefDtClass}>Skin tone</dt>
                  <dd className={`capitalize ${briefDdClass}`}>
                    {brief.skin_tone}
                  </dd>
                </div>
                <div>
                  <dt className={briefDtClass}>Theme elements</dt>
                  <dd
                    className={`mt-1 flex flex-wrap ${rc ? "gap-1.5" : "gap-2"}`}
                  >
                    {brief.theme_elements.map((t) => (
                      <span key={t} className={briefPillClass}>
                        {t}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
              {!spriteImageUrl && (
                <button
                  type="button"
                  disabled={s3Loading}
                  onClick={() => void runGenerate()}
                  className={primaryRailBtn}
                >
                  Generate sprite
                </button>
              )}
              {s3Error && (
                <div className={errBoxClass}>
                  <p className="font-medium">Stage 3A error</p>
                  <p className="mt-1">{s3Error}</p>
                  <button
                    type="button"
                    onClick={() => void runGenerate()}
                    aria-label="Retry stage 3A: generate sprite"
                    title="Retry this step"
                    className="mt-3 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded bg-red-900/80 text-red-100 hover:bg-red-800"
                  >
                    <RefreshIcon />
                  </button>
                </div>
              )}
            </>
          );
        case "stage3a":
          if (!spriteImageUrl || !fourViewRawBase64) return null;
          return renderStage3AFourViewCard({
            embedded: true,
            railCompact: rc,
          });
        case "stage3b":
          if (
            !stage3bPanelVisible ||
            !fourViewRawBase64 ||
            !brief ||
            !spriteImageUrl
          ) {
            return null;
          }
          return renderStage3BPanel({ railCompact: rc });
        default:
          return null;
      }
    },
    [
      previewUrl,
      s1Loading,
      s1Error,
      interpretation,
      brief,
      briefColors,
      spriteImageUrl,
      fourViewRawBase64,
      s3Loading,
      s3Error,
      stage3bPanelVisible,
      s2Loading,
      s2Error,
      runInterpret,
      runBrief,
      runGenerate,
      renderStage3AFourViewCard,
      renderStage3BPanel,
    ],
  );

  const stageMainBody = useMemo(
    () => pipelineStageBody(activePipelineCardId),
    [activePipelineCardId, pipelineStageBody],
  );

  const stageMainPanelEl = (
    <PipelineStageMainPanel title={PIPELINE_STAGE_TITLES[activePipelineCardId]}>
      {stageMainBody}
    </PipelineStageMainPanel>
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-[1600px] px-4 py-8 md:px-8">
        <header className="mb-6 border-b border-neutral-800 pb-6">
          <h1 className="font-google-sans-code text-2xl font-bold tracking-tight text-white">
            Character pipeline
          </h1>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
            <ol className="flex min-w-0 flex-1 flex-wrap gap-4 text-sm">
              <li
                className={`rounded-lg border px-4 py-2 ${
                  s1Loading
                    ? "border-amber-500/60 bg-amber-950/40 text-amber-100"
                    : interpretation
                      ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-100"
                      : "border-neutral-700 bg-neutral-900 text-neutral-400"
                }`}
              >
                Stage 1: {s1Loading ? "Interpreting scan…" : "Interpret scan"}
              </li>
              <li
                className={`rounded-lg border px-4 py-2 ${
                  s2Loading
                    ? "border-amber-500/60 bg-amber-950/40 text-amber-100"
                    : brief
                      ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-100"
                      : "border-neutral-700 bg-neutral-900 text-neutral-400"
                }`}
              >
                Stage 2:{" "}
                {s2Loading ? "Designing character…" : "Character brief"}
              </li>
              <li
                className={`rounded-lg border px-4 py-2 ${
                  s3Loading
                    ? "border-amber-500/60 bg-amber-950/40 text-amber-100"
                    : spriteImageUrl
                      ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-100"
                      : "border-neutral-700 bg-neutral-900 text-neutral-400"
                }`}
              >
                Stage 3A:{" "}
                {s3Loading ? "Generating sprite…" : "4-view character"}
              </li>
              <li
                className={`rounded-lg border px-4 py-2 ${
                  s3bRunning
                    ? "border-amber-500/60 bg-amber-950/40 text-amber-100"
                    : stage3bPanelVisible ||
                        Object.values(animStatePhase).some((p) => p === "done")
                      ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-100"
                      : "border-neutral-700 bg-neutral-900 text-neutral-400"
                }`}
              >
                Stage 3B:{" "}
                {s3bRunning
                  ? "Animation states…"
                  : "Spritesheet animation states"}
              </li>
            </ol>
            {(showSaveFooter || interpretation) && (
              <div className="flex shrink-0 flex-wrap items-start justify-end gap-3 lg:max-w-[min(100%,28rem)] lg:pt-0.5">
                {showSaveFooter ? (
                  <SaveToMapBlock
                    alignEnd
                    saveState={saveState}
                    savedId={savedId}
                    s3bRunning={s3bRunning}
                    onSave={() => void handleSave()}
                    disabled={
                      saveState === "saving" ||
                      saveState === "saved" ||
                      !interpretation ||
                      !brief ||
                      !fourViewRawBase64 ||
                      s3bRunning ||
                      !stage3bComplete ||
                      !allAnimStatesApproved
                    }
                    title={
                      saveState === "saving"
                        ? "Saving…"
                        : saveState === "saved"
                          ? "Already saved for this run"
                          : s3bRunning || !stage3bComplete
                            ? "Finish all Stage 3B states (idle, walk, custom), then you can save to the map"
                            : !allAnimStatesApproved
                              ? "Confirm all three animation rows with the check buttons before saving"
                              : undefined
                    }
                  />
                ) : null}
                <button
                  type="button"
                  onClick={tryAnother}
                  className={`${PIPELINE_PRIMARY} px-6 py-3`}
                  disabled={!hasImage && !previewUrl && !interpretation}
                >
                  Try another scan
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="flex flex-col gap-6">
          {showPipelineInput ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)] lg:items-start">
              <div className="min-w-0 w-full self-start">
                <PipelineInputSection
                  previewUrl={previewUrl}
                  onFileChange={(e) => void onFile(e)}
                  onSelectTest={(url) => void selectTest(url)}
                  disabled={s1Loading}
                >
                  <button
                    type="button"
                    disabled={!hasImage || s1Loading}
                    onClick={() => void runInterpret()}
                    className={`${PIPELINE_PRIMARY} px-4 py-3 transition disabled:cursor-not-allowed`}
                  >
                    Run pipeline
                  </button>
                  {s1Error && (
                    <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
                      <p className="font-medium">Stage 1 error</p>
                      <p className="mt-1 text-red-300/90">{s1Error}</p>
                      <button
                        type="button"
                        onClick={() => void runInterpret()}
                        aria-label="Retry stage 1: interpret scan"
                        title="Retry this step"
                        className="mt-3 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded bg-red-900/80 text-red-100 hover:bg-red-800"
                      >
                        <RefreshIcon />
                      </button>
                    </div>
                  )}
                </PipelineInputSection>
              </div>
              <div className="min-w-0 self-start" />
            </div>
          ) : previewUrl && visibleStages.length > 0 ? (
            dockedStages.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] lg:items-start">
                <aside className="flex min-w-0 flex-col gap-6 self-start">
                  {dockedStages.map((id) => (
                    <div key={id} className="min-w-0">
                      <PipelineStageLeftRailCard
                        title={PIPELINE_STAGE_TITLES[id]}
                        expanded={Boolean(leftRailExpanded[id])}
                        onToggleExpanded={() =>
                          setLeftRailExpanded((prev) => ({
                            ...prev,
                            [id]: !prev[id],
                          }))
                        }
                      >
                        {pipelineStageBody(id, { railCompact: true })}
                      </PipelineStageLeftRailCard>
                    </div>
                  ))}
                </aside>
                <div className="min-w-0 self-start">{stageMainPanelEl}</div>
              </div>
            ) : (
              <div className="min-w-0 self-start">{stageMainPanelEl}</div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
