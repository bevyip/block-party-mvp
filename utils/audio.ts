// Simple audio synth for retro effects
let audioCtx: AudioContext | null = null;

/** When true, map/eating SFX are muted during Add-to-Party overlay. Set by AddToPartyOverlay. */
let spritePartyOverlayActive = false;

/** When true, map boops/spawn/eating are muted during the full map translation sequence. Set by MapOverlay. */
let pipelineDetectionOverlayActive = false;

export const setSpritePartyOverlayActive = (active: boolean) => {
  spritePartyOverlayActive = active;
};

/** Mutes map ambient SFX for the whole translation sequence (not only detection). */
export const setPipelineDetectionMapAudioSuppressed = (active: boolean) => {
  pipelineDetectionOverlayActive = active;
};

/** Map spawn, eating, chirps — muted during sprite-add overlay. */
export function isMapAmbientAudioSuppressed(): boolean {
  return spritePartyOverlayActive || pipelineDetectionOverlayActive;
}

const getAudioContext = () => {
  if (!audioCtx) {
    audioCtx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
  }
  return audioCtx;
};

function resumeCtx(ctx: AudioContext) {
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
}

export const playBlip = (pitch: number = 1.0) => {
  if (isMapAmbientAudioSuppressed()) return;
  try {
    const ctx = getAudioContext();
    resumeCtx(ctx);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // Randomize pitch slightly for variety
    const baseFreq = 400 + Math.random() * 200;
    osc.frequency.setValueAtTime(baseFreq * pitch, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      baseFreq * pitch * 2,
      ctx.currentTime + 0.1,
    );

    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    // Audio might be blocked or not supported
    console.warn("Audio play failed", e);
  }
};

export const playChirp = () => {
  if (isMapAmbientAudioSuppressed()) return;
  try {
    const ctx = getAudioContext();
    resumeCtx(ctx);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.05);
    osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.025, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch (e) {
    // Audio might be blocked or not supported
    console.warn("Audio play failed", e);
  }
};

/** Spawn sound — duration matches the ~1s fall; louder so it’s heard above blips. */
const SPAWN_DURATION = 1.0;

export const playSpawn = () => {
  if (isMapAmbientAudioSuppressed()) return;
  try {
    const ctx = getAudioContext();
    resumeCtx(ctx);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;

    osc.type = "sine";
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(260, t0 + SPAWN_DURATION * 0.5);
    osc.frequency.setValueAtTime(260, t0 + SPAWN_DURATION * 0.5);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + SPAWN_DURATION);

    gain.gain.setValueAtTime(0.22, t0);
    gain.gain.linearRampToValueAtTime(0.095, t0 + SPAWN_DURATION * 0.4);
    gain.gain.setValueAtTime(0.095, t0 + SPAWN_DURATION * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.01, t0 + SPAWN_DURATION);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(t0 + SPAWN_DURATION);
  } catch (e) {
    console.warn("Audio play failed", e);
  }
};

/** Legacy apple reaction sound used by the map engine. */
export const playEatingSound = () => {
  if (isMapAmbientAudioSuppressed()) return;
  try {
    const audio = new Audio("/sounds/eating.mp3");
    audio.volume = 0.025;
    audio.play().catch(() => {});
  } catch (e) {
    console.warn("Audio play failed", e);
  }
};

// --- Background map music (single looping track, module singleton) ---

const BGM_URL = "/sounds/background-music.mp3";
/** Normal map view (sprites / apples audible). */
const BGM_GAIN_MAP_VIEW = 0.05;
/** While the map translation overlay is up — room for detecting / alert / typing SFX. */
const BGM_GAIN_TRANSLATION_OVERLAY = 0.022;

let bgmAudio: HTMLAudioElement | null = null;
let bgmGainNode: GainNode | null = null;

/** When true, map page translation sequence is showing (`overlayPhase !== "hidden"`). */
let mapTranslationBgmDucked = false;

let bgmGestureWakeListenersInstalled = false;
let bgmGestureWakeAc: AbortController | null = null;

function currentBgmGainTarget(): number {
  return mapTranslationBgmDucked
    ? BGM_GAIN_TRANSLATION_OVERLAY
    : BGM_GAIN_MAP_VIEW;
}

/**
 * Ducks map BGM while the translation overlay is visible; restores when the map is
 * fully unobstructed again. Safe before the graph exists (no-op until BGM inits).
 */
export function setMapTranslationBgmDucked(ducked: boolean) {
  mapTranslationBgmDucked = ducked;
  applyBgmOutputLevel();
}

function applyBgmOutputLevel() {
  if (!bgmAudio || !bgmGainNode) return;
  try {
    bgmAudio.volume = 1;
    const ctx = getAudioContext();
    const g = bgmGainNode.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(currentBgmGainTarget(), now);
  } catch {
    // ignore
  }
}

/**
 * Browsers block `HTMLAudioElement.play()` until a user gesture. Installed from
 * `startBackgroundMapMusic`; pointer/key retry `wakeBackgroundMusicIfPausedInUserGesture`.
 */
function registerBackgroundMusicGestureWakeListenersOnce() {
  if (typeof window === "undefined" || bgmGestureWakeListenersInstalled) return;
  bgmGestureWakeListenersInstalled = true;
  const ac = new AbortController();
  bgmGestureWakeAc = ac;
  const onGesture = () => {
    wakeBackgroundMusicIfPausedInUserGesture();
  };
  const opts: AddEventListenerOptions = {
    capture: true,
    once: true,
    signal: ac.signal,
  };
  window.addEventListener("pointerdown", onGesture, opts);
  window.addEventListener("keydown", onGesture, opts);
}

/** Call from map one-shots while handling a user input so BGM can start in the same gesture. */
function wakeBackgroundMusicIfPausedInUserGesture() {
  if (!ensureBackgroundMusicGraph() || !bgmAudio || !bgmGainNode) return;
  if (!bgmAudio.paused) return;
  try {
    applyBgmOutputLevel();
    const ctx = getAudioContext();
    resumeCtx(ctx);
    void bgmAudio.play().catch(() => {});
  } catch {
    // autoplay policy — gesture unlock will retry
  }
}

function ensureBackgroundMusicGraph(): boolean {
  if (bgmGainNode && bgmAudio) return true;
  try {
    const ctx = getAudioContext();
    const el = new Audio(BGM_URL);
    el.loop = true;
    el.preload = "auto";
    el.volume = 1;
    const source = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(ctx.destination);
    bgmAudio = el;
    bgmGainNode = gain;
    applyBgmOutputLevel();
    registerBackgroundMusicGestureWakeListenersOnce();
    return true;
  } catch (e) {
    console.warn("Background music graph init failed", e);
    return false;
  }
}

/**
 * Start or resume the single map BGM instance (MapPage mount). Idempotent: does not
 * stack another track; reapplies gain; installs gesture wake listeners if needed.
 */
export function startBackgroundMapMusic() {
  if (!ensureBackgroundMusicGraph() || !bgmAudio) return;
  registerBackgroundMusicGestureWakeListenersOnce();
  applyBgmOutputLevel();
  try {
    const ctx = getAudioContext();
    resumeCtx(ctx);
    if (bgmAudio.paused) {
      void bgmAudio.play().catch(() => {
        // Expected without a user gesture; pointer/key listeners will retry.
      });
    }
  } catch (e) {
    console.warn("Background music play failed", e);
  }
}

/**
 * Pause BGM when leaving the map route. Does not reset playback position or remove
 * gesture wake listeners — `startBackgroundMapMusic` on the next visit resumes the
 * same loop. Resets translation duck so gain is not left ducked across sessions.
 */
export function pauseBackgroundMapMusic() {
  mapTranslationBgmDucked = false;
  try {
    applyBgmOutputLevel();
    if (bgmAudio) {
      bgmAudio.pause();
    }
  } catch {
    // ignore
  }
}

/** @deprecated Prefer `pauseBackgroundMapMusic` — same function, kept for MapPage. */
export const stopBackgroundMapMusic = pauseBackgroundMapMusic;

// --- Map translation overlay one-shots / loops (HTMLAudioElement) ---

const TRANSLATION_SFX_VOLUME = 0.3;
const TRANSLATION_DETECTING_VOLUME = 0.7;
const TRANSLATION_DETECTING_URL = "/sounds/detecting.mp3";
const TRANSLATION_ALERT_URL = "/sounds/alert.mp3";
const TRANSLATION_TYPING_URL = "/sounds/typing.mp3";

let translationDetectingAudio: HTMLAudioElement | null = null;
let translationTypingAudio: HTMLAudioElement | null = null;
let translationTypingSfxRefCount = 0;

function ensureTranslationDetectingAudio(): HTMLAudioElement {
  if (!translationDetectingAudio) {
    const el = new Audio(TRANSLATION_DETECTING_URL);
    el.preload = "auto";
    el.loop = true;
    el.volume = TRANSLATION_DETECTING_VOLUME;
    translationDetectingAudio = el;
  }
  return translationDetectingAudio;
}

/** Looping scan-line ambience for the detection flash (caller stops when the sweep ends). */
export function startTranslationDetectingSfx() {
  try {
    wakeBackgroundMusicIfPausedInUserGesture();
    const el = ensureTranslationDetectingAudio();
    el.currentTime = 0;
    void el.play().catch(() => {});
  } catch {
    // ignore
  }
}

export function stopTranslationDetectingSfx() {
  try {
    if (translationDetectingAudio) {
      translationDetectingAudio.pause();
      translationDetectingAudio.currentTime = 0;
    }
  } catch {
    // ignore
  }
}

/** One-shot when the “NEW INPUT DETECTED” title beat begins. */
export function playTranslationAlertSfx() {
  try {
    wakeBackgroundMusicIfPausedInUserGesture();
    const el = new Audio(TRANSLATION_ALERT_URL);
    el.volume = TRANSLATION_SFX_VOLUME;
    void el.play().catch(() => {});
  } catch {
    // ignore
  }
}

function ensureTranslationTypingAudio(): HTMLAudioElement {
  if (!translationTypingAudio) {
    const el = new Audio(TRANSLATION_TYPING_URL);
    el.preload = "auto";
    el.loop = true;
    el.volume = TRANSLATION_SFX_VOLUME;
    translationTypingAudio = el;
  }
  return translationTypingAudio;
}

/**
 * While at least one `DecryptedText` with `playTypingSound` is in active sequential
 * forward decrypt, loops typing.mp3; ends immediately when the last one stops.
 */
export function beginTranslationTypingSfx() {
  translationTypingSfxRefCount += 1;
  if (translationTypingSfxRefCount !== 1) return;
  try {
    wakeBackgroundMusicIfPausedInUserGesture();
    const el = ensureTranslationTypingAudio();
    el.currentTime = 0;
    void el.play().catch(() => {
      translationTypingSfxRefCount = Math.max(
        0,
        translationTypingSfxRefCount - 1,
      );
    });
  } catch {
    translationTypingSfxRefCount = Math.max(
      0,
      translationTypingSfxRefCount - 1,
    );
  }
}

export function endTranslationTypingSfx() {
  translationTypingSfxRefCount = Math.max(0, translationTypingSfxRefCount - 1);
  if (translationTypingSfxRefCount > 0) return;
  try {
    if (translationTypingAudio) {
      translationTypingAudio.pause();
      translationTypingAudio.currentTime = 0;
    }
  } catch {
    // ignore
  }
}
