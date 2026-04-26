import React, { useEffect, useRef } from "react";

/**
 * Matches `components/MapOverlay/ParticleCanvas` drift dots (map / translation overlay).
 */
const PARTICLE_DRAW_OPACITY_SCALE = 1.16;
const PARTICLE_GLOW_RADIUS_MUL = 2.5;
/** Softer than map overlay `ParticleCanvas` — sprites page background only. */
const SPRITES_STAR_OPACITY_MUL = 0.42;
/** Fewer dots than full-screen overlay (~half prior density, capped lower). */
const STAR_AREA_DIVISOR = 5200;
const STAR_COUNT_MIN = 90;
const STAR_COUNT_MAX = 340;
/** Slightly slower drift than the first pass (px/s scale at init). */
const STAR_SPEED_MUL = 0.82;

type Star = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
};

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function initStars(w: number, h: number, count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    /** Mix of crawl and streak: sqrt biases toward slower drift. */
    const speed =
      (10 + Math.sqrt(Math.random()) * 200) * STAR_SPEED_MUL;
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 0.4 + Math.random() * 1.2,
      opacity: 0.7 + Math.random() * 0.3,
    });
  }
  return stars;
}

export default function SpritesStarfield() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let stars: Star[] = [];
    const sizeRef = { w: 0, h: 0 };
    let dpr = 1;
    let rafId = 0;
    let last = performance.now();
    let alive = true;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      const w = el.clientWidth;
      const h = el.clientHeight;
      sizeRef.w = w;
      sizeRef.h = h;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const target = Math.round((w * h) / STAR_AREA_DIVISOR);
      const count = clamp(target, STAR_COUNT_MIN, STAR_COUNT_MAX);
      stars = initStars(w, h, count);
    };

    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    resize();

    const onVis = () => {
      if (document.visibilityState === "visible") last = performance.now();
    };
    document.addEventListener("visibilitychange", onVis);

    const tick = (now: number) => {
      if (!alive) return;
      const hidden = document.visibilityState !== "visible";
      const dt = hidden ? 0 : Math.min((now - last) / 1000, 0.12);
      last = now;
      const { w, h } = sizeRef;

      if (!hidden && w > 0 && h > 0) {
        const margin = 96;
        for (const s of stars) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.x < -margin) s.x += w + 2 * margin;
          if (s.x > w + margin) s.x -= w + 2 * margin;
          if (s.y < -margin) s.y += h + 2 * margin;
          if (s.y > h + margin) s.y -= h + 2 * margin;
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (stars.length > 0 && w > 0 && h > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (const p of stars) {
          const op = clamp(
            p.opacity * PARTICLE_DRAW_OPACITY_SCALE * SPRITES_STAR_OPACITY_MUL,
            0,
            1,
          );
          const glow = p.size * PARTICLE_GLOW_RADIUS_MUL;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
          g.addColorStop(0, `rgba(255,255,255,${op})`);
          g.addColorStop(0.3, `rgba(255,255,255,${op * 0.5})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        ctx.globalCompositeOperation = "source-over";
        for (const p of stars) {
          ctx.globalAlpha = clamp(
            p.opacity *
              PARTICLE_DRAW_OPACITY_SCALE *
              SPRITES_STAR_OPACITY_MUL,
            0,
            1,
          );
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-0"
      aria-hidden
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
