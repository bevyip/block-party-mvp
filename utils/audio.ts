// Simple audio synth for retro effects
let audioCtx: AudioContext | null = null;

const getAudioContext = () => {
  if (!audioCtx) {
    audioCtx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
  }
  return audioCtx;
};

export const playBlip = (pitch: number = 1.0) => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        // Audio might be blocked by browser policy
        console.warn("Audio context resume failed");
      });
    }

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

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

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
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        // Audio might be blocked by browser policy
        console.warn("Audio context resume failed");
      });
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.05);
    osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.05, ctx.currentTime);
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
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        console.warn("Audio context resume failed");
      });
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;

    osc.type = "sine";
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(260, t0 + SPAWN_DURATION * 0.5);
    osc.frequency.setValueAtTime(260, t0 + SPAWN_DURATION * 0.5);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + SPAWN_DURATION);

    gain.gain.setValueAtTime(0.28, t0);
    gain.gain.linearRampToValueAtTime(0.12, t0 + SPAWN_DURATION * 0.4);
    gain.gain.setValueAtTime(0.12, t0 + SPAWN_DURATION * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.01, t0 + SPAWN_DURATION);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(t0 + SPAWN_DURATION);
  } catch (e) {
    console.warn("Audio play failed", e);
  }
};
