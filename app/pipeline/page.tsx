import React, { useCallback, useMemo, useState } from "react";
import { ColorChip } from "../../components/ColorChip";
import { InterpretationDisplay } from "../../components/InterpretationDisplay";
import { PipelineInputSection } from "../../components/PipelineInputSection";
import { generateStage3AImage } from "../../lib/pipelineStage3A";
import { removeBackground } from "../../lib/removeBackground";
import {
  SpriteStripView,
  SPRITE_CHECKERBOARD_STYLE,
} from "../../components/SpriteStripView";
import type { CustomStateSpec } from "../../lib/generatedSprites";
import type { AnimState, DesignBrief, Interpretation } from "./types";

const PEG_HEX: Record<string, string> = {
  pink: "#ff5ecb",
  red: "#e81c2a",
  blue: "#1a6fff",
  green: "#0a7d32",
  yellow: "#ffe600",
  white: "#f0f0f0",
  orange: "#ff8c00",
  "#ff5ecb": "#ff5ecb",
  "#e81c2a": "#e81c2a",
  "#1a6fff": "#1a6fff",
  "#0a7d32": "#0a7d32",
  "#ffe600": "#ffe600",
  "#f0f0f0": "#f0f0f0",
  "#ff8c00": "#ff8c00",
};

function resolveSwatchHex(raw: string): string | null {
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  const key = s.toLowerCase();
  if (PEG_HEX[key]) return PEG_HEX[key];
  return null;
}

function uniqueColors(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const hex = resolveSwatchHex(c) ?? c;
    const k = hex.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(resolveSwatchHex(c) ?? c);
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

function canShowAnimStateRetry(
  phase: "pending" | "loading" | "done" | "error",
  fourViewReady: boolean,
): boolean {
  return fourViewReady && (phase === "done" || phase === "error");
}

function SaveToMapBlock({
  saveState,
  savedId,
  s3bRunning,
  onSave,
  disabled,
  title,
}: {
  saveState: "idle" | "saving" | "saved" | "error";
  savedId: string | null;
  s3bRunning: boolean;
  onSave: () => void;
  disabled: boolean;
  title?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        title={title}
        className="rounded-lg bg-emerald-800 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        {saveState === "idle" && "Save to Map"}
        {saveState === "saving" && "Saving..."}
        {saveState === "saved" && "Saved to Map ✅"}
        {saveState === "error" && "Save failed — retry"}
      </button>
      {saveState === "saved" && (
        <div className="mt-2 max-w-sm space-y-1 text-center text-xs text-emerald-200/90">
          <p>
            Your character will spawn at the bridge next time the map loads.
          </p>
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

  const [s1Loading, setS1Loading] = useState(false);
  const [s2Loading, setS2Loading] = useState(false);
  const [s3Loading, setS3Loading] = useState(false);
  const [s3bRunning, setS3bRunning] = useState(false);

  const [s1Error, setS1Error] = useState<string | null>(null);
  const [s2Error, setS2Error] = useState<string | null>(null);
  const [s3Error, setS3Error] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [savedId, setSavedId] = useState<string | null>(null);

  const hasImage = Boolean(imageBase64 && mimeType);
  const pipelineComplete = interpretation && brief && spriteImageUrl;
  const stage3bComplete = ANIM_ORDER.every((s) => animStatePhase[s] === "done");

  const selectTest = useCallback(async (url: string) => {
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
      setInterpretation(data.interpretation);
      setBrief(null);
      setSpriteImageUrl(null);
      setFourViewRawBase64(null);
      setAnimStateUrls(emptyAnimUrls());
      setAnimStatePhase(emptyAnimPhase());
      setAnimErrors({});
      setCustomSpec(null);
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
      setSpriteImageUrl(null);
      setFourViewRawBase64(null);
      setAnimStateUrls(emptyAnimUrls());
      setAnimStatePhase(emptyAnimPhase());
      setAnimErrors({});
      setCustomSpec(null);
      setS3Error(null);
    } catch (e) {
      setS2Error(e instanceof Error ? e.message : "Stage 2 failed");
    } finally {
      setS2Loading(false);
    }
  }, [interpretation]);

  const runGenerate = useCallback(async () => {
    if (!brief || !interpretation) return;
    setS3Loading(true);
    setS3Error(null);
    try {
      const { rawBase64, cleanedDataUrl } = await generateStage3AImage(
        brief,
        interpretation,
      );
      setFourViewRawBase64(rawBase64);
      setSpriteImageUrl(cleanedDataUrl);
      setAnimStateUrls(emptyAnimUrls());
      setAnimStatePhase(emptyAnimPhase());
      setAnimErrors({});
      setCustomSpec(null);
      setSaveState("idle");
      setSavedId(null);
    } catch (e) {
      setS3Error(e instanceof Error ? e.message : "Stage 3 failed");
    } finally {
      setS3Loading(false);
    }
  }, [brief, interpretation]);

  const tryAnother = useCallback(() => {
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
    setS1Error(null);
    setS2Error(null);
    setS3Error(null);
    setS3bRunning(false);
    setSaveState("idle");
    setSavedId(null);
  }, []);

  const handleSave = useCallback(async () => {
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
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSavedId(data.id ?? null);
      setSaveState("saved");
    } catch (err) {
      console.error(err);
      setSaveState("error");
    }
  }, [interpretation, brief, fourViewRawBase64, animStateUrls, customSpec]);

  const generateAnimState = useCallback(
    async (state: AnimState) => {
      if (!fourViewRawBase64 || !brief) return;
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
    [fourViewRawBase64, brief, interpretation?.object],
  );

  const runAllAnimStates = useCallback(async () => {
    if (!fourViewRawBase64 || !brief) return;
    setS3bRunning(true);
    try {
      for (const state of ANIM_ORDER) {
        await generateAnimState(state);
      }
    } finally {
      setS3bRunning(false);
    }
  }, [fourViewRawBase64, brief, generateAnimState]);

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

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-[1600px] px-4 py-8 md:px-8">
        <header className="mb-8 border-b border-neutral-800 pb-6">
          <h1 className="font-google-sans-code text-2xl font-bold tracking-tight text-white">
            Character pipeline
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Lite Brite scan → interpretation → design brief → pixel sprite
            (Gemini). End-to-end generation tooling.
          </p>
        </header>

        {/* Progress */}
        <ol className="mb-8 flex flex-wrap gap-4 text-sm">
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
            Stage 2: {s2Loading ? "Designing character…" : "Character brief"}
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
            Stage 3A: {s3Loading ? "Generating sprite…" : "4-view character"}
          </li>
          <li
            className={`rounded-lg border px-4 py-2 ${
              s3bRunning
                ? "border-amber-500/60 bg-amber-950/40 text-amber-100"
                : Object.values(animStatePhase).some((p) => p === "done")
                  ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-100"
                  : "border-neutral-700 bg-neutral-900 text-neutral-400"
            }`}
          >
            Stage 3B:{" "}
            {s3bRunning
              ? "Animation states…"
              : "Spritesheet states (idle, walk, …)"}
          </li>
        </ol>

        {!pipelineComplete && (
          <div className="flex flex-col gap-10">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
              {/* Left: input */}
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
                  className="rounded-lg bg-amber-600 px-4 py-3 text-sm font-semibold text-black transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
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
                      className="mt-3 rounded bg-red-900/80 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-800"
                    >
                      Retry this step
                    </button>
                  </div>
                )}
              </PipelineInputSection>

              {/* Right: staged outputs */}
              <div className="flex flex-col gap-8">
                {interpretation && (
                  <InterpretationDisplay interpretation={interpretation}>
                    {!brief && (
                      <button
                        type="button"
                        disabled={s2Loading}
                        onClick={() => void runBrief()}
                        className="mt-6 w-full rounded-lg bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                      >
                        Generate character brief
                      </button>
                    )}
                    {s2Error && (
                      <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
                        <p className="font-medium">Stage 2 error</p>
                        <p className="mt-1">{s2Error}</p>
                        <button
                          type="button"
                          onClick={() => void runBrief()}
                          className="mt-3 rounded bg-red-900/80 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-800"
                        >
                          Retry this step
                        </button>
                      </div>
                    )}
                  </InterpretationDisplay>
                )}

                {brief && (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
                    <SectionTitle>Character brief</SectionTitle>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {briefColors.map((c, i) => (
                        <span key={`${c}-${i}`}>
                          <ColorChip color={c} />
                        </span>
                      ))}
                    </div>
                    <dl className="mt-4 space-y-4 text-sm">
                      <div>
                        <dt className="text-xs text-neutral-500">Hair</dt>
                        <dd className="text-neutral-200">
                          {brief.hair.style} — {brief.hair.description}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-neutral-500">Face</dt>
                        <dd className="text-neutral-200">
                          {brief.face.expression}
                          {brief.face.markings
                            ? ` · ${brief.face.markings}`
                            : ""}{" "}
                          — {brief.face.description}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-neutral-500">Torso</dt>
                        <dd className="text-neutral-200">
                          {brief.torso.style} — {brief.torso.description}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-neutral-500">
                          Legs & shoes
                        </dt>
                        <dd className="text-neutral-200">
                          {brief.legs.style} ({brief.legs.color}) —{" "}
                          {brief.legs.description}
                          <br />
                          Shoes: {brief.shoes.color} — {brief.shoes.description}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-neutral-500">Skin tone</dt>
                        <dd className="capitalize text-neutral-200">
                          {brief.skin_tone}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-neutral-500">
                          Theme elements
                        </dt>
                        <dd className="mt-1 flex flex-wrap gap-2">
                          {brief.theme_elements.map((t) => (
                            <span
                              key={t}
                              className="rounded-full border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs text-amber-100/90"
                            >
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
                        className="mt-6 w-full rounded-lg bg-cyan-700 py-3 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
                      >
                        Generate sprite
                      </button>
                    )}
                    {s3Error && (
                      <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
                        <p className="font-medium">Stage 3 error</p>
                        <p className="mt-1">{s3Error}</p>
                        <button
                          type="button"
                          onClick={() => void runGenerate()}
                          className="mt-3 rounded bg-red-900/80 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-800"
                        >
                          Retry this step
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {spriteImageUrl && (
              <section className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 md:p-6">
                <SectionTitle>Sprite preview</SectionTitle>
                <div className="mt-4">
                  <SpriteStripView spriteImageUrl={spriteImageUrl} />
                </div>
              </section>
            )}
          </div>
        )}

        {pipelineComplete &&
          previewUrl &&
          interpretation &&
          brief &&
          spriteImageUrl && (
            <div className="space-y-8">
              <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 md:p-6">
                <SectionTitle>Generating animation states</SectionTitle>
                <p className="mt-2 text-xs text-neutral-500">
                  Uses Stage 3A output as style anchor + pose reference PNGs per
                  state. Background removal matches Stage 3A (client-side).
                </p>
                <div className="mt-4 space-y-3">
                  {ANIM_DISPLAY_ORDER.map((state) => {
                    const phase = animStatePhase[state];
                    const fourViewReady = Boolean(fourViewRawBase64 && brief);
                    const showRetry = canShowAnimStateRetry(
                      phase,
                      fourViewReady,
                    );
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
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2"
                      >
                        <span className="w-20 font-mono text-sm capitalize text-neutral-200">
                          {state}
                        </span>
                        <span className="text-neutral-500">
                          {phase === "pending" && "Pending"}
                          {phase === "loading" && (
                            <span className="text-amber-200">Generating…</span>
                          )}
                          {phase === "done" && (
                            <span className="text-emerald-400">Done</span>
                          )}
                          {phase === "error" && (
                            <span className="text-red-400">Failed</span>
                          )}
                        </span>
                        {animStateUrls[state] && (
                          <img
                            src={animStateUrls[state]!}
                            alt={`${state} sheet`}
                            className="h-12 w-auto max-w-[120px] border border-neutral-700 bg-neutral-900 object-contain"
                            style={{ imageRendering: "pixelated" }}
                          />
                        )}
                        {showRetry && (
                          <button
                            type="button"
                            disabled={retryDisabled}
                            aria-label={`Regenerate ${state} (API)`}
                            title="Regenerate this state"
                            onClick={() => void generateAnimState(state)}
                            className="shrink-0 rounded border border-amber-700/50 bg-amber-950/40 px-2 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/60 disabled:opacity-40"
                          >
                            Retry
                          </button>
                        )}
                        <div className="ml-auto flex min-w-0 flex-1 flex-col items-end gap-0.5 text-xs text-neutral-500">
                          {state === "custom" &&
                            phase === "done" &&
                            customSpec && (
                              <>
                                <span className="font-mono text-amber-100/90">
                                  {customSpec.stateName}
                                </span>
                                <span className="max-w-md text-right text-[11px] leading-snug text-neutral-400">
                                  {customSpec.description}
                                </span>
                              </>
                            )}
                          {info ? (
                            <span>
                              {info.frames} frames × {info.rows} rows · {info.w}
                              ×{info.h}px
                            </span>
                          ) : state === "custom" ? (
                            <span>Gemini chooses grid (SPEC)</span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={
                    s3bRunning || !fourViewRawBase64 || !brief || s3Loading
                  }
                  onClick={() => void runAllAnimStates()}
                  className="mt-4 rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-600 disabled:opacity-40"
                >
                  {s3bRunning ? "Generating…" : "Generate all animation states"}
                </button>
                {Object.keys(animErrors).length > 0 && (
                  <p className="mt-2 text-xs text-red-300/90">
                    Some states failed — use Retry beside each row’s preview or
                    run all again.
                  </p>
                )}
                {ANIM_ORDER.some((s) => animStatePhase[s] === "done") && (
                  <p className="mt-2 text-xs text-neutral-500">
                    Retry beside each state (after the thumbnail) calls the API
                    again for that state only — success or failure.
                  </p>
                )}
              </section>

              <div className="grid gap-6 xl:grid-cols-3 xl:items-start">
                <div className="flex flex-col gap-6">
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                    <SectionTitle>Original scan</SectionTitle>
                    <img
                      src={previewUrl}
                      alt="Lite Brite scan"
                      className="mt-4 w-full rounded-lg border border-neutral-700 object-contain"
                    />
                  </div>
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                    <SectionTitle>Character brief</SectionTitle>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {briefColors.map((c, i) => (
                        <span key={`${c}-${i}`}>
                          <ColorChip color={c} />
                        </span>
                      ))}
                    </div>
                    <p className="mt-4 text-sm text-neutral-300">
                      {brief.hair.description}
                    </p>
                    <p className="mt-2 text-sm text-neutral-300">
                      {brief.face.description}
                    </p>
                    <p className="mt-2 text-sm text-neutral-300">
                      {brief.torso.description}
                    </p>
                    <p className="mt-2 text-sm text-neutral-300">
                      {brief.legs.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {brief.theme_elements.map((t) => (
                        <span
                          key={t}
                          className="rounded-full border border-neutral-600 bg-neutral-800 px-3 py-1 text-xs text-amber-100/90"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 md:p-6">
                  <SectionTitle>4-view character (Stage 3A)</SectionTitle>
                  <p className="mt-2 text-sm text-neutral-400">
                    {stage3AOneLiner}
                  </p>
                  <div className="mt-4">
                    <SpriteStripView spriteImageUrl={spriteImageUrl} />
                  </div>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                  <SectionTitle>Animation states (Stage 3B)</SectionTitle>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {ANIM_DISPLAY_ORDER.map((state) => {
                      const url = animStateUrls[state];
                      const fixedInfo =
                        state === "idle" || state === "walk"
                          ? STATE_SHEET_INFO[state]
                          : null;
                      const customDims =
                        state === "custom" && customSpec
                          ? {
                              frames: customSpec.frameCount,
                              w: customSpec.frameCount * 64,
                              h: customSpec.directionRows * 64,
                            }
                          : null;
                      const info = fixedInfo ?? customDims;
                      return (
                        <div
                          key={state}
                          className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-2"
                        >
                          <p className="mb-2 text-center text-xs font-medium capitalize text-neutral-300">
                            {state === "custom" && customSpec
                              ? `${state} (${customSpec.stateName})`
                              : state}
                          </p>
                          <div
                            className="mx-auto flex min-h-[80px] items-center justify-center overflow-hidden rounded border border-neutral-700"
                            style={SPRITE_CHECKERBOARD_STYLE}
                          >
                            {url ? (
                              <img
                                src={url}
                                alt={`${state}`}
                                className="max-h-40 w-auto origin-top scale-[2] bg-transparent"
                                style={{ imageRendering: "pixelated" }}
                              />
                            ) : (
                              <span className="p-4 text-xs text-neutral-600">
                                {animStatePhase[state] === "pending"
                                  ? "Pending"
                                  : "—"}
                              </span>
                            )}
                          </div>
                          {state === "custom" &&
                            customSpec &&
                            animStatePhase[state] === "done" && (
                              <p className="mt-1 px-1 text-center text-[10px] leading-snug text-neutral-400">
                                {customSpec.description}
                              </p>
                            )}
                          <p className="mt-2 text-center text-[10px] text-neutral-500">
                            {info
                              ? `${info.frames} frames · ${info.w}×${info.h}px`
                              : state === "custom"
                                ? "—"
                                : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-start justify-center gap-4">
                <SaveToMapBlock
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
                    !stage3bComplete
                  }
                  title={
                    saveState === "saving"
                      ? "Saving…"
                      : saveState === "saved"
                        ? "Already saved for this run"
                        : s3bRunning || !stage3bComplete
                          ? "Finish all Stage 3B states (idle, walk, custom), then you can save to the map"
                          : undefined
                  }
                />
                <button
                  type="button"
                  onClick={tryAnother}
                  className="rounded-lg border border-neutral-600 bg-neutral-800 px-6 py-3 text-sm font-semibold text-neutral-100 hover:bg-neutral-700"
                >
                  Try another scan
                </button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
