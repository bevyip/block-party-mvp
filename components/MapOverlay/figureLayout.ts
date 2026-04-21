import { useEffect, useState } from "react";

/** Full clear in `ParticleCanvas`; map overlay solid backdrop uses the same value. */
export const OVERLAY_PARTICLE_CANVAS_BG = "#06060a";

/** Matches `ParticleCanvas` figure geometry so UI can orbit the same focal point. */
export type OverlayFigureLayout = {
  w: number;
  h: number;
  cx: number;
  cy: number;
  R: number;
  figL: number;
  figT: number;
  figW: number;
  figH: number;
};

export function getOverlayFigureLayout(w: number, h: number): OverlayFigureLayout {
  const figH = h * 0.72;
  const figW = h * 0.28;
  const figL = (w - figW) / 2;
  const figT = (h - figH) / 2;
  const cx = figL + figW * 0.5;
  const cy = figT + figH * 0.45;
  const R = Math.min(w, h) * 0.32;
  return { w, h, cx, cy, R, figL, figT, figW, figH };
}

export function useOverlayFigureLayout(): OverlayFigureLayout {
  const [layout, setLayout] = useState<OverlayFigureLayout>(() =>
    getOverlayFigureLayout(
      typeof window !== "undefined" ? window.innerWidth : 800,
      typeof window !== "undefined" ? window.innerHeight : 600,
    ),
  );

  useEffect(() => {
    const onResize = () => {
      setLayout(
        getOverlayFigureLayout(window.innerWidth, window.innerHeight),
      );
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return layout;
}

/** Canvas size for the particle shape: diameter + breathing room. */
export function particleCanvasSize(R: number): number {
  return Math.round(R * 2.6);
}
