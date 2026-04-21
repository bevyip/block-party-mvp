import React, { useEffect, useRef } from "react";
import { ADD_TO_PARTY_SPLAY_MS } from "../../constants";
import {
  getOverlayFigureLayout,
  OVERLAY_PARTICLE_CANVAS_BG,
} from "./figureLayout";
import {
  assemblingVisualState,
  MAX_ASSEMBLING_MORPH_INDEX,
  particlePulse,
  shapeIndexFromMonotonicCollectGen,
  SILHOUETTE_SHAPE_INDEX,
} from "./particlePulse";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ParticleCanvasProps {
  phase: "drift" | "assembling" | "crystallizing" | "chamber_reveal";
  chambersComplete?: number;
  /** Canvas side length in px; when omitted, fills the container (100% × 100%). */
  size?: number;
  /**
   * In `assembling`, advance shapes on a timer through the full pre-silhouette
   * sequence and loop (after shape 8, next is the opening sphere 0).
   * Ignores `particlePulse.collectGen` for morph pacing. For preview / dev.
   */
  assemblingAutoCycle?: boolean;
  /**
   * When set with `phase === "assembling"`, particles stay on this morph index
   * (0…MAX_ASSEMBLING_MORPH_INDEX) and ignore auto-cycle and `collectGen`.
   * Dev / preview only.
   */
  assemblingLockedShapeIndex?: number;
  /**
   * When true, particles rush radially from the figure center and fade out
   * (Add-to-Party handoff). Read each frame via ref so the rAF loop stays stable.
   */
  splayExitActive?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Total particles */
const N = 1000;

// Reform: frames to morph from current shape to the next (higher = slower)
export const REFORM_FRAMES = 168;
const REFORM_LERP = 0.038;
const ROTATE_LERP = 0.028;
/** Extra motion for morphed shapes (non-sphere) so they feel as alive as the opening sphere */
const ROTATE_LERP_MORPHED = 0.056;
/** Silhouette (crystal/chambers): lerp scales up when tight so dense packs still chase targets visibly. */
const SILHOUETTE_ROTATE_LERP_MIN = 0.032;
const SILHOUETTE_ROTATE_LERP_MAX = 0.055;
const ROTATE_SPIN_MORPHED = 0.0045;

/**
 * Fixed `size` (keywords column): base layout R is derived from the small square,
 * so morphs read smaller than fullscreen tease; nudge radius up to fill the canvas more.
 */
const EMBEDDED_SHAPE_RADIUS_SCALE = 1.18;

/** Assembling: dimmed particle opacity (rotating + morph). */
const ASSEMBLING_PARTICLE_DIM = 0.58;

/** Applied at draw time so drift / assemble / silhouette all read slightly brighter. */
const PARTICLE_DRAW_OPACITY_SCALE = 1.16;

/** Glow pass: radial gradient outer radius = size × this (additive bloom). */
const PARTICLE_GLOW_RADIUS_MUL = 2.5;

/** Frames to hold each shape while rotating before auto reform (preview loop). */
const ASSEMBLING_AUTO_ROTATE_HOLD_FRAMES = 105;

function nextAssemblingLoopShape(from: number): number {
  if (from < MAX_ASSEMBLING_MORPH_INDEX) return from + 1;
  return 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Particle = {
  // current canvas position
  x: number;
  y: number;
  // destination for reform phase
  destX: number;
  destY: number;
  scatX: number;
  scatY: number;
  // per-particle random angle on Fibonacci sphere (fixed at spawn)
  fibIndex: number;
  // visual
  size: number;
  opacity: number;
  baseOpacity: number;
  noisePhase: number;
  noiseFreq: number;
  // for chamber sector
  sector: 0 | 1 | 2;
};

// ─── Math helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function smoothstep01(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

// Correct Fibonacci sphere — evenly distributes N points on a unit sphere.
// Returns a unit vector {x, y, z}.
function fibSphere(k: number, n: number): { x: number; y: number; z: number } {
  if (n <= 1) return { x: 0, y: 1, z: 0 };
  const t = (k + 0.5) / n;
  const phi = Math.acos(clamp(1 - 2 * t, -1, 1)); // polar angle (latitude)
  const theta = Math.PI * (1 + Math.sqrt(5)) * k; // azimuth (longitude)
  const sinP = Math.sin(phi);
  return {
    x: sinP * Math.cos(theta), // longitude X
    y: Math.cos(phi), // latitude  Y  ← this is the fix. NOT sinP*sin(theta)
    z: sinP * Math.sin(theta), // longitude Z
  };
}

// Project a sphere unit vector to 2D canvas, applying a yaw spin around Y axis.
// Returns canvas {x, y} relative to sphere center.
// R = sphere radius in pixels.
function projectSphere(
  ux: number,
  uy: number,
  uz: number,
  spin: number,
  R: number,
): { px: number; py: number } {
  // Rotate around Y axis by spin angle
  const cosS = Math.cos(spin);
  const sinS = Math.sin(spin);
  const rx = ux * cosS + uz * sinS; // rotated X
  // const rz = -ux * sinS + uz * cosS; // depth, unused for orthographic projection
  // Simple orthographic projection: X → canvas X, Y → canvas Y
  // No perspective needed for this aesthetic
  return { px: rx * R, py: uy * R };
}

// ─── Shape target generators ──────────────────────────────────────────────────
// Each returns an absolute canvas {x, y} for particle i.
// cx, cy = center of figure in canvas space.
// R = sphere radius (reused for scale reference).
/** Tighten sphere + bridge shapes before full silhouette. */
const PRE_SILHOUETTE_SHAPE_SCALE = 0.86;

/** Deterministic [0, 1) for stable barycentric / jitter from particle index. */
function deterministic01(i: number, salt: number): number {
  const t = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return t - Math.floor(t);
}

/** Lissajous offset for shapes 1–MAX_ASSEMBLING_MORPH_INDEX (assembling crawl + reform). */
function surfaceCrawlOffset(
  p: Pick<Particle, "size" | "noiseFreq" | "noisePhase">,
  tSec: number,
): { crawlX: number; crawlY: number } {
  const crawlRadius = 6 + p.size * 2.5;
  const crawlX =
    Math.sin(tSec * p.noiseFreq + p.noisePhase) * crawlRadius +
    Math.sin(tSec * p.noiseFreq * 0.41 + p.noisePhase * 1.7) *
      crawlRadius *
      0.35;
  const crawlY =
    Math.cos(tSec * p.noiseFreq * 0.73 + p.noisePhase) * crawlRadius * 0.65 +
    Math.cos(tSec * p.noiseFreq * 0.57 + p.noisePhase * 2.1) *
      crawlRadius *
      0.28;
  return { crawlX, crawlY };
}

/**
 * Cartoon cloud in local coords (origin at cloud center, +y = canvas down):
 * straight horizontal base, then three fairly separate circular lobes so particles
 * read as distinct “puffs” instead of one merged blob.
 */
function insideCartoonCloud(lx: number, ly: number, rFill: number): boolean {
  const yFlat = 0.42 * rFill;
  if (ly > yFlat || ly < -0.62 * rFill) return false;
  if (Math.abs(lx) > 0.96 * rFill) return false;

  const trunkW = 0.88 * rFill;
  const trunkTop = 0.04 * rFill;
  if (Math.abs(lx) <= trunkW && ly >= trunkTop && ly <= yFlat) return true;

  // Centers spaced so disks barely kiss — readable with loose particle rendering
  const bumps: [number, number, number][] = [
    [-0.52 * rFill, 0.04 * rFill, 0.26 * rFill],
    [0, -0.1 * rFill, 0.32 * rFill],
    [0.52 * rFill, 0.04 * rFill, 0.26 * rFill],
  ];
  for (const [bx, by, br] of bumps) {
    if (Math.hypot(lx - bx, ly - by) < br * 0.996) return true;
  }
  return false;
}

/**
 * Open umbrella (+y = canvas down): upper semicircle canopy + curved stem
 * (quadratic spine bending right, with a small rounded tip).
 */
function insideUmbrella(lx: number, ly: number, rFill: number): boolean {
  const cy = 0.08 * rFill;
  const R = 0.94 * rFill;
  const yBottom = 0.54 * rFill;
  const stemTop = cy - 0.02 * rFill;
  const stemHalfW = 0.056 * rFill;
  /** Max horizontal bend of stem at bottom (classic J silhouette). */
  const stemBend = 0.44 * rFill;

  const dx = lx;
  const dy = ly - cy;
  const inDisk = dx * dx + dy * dy <= R * R * 0.9996;
  if (inDisk && ly <= cy) return true;

  if (ly >= stemTop && ly <= yBottom) {
    const span = yBottom - stemTop;
    const u = span > 1e-9 ? (ly - stemTop) / span : 0;
    /** Upper ~68% of stem stays vertical; bend only in the lower part (longer J leg). */
    const straightFrac = 0.68;
    let spineX = 0;
    if (u > straightFrac) {
      const denom = 1 - straightFrac;
      const v = denom > 1e-9 ? (u - straightFrac) / denom : 0;
      spineX = stemBend * v * v;
    }
    if (Math.abs(lx - spineX) <= stemHalfW) return true;

    const tipCx = stemBend;
    const tipCy = yBottom - 0.09 * rFill;
    const tipR = 0.07 * rFill;
    if (Math.hypot(lx - tipCx, ly - tipCy) < tipR * 0.99) return true;
  }

  return false;
}

/** Sitting teddy — union of circles, scaled to ~same bounding extent as other morph silhouettes. */
function insideTeddyBear(lx: number, ly: number, rFill: number): boolean {
  const z = 1.94;
  const parts: [number, number, number][] = [
    [0, -0.26 * z, 0.28 * z],
    [-0.24 * z, -0.38 * z, 0.11 * z],
    [0.24 * z, -0.38 * z, 0.11 * z],
    [0, -0.18 * z, 0.1 * z],
    [0, 0.06 * z, 0.33 * z],
    [0, 0.28 * z, 0.22 * z],
    [-0.3 * z, 0.02 * z, 0.12 * z],
    [0.3 * z, 0.02 * z, 0.12 * z],
    [-0.2 * z, 0.42 * z, 0.13 * z],
    [0.2 * z, 0.42 * z, 0.13 * z],
  ];
  for (const [bx, by, br] of parts) {
    const bx_ = bx * rFill;
    const by_ = by * rFill;
    const br_ = br * rFill;
    if (Math.hypot(lx - bx_, ly - by_) < br_ * 0.996) return true;
  }
  return false;
}

/**
 * Symmetric butterfly — each wing is a **tall oval**: several same-sized disks along one
 * axis (heavy overlap → smooth capsule), not one circle + a small tip sphere.
 * Forewings up-out; hindwings down and slightly medial so the four lobes stay distinct.
 * **Outer rim** disks + rim sampler (case 5) sharpen the traced outline vs soft fill alone.
 * Antennae: thick disks + dedicated sampler (case 5).
 */
function insideButterfly(lx: number, ly: number, rFill: number): boolean {
  const parts: [number, number, number][] = [
    [0, -0.03, 0.145],
    [0, 0.18, 0.16],
    // Antennae — wide enough to merge visually; upper segments sit more on centerline
    // so they are not swallowed only by forewing mass in particle density.
    [-0.08, -0.18, 0.1],
    [-0.1, -0.3, 0.105],
    [-0.12, -0.42, 0.108],
    [-0.14, -0.54, 0.11],
    [-0.17, -0.65, 0.112],
    [-0.2, -0.75, 0.115],
    [0.08, -0.18, 0.1],
    [0.1, -0.3, 0.105],
    [0.12, -0.42, 0.108],
    [0.14, -0.54, 0.11],
    [0.17, -0.65, 0.112],
    [0.2, -0.75, 0.115],
    // Left forewing — inner → outer along up-left axis
    [-0.26, -0.16, 0.33],
    [-0.47, -0.3, 0.32],
    [-0.66, -0.41, 0.29],
    // Right forewing
    [0.26, -0.16, 0.33],
    [0.47, -0.3, 0.32],
    [0.66, -0.41, 0.29],
    // Left hindwing — inner → outer along down-left axis
    [-0.28, 0.32, 0.3],
    [-0.4, 0.46, 0.29],
    [-0.52, 0.6, 0.27],
    // Right hindwing
    [0.28, 0.32, 0.3],
    [0.4, 0.46, 0.29],
    [0.52, 0.6, 0.27],
    // Outer rim — follows convex side of each wing so the silhouette reads “traced”
    [-0.72, -0.37, 0.095],
    [-0.66, -0.46, 0.092],
    [-0.54, -0.49, 0.09],
    [-0.42, -0.43, 0.088],
    [-0.34, -0.28, 0.085],
    [0.72, -0.37, 0.095],
    [0.66, -0.46, 0.092],
    [0.54, -0.49, 0.09],
    [0.42, -0.43, 0.088],
    [0.34, -0.28, 0.085],
    [-0.54, 0.62, 0.093],
    [-0.46, 0.74, 0.09],
    [-0.36, 0.62, 0.088],
    [-0.28, 0.44, 0.085],
    [0.54, 0.62, 0.093],
    [0.46, 0.74, 0.09],
    [0.36, 0.62, 0.088],
    [0.28, 0.44, 0.085],
  ];
  for (const [bx, by, br] of parts) {
    const bx_ = bx * rFill;
    const by_ = by * rFill;
    const br_ = br * rFill;
    if (Math.hypot(lx - bx_, ly - by_) < br_ * 0.996) return true;
  }
  return false;
}

/**
 * Deterministic stroke sample for antennae. Uniform rejection almost never hits the thin
 * union vs wing area (~πr² of many small hits); dedicating a slice of particles makes the
 * silhouette read as a butterfly without changing morph stability (same `i` → same point).
 */
function butterflyAntennaStroke(
  i: number,
  rFill: number,
): { lx: number; ly: number } | null {
  if (deterministic01(i, 140) >= 0.09) return null;
  const side = deterministic01(i, 141) < 0.5 ? -1 : 1;
  const u = deterministic01(i, 142);
  const keys: [number, number][] =
    side < 0
      ? [
          [-0.085, -0.18],
          [-0.1, -0.32],
          [-0.12, -0.44],
          [-0.14, -0.56],
          [-0.17, -0.68],
          [-0.2, -0.78],
        ]
      : [
          [0.085, -0.18],
          [0.1, -0.32],
          [0.12, -0.44],
          [0.14, -0.56],
          [0.17, -0.68],
          [0.2, -0.78],
        ];
  const nSeg = keys.length - 1;
  const pos = clamp(u * nSeg, 0, nSeg);
  const lo = Math.min(Math.floor(pos), nSeg - 1);
  const hi = lo + 1;
  const w = pos - lo;
  const p0 = keys[lo]!;
  const p1 = keys[hi]!;
  const bx = (p0[0] * (1 - w) + p1[0] * w) * rFill;
  const by = (p0[1] * (1 - w) + p1[1] * w) * rFill;
  const jx = (deterministic01(i, 143) - 0.5) * 0.07 * rFill;
  const jy = (deterministic01(i, 144) - 0.5) * 0.07 * rFill;
  return { lx: bx + jx, ly: by + jy };
}

const BUTTERFLY_LF_RIM: [number, number][] = [
  [-0.72, -0.37],
  [-0.66, -0.46],
  [-0.54, -0.49],
  [-0.42, -0.43],
  [-0.34, -0.28],
];
const BUTTERFLY_RF_RIM: [number, number][] = BUTTERFLY_LF_RIM.map(
  ([x, y]) => [-x, y] as [number, number],
);
const BUTTERFLY_LH_RIM: [number, number][] = [
  [-0.54, 0.62],
  [-0.46, 0.74],
  [-0.36, 0.62],
  [-0.28, 0.44],
];
const BUTTERFLY_RH_RIM: [number, number][] = BUTTERFLY_LH_RIM.map(
  ([x, y]) => [-x, y] as [number, number],
);

/** ~7.2% of particles: sample along outer wing rim (same rationale as `butterflyAntennaStroke`). */
function butterflyWingRimStroke(
  i: number,
  rFill: number,
): { lx: number; ly: number } | null {
  if (deterministic01(i, 145) >= 0.072) return null;
  const wing = Math.min(Math.floor(deterministic01(i, 146) * 4), 3);
  const u = deterministic01(i, 147);
  const keys =
    wing === 0
      ? BUTTERFLY_LF_RIM
      : wing === 1
        ? BUTTERFLY_RF_RIM
        : wing === 2
          ? BUTTERFLY_LH_RIM
          : BUTTERFLY_RH_RIM;
  const nSeg = keys.length - 1;
  const pos = clamp(u * nSeg, 0, nSeg);
  const lo = Math.min(Math.floor(pos), nSeg - 1);
  const hi = lo + 1;
  const w = pos - lo;
  const p0 = keys[lo]!;
  const p1 = keys[hi]!;
  const bx = (p0[0] * (1 - w) + p1[0] * w) * rFill;
  const by = (p0[1] * (1 - w) + p1[1] * w) * rFill;
  const jx = (deterministic01(i, 148) - 0.5) * 0.055 * rFill;
  const jy = (deterministic01(i, 149) - 0.5) * 0.055 * rFill;
  return { lx: bx + jx, ly: by + jy };
}

function shapeTarget(
  shapeIdx: number,
  i: number,
  n: number,
  cx: number,
  cy: number,
  R: number,
  destXFull: number, // particle's silhouette target (shape SILHOUETTE_SHAPE_INDEX)
  destYFull: number,
  spin: number, // current spin angle (applied to all shapes)
): { x: number; y: number } {
  const s = PRE_SILHOUETTE_SHAPE_SCALE;
  /** Outer radius (px): every pre-silhouette shape fits in diameter 2·extent (then × s). */
  const extent = R * 0.96;
  const rFill = extent;

  switch (shapeIdx) {
    case 0: {
      // Fibonacci sphere — slight inward spread; outer radius aligned with `extent`
      const u = fibSphere(i, n);
      const { px, py } = projectSphere(u.x, u.y, u.z, spin, R);
      const shell = 0.84 + 0.16 * Math.sqrt(deterministic01(i, 0));
      const k = extent / R;
      return { x: cx + px * s * shell * k, y: cy + py * s * shell * k };
    }

    case 1: {
      // Umbrella — canopy + curved stem (rejection fill), canopy radius ~ rFill
      const yBottom = 0.54 * rFill;
      const yMin = -0.9 * rFill;
      let lx = (deterministic01(i, 1) * 2 - 1) * rFill * 0.96;
      let ly = deterministic01(i, 2) * (yBottom - yMin) + yMin;
      for (let k = 0; k < 24; k++) {
        if (insideUmbrella(lx, ly, rFill)) break;
        lx *= 0.88;
        ly = yMin + deterministic01(i, 60 + k) * (yBottom - yMin);
      }
      if (!insideUmbrella(lx, ly, rFill)) {
        lx = 0;
        ly = -0.35 * rFill;
      }
      lx = clamp(lx, -0.98 * rFill, 0.98 * rFill);
      ly = clamp(ly, yMin, yBottom);
      return { x: cx + lx * s, y: cy + ly * s };
    }

    case 2: {
      // Filled five-point star — sharper tips (higher spike on cos modulation)
      const θ = deterministic01(i, 3) * Math.PI * 2;
      const t = deterministic01(i, 4);
      const m = 5;
      const spike = 0.86;
      const denom = 1 + spike;
      const rMax = rFill * Math.max(0.1, (1 + spike * Math.cos(m * θ)) / denom);
      const r = Math.sqrt(t) * rMax;
      return {
        x: cx + r * Math.cos(θ) * s,
        y: cy + r * Math.sin(θ) * s,
      };
    }

    case 3: {
      // Cartoon cloud: flat base + separated lobes (no circular rFill clip — that
      // collapses asymmetric lobes back toward the center).
      const yFlat = 0.42 * rFill;
      const yMin = -0.64 * rFill;
      let lx = (deterministic01(i, 7) * 2 - 1) * rFill * 0.96;
      let ly = deterministic01(i, 8) * (yFlat - yMin) + yMin;
      for (let k = 0; k < 22; k++) {
        if (insideCartoonCloud(lx, ly, rFill)) break;
        lx *= 0.88;
        ly = yMin + deterministic01(i, 41 + k) * (yFlat - yMin);
      }
      if (!insideCartoonCloud(lx, ly, rFill)) {
        lx = 0;
        ly = 0.24 * rFill;
      }
      lx = clamp(lx, -0.96 * rFill, 0.96 * rFill);
      ly = clamp(ly, yMin, yFlat);
      return { x: cx + lx * s, y: cy + ly * s };
    }

    case 4: {
      // Six-petal flower — higher |cos|^p so each petal reads clearly; radial bias
      // fills lobes (sqrt undersamples mid/outer petal vs center).
      const θ = deterministic01(i, 5) * Math.PI * 2;
      const t = deterministic01(i, 6);
      const petals = 6;
      const petal = Math.pow(Math.abs(Math.cos((petals / 2) * θ)), 0.8);
      const raw = 0.36 + 0.64 * petal;
      const rMax = rFill * Math.max(0.08, raw);
      const radial = Math.pow(t, 0.38);
      const r = radial * rMax;
      return {
        x: cx + r * Math.cos(θ) * s,
        y: cy + r * Math.sin(θ) * s,
      };
    }

    case 5: {
      // Butterfly — union of disks (rejection fill), same sampling pattern as teddy / cloud.
      const yMin = -0.96 * rFill;
      const yMax = 0.9 * rFill;
      const ant = butterflyAntennaStroke(i, rFill);
      if (ant) {
        return {
          x: cx + clamp(ant.lx, -0.99 * rFill, 0.99 * rFill) * s,
          y: cy + clamp(ant.ly, yMin, yMax) * s,
        };
      }
      const rim = butterflyWingRimStroke(i, rFill);
      if (rim) {
        return {
          x: cx + clamp(rim.lx, -0.99 * rFill, 0.99 * rFill) * s,
          y: cy + clamp(rim.ly, yMin, yMax) * s,
        };
      }
      let lx = (deterministic01(i, 91) * 2 - 1) * rFill;
      let ly = deterministic01(i, 92) * (yMax - yMin) + yMin;
      for (let k = 0; k < 24; k++) {
        if (insideButterfly(lx, ly, rFill)) break;
        lx *= 0.88;
        ly = yMin + deterministic01(i, 118 + k) * (yMax - yMin);
      }
      if (!insideButterfly(lx, ly, rFill)) {
        lx = 0;
        ly = 0.11 * rFill;
      }
      lx = clamp(lx, -0.99 * rFill, 0.99 * rFill);
      ly = clamp(ly, yMin, yMax);
      return { x: cx + lx * s, y: cy + ly * s };
    }

    case 6: {
      // Teddy bear — union of circles (scaled ~1.94× to match other shapes’ rFill extent)
      const yMin = -1.02 * rFill;
      const yMax = 1.05 * rFill;
      let lx = (deterministic01(i, 21) * 2 - 1) * rFill * 0.98;
      let ly = deterministic01(i, 22) * (yMax - yMin) + yMin;
      for (let k = 0; k < 24; k++) {
        if (insideTeddyBear(lx, ly, rFill)) break;
        lx *= 0.88;
        ly = yMin + deterministic01(i, 85 + k) * (yMax - yMin);
      }
      if (!insideTeddyBear(lx, ly, rFill)) {
        lx = 0;
        ly = 0.12 * rFill;
      }
      lx = clamp(lx, -0.98 * rFill, 0.98 * rFill);
      ly = clamp(ly, yMin, yMax);
      return { x: cx + lx * s, y: cy + ly * s };
    }

    case 7: {
      // Crescent moon — intersection of disks, scaled to lie inside radius rFill
      let px = (deterministic01(i, 23) - 0.5) * rFill * 1.96;
      let py = (deterministic01(i, 24) - 0.5) * rFill * 2.04;
      const d = rFill * 0.16;
      const Rb = rFill * 0.92;
      const Rs = rFill * 0.62;
      const c1x = -d;
      const c2x = d;
      const inside = () => {
        const d1 = Math.hypot(px - c1x, py);
        const d2 = Math.hypot(px - c2x, py);
        return d1 < Rb * 0.99 && d2 > Rs * 0.97;
      };
      for (let k = 0; k < 18; k++) {
        if (inside()) break;
        px *= 0.9;
        py *= 0.9;
      }
      const hm = Math.hypot(px, py);
      if (hm > rFill && hm > 1e-6) {
        const k = rFill / hm;
        px *= k;
        py *= k;
      }
      return { x: cx + px * s, y: cy + py * s };
    }

    case 8: {
      // Heart — short, round; twin lobes spaced so top cleft reads as a deep V notch.
      // Inner cheeks + neck stay out of the notch; union sampling unchanged.
      // Rough bbox in rFill units: x ≈ ±0.72, y ≈ −0.76…+0.59.
      //
      // Ellipse zones: [cx, cy, rx, ry] in units of rFill; positive y = down.

      const zones: [number, number, number, number][] = [
        // Primary humps — centers farther apart so upper intersection leaves a real gap
        [-0.38, -0.36, 0.34, 0.4],
        [0.38, -0.36, 0.34, 0.4],
        // Outer crowns — peak mass only (does not bridge the cleft)
        [-0.54, -0.44, 0.17, 0.2],
        [0.54, -0.44, 0.17, 0.2],
        // Inner cheeks — offset ±x so they do not smear across the center notch
        [-0.17, -0.38, 0.22, 0.27],
        [0.17, -0.38, 0.22, 0.27],
        // Neck — shorter vertical extent so it does not fill the dip between humps
        [0.0, -0.02, 0.36, 0.14],
        // Lobe–body bridge (wide, low; stays below the top cleft)
        [0.0, -0.1, 0.32, 0.1],
        // Wide mid body (round “apple”)
        [0.0, 0.06, 0.44, 0.28],
        [-0.18, 0.1, 0.22, 0.2],
        [0.18, 0.1, 0.22, 0.2],
        // Short lower taper to tip (tip pulled up vs long heart)
        [0.0, 0.24, 0.3, 0.18],
        [0.0, 0.36, 0.2, 0.13],
        [0.0, 0.46, 0.12, 0.095],
        [0.0, 0.54, 0.055, 0.065],
      ];

      // Sample: pick a zone weighted by its area, then sample inside it
      // Use deterministic values so morph blends are stable per particle.
      const totalArea = zones.reduce((s, [, , rx, ry]) => s + rx * ry, 0);
      const pick = deterministic01(i, 55) * totalArea;
      let acc = 0;
      let zoneIdx = 0;
      for (let z = 0; z < zones.length; z++) {
        acc += zones[z]![2]! * zones[z]![3]!;
        if (pick <= acc) {
          zoneIdx = z;
          break;
        }
      }
      const zone = zones[zoneIdx]!;
      // Uniform sample inside ellipse using the rejection-free disk method
      const ang = deterministic01(i, 56) * Math.PI * 2;
      const rad = Math.sqrt(deterministic01(i, 57));
      const lx = (zone[0] + Math.cos(ang) * rad * zone[2]) * rFill;
      const ly = (zone[1] + Math.sin(ang) * rad * zone[3]) * rFill;

      return { x: cx + lx * s, y: cy + ly * s };
    }

    case SILHOUETTE_SHAPE_INDEX:
      return { x: destXFull, y: destYFull };

    default:
      return { x: destXFull, y: destYFull };
  }
}

// ─── Silhouette target generation (for shape SILHOUETTE_SHAPE_INDEX) ─────────

function isInsideSilhouette(nx: number, ny: number): boolean {
  const zones: [number, number, number, number][] = [
    // Head — large and nearly square, ~55% of figure width
    // Centered, occupies top 24% of figure height
    [0.22, 0.78, 0.0, 0.24],

    // Neck — narrow connector, 4% of height
    [0.38, 0.62, 0.24, 0.28],

    // Shoulders — wider than torso, creates shoulder line
    [0.16, 0.84, 0.28, 0.33],

    // Torso — slightly narrower than shoulders, tapers slightly
    [0.22, 0.78, 0.33, 0.56],

    // Left arm — hangs slightly away from torso
    [0.04, 0.22, 0.3, 0.58],

    // Right arm — mirror
    [0.78, 0.96, 0.3, 0.58],

    // Left hand — small nub at arm end
    [0.06, 0.2, 0.56, 0.62],

    // Right hand — mirror
    [0.8, 0.94, 0.56, 0.62],

    // Left leg — narrower than torso, clear gap between legs
    [0.24, 0.46, 0.56, 0.86],

    // Right leg — mirror, gap in center
    [0.54, 0.76, 0.56, 0.86],

    // Left foot — slightly wider than leg, angles left
    [0.18, 0.46, 0.86, 0.94],

    // Right foot — mirror
    [0.54, 0.82, 0.86, 0.94],
  ];
  return zones.some(
    ([x0, x1, y0, y1]) => nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1,
  );
}

function sectorFor(ny: number): 0 | 1 | 2 {
  if (ny < 0.32) return 0;
  if (ny < 0.6) return 1;
  return 2;
}

/**
 * Silhouette tightness 0…3 (may be fractional): crystallizing = loosest;
 * chamber_reveal tightens by `chambersComplete`; 3 = full humanoid.
 * Steps are spaced with slightly larger early jumps (vs uniform thirds) so each
 * chamber reads clearly against the prior stage (wider early looseness).
 */
function desiredSilhouetteTightness(
  phase: ParticleCanvasProps["phase"],
  chambersComplete: number,
): number {
  if (phase === "crystallizing") return 0;
  if (phase === "chamber_reveal") {
    if (chambersComplete === 0) return 0.88;
    if (chambersComplete === 1) return 1.78;
    if (chambersComplete === 2) return 2.58;
    return 3;
  }
  return 0;
}

/** How fast `silhouetteTightnessSmoothed` eases toward the target (per frame). */
const SILHOUETTE_TIGHTNESS_LERP = 0.028;

/** Padding from canvas edges so glow (radial ~size×2.5) stays inside the viewport. */
function viewportParticleMargin(canvasW: number, canvasH: number): number {
  return Math.max(12, Math.min(canvasW, canvasH) * 0.024);
}

function clampParticleToFigureViewport(
  phase: ParticleCanvasProps["phase"],
  p: Particle,
  canvasW: number,
  canvasH: number,
): void {
  if (phase !== "crystallizing" && phase !== "chamber_reveal") return;
  const vm = viewportParticleMargin(canvasW, canvasH);
  p.x = clamp(p.x, vm, canvasW - vm);
  p.y = clamp(p.y, vm, canvasH - vm);
}

/**
 * Looseness for crystallizing / chambers: spread mostly sideways (anisotropic from
 * body center) with light vertical bloom so loose reads as breadth, not only height.
 * Results are clamped to the canvas so particles never leave the viewport.
 */
function silhouetteRelaxedTarget(
  destX: number,
  destY: number,
  cx: number,
  cy: number,
  tightness: number,
  i: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  const dx = destX - cx;
  const dy = destY - cy;
  const u = clamp(tightness / 3, 0, 1);
  const loose = 1 - u;
  /** Emphasize mid–loose range so each chamber step shows a clearer width change. */
  const looseH = loose * (0.72 + 0.28 * loose);

  const scaleX = 1 + looseH * 1.22;
  const scaleY = 1 + loose * 0.065;
  let x = cx + dx * scaleX;
  let y = cy + dy * scaleY;

  const noiseMag = loose * loose * 52;
  const a = deterministic01(i, 501) * Math.PI * 2;
  x += Math.cos(a) * noiseMag * 1.42;
  y += Math.sin(a) * noiseMag * 0.3;

  const dLen = Math.hypot(dx, dy) || 1;
  const px = -dy / dLen;
  const py = dx / dLen;
  const tangMag = (deterministic01(i, 502) - 0.5) * 2 * loose * 46;
  x += px * tangMag;
  y += py * tangMag;

  // Extra screen-relative horizontal splay (deterministic per particle).
  const wideJ =
    (deterministic01(i, 504) - 0.5) * 2 * loose * loose * viewW * 0.118;
  x += wideJ;

  const m = viewportParticleMargin(viewW, viewH);
  x = clamp(x, m, viewW - m);
  y = clamp(y, m, viewH - m);
  return { x, y };
}

// ─── Particle pool init ───────────────────────────────────────────────────────

function initParticles(canvasW: number, canvasH: number): Particle[] {
  const { cx, cy, R, figL, figT, figW, figH } = getOverlayFigureLayout(
    canvasW,
    canvasH,
  );

  // Pre-sample silhouette interior points for final humanoid targets
  const silPoints: { sx: number; sy: number; sector: 0 | 1 | 2 }[] = [];
  let guard = 0;
  while (silPoints.length < N && guard < 200_000) {
    guard++;
    const nx = Math.random();
    const ny = Math.random();
    if (!isInsideSilhouette(nx, ny)) continue;
    silPoints.push({
      sx: figL + nx * figW,
      sy: figT + ny * figH,
      sector: sectorFor(ny),
    });
  }
  // Pad if needed
  while (silPoints.length < N) {
    silPoints.push({ sx: cx, sy: cy, sector: 1 });
  }

  const particles: Particle[] = [];
  for (let i = 0; i < N; i++) {
    const sil = silPoints[i]!;
    // Start particles randomly scattered across canvas
    // They will lerp toward the sphere in rotating state
    const startX = Math.random() * canvasW;
    const startY = Math.random() * canvasH;

    particles.push({
      x: startX,
      y: startY,
      destX: sil.sx, // silhouette target (shape SILHOUETTE_SHAPE_INDEX)
      destY: sil.sy,
      scatX: startX,
      scatY: startY,
      fibIndex: i,
      size: 0.4 + Math.random() * 1.2,
      opacity: 0.7 + Math.random() * 0.3,
      baseOpacity: 0.7 + Math.random() * 0.3,
      noisePhase: Math.random() * Math.PI * 2,
      noiseFreq: 0.6 + Math.random() * 1.4,
      sector: sil.sector,
    });
  }
  return particles;
}

/**
 * After `initParticles`, call when add-to-party splay is already active so the
 * outward burst starts from the full humanoid instead of a random scatter (e.g.
 * `MapOverlay` was `return null` until splay, or chambers were passed as 0 while hidden).
 */
function snapParticlesToSilhouetteFullForSplay(
  parts: Particle[],
  canvasW: number,
  canvasH: number,
  size: number | undefined,
  spin: number,
): void {
  const { cx, cy, R: rLayout } = getOverlayFigureLayout(canvasW, canvasH);
  const R =
    typeof size === "number"
      ? rLayout * EMBEDDED_SHAPE_RADIUS_SCALE
      : rLayout;
  const silTight = 3;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const dest = shapeTarget(
      SILHOUETTE_SHAPE_INDEX,
      i,
      parts.length,
      cx,
      cy,
      R,
      p.destX,
      p.destY,
      spin,
    );
    const adj = silhouetteRelaxedTarget(
      dest.x,
      dest.y,
      cx,
      cy,
      silTight,
      i,
      canvasW,
      canvasH,
    );
    p.x = adj.x;
    p.y = adj.y;
    p.opacity = p.baseOpacity;
    clampParticleToFigureViewport("chamber_reveal", p, canvasW, canvasH);
  }
}

/** Snap particles to `shapeIndex` targets (used after resize restore). */
function applyCollectGenResume(
  parts: Particle[],
  w: number,
  h: number,
  size: number | undefined,
  spin: number,
  shapeIndex: number,
): void {
  const cg = clamp(shapeIndex, 0, MAX_ASSEMBLING_MORPH_INDEX);
  const { cx, cy, R: rLayout } = getOverlayFigureLayout(w, h);
  const R =
    typeof size === "number" ? rLayout * EMBEDDED_SHAPE_RADIUS_SCALE : rLayout;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const t = shapeTarget(
      cg,
      i,
      parts.length,
      cx,
      cy,
      R,
      p.destX,
      p.destY,
      spin,
    );
    p.x = t.x;
    p.y = t.y;
  }
}

/** Ideal reform target (before per-frame REFORM_LERP), shared by rAF and resize resume. */
function assemblingReformIdealTarget(
  i: number,
  n: number,
  canvasW: number,
  canvasH: number,
  size: number | undefined,
  spin: number,
  fromSh: number,
  toSh: number,
  morphFrameVal: number,
  destX: number,
  destY: number,
  silTight: number,
  phase: ParticleCanvasProps["phase"],
): { x: number; y: number } {
  const eased = smoothstep01(morphFrameVal / REFORM_FRAMES);
  const { cx, cy, R: rLayout } = getOverlayFigureLayout(canvasW, canvasH);
  const R =
    typeof size === "number" ? rLayout * EMBEDDED_SHAPE_RADIUS_SCALE : rLayout;

  const fromDest = shapeTarget(fromSh, i, n, cx, cy, R, destX, destY, spin);
  const toDest = shapeTarget(toSh, i, n, cx, cy, R, destX, destY, spin);
  let fromX = fromDest.x;
  let fromY = fromDest.y;
  let toX = toDest.x;
  let toY = toDest.y;
  if (
    toSh === SILHOUETTE_SHAPE_INDEX &&
    (phase === "crystallizing" || phase === "chamber_reveal")
  ) {
    const adj = silhouetteRelaxedTarget(
      toX,
      toY,
      cx,
      cy,
      silTight,
      i,
      canvasW,
      canvasH,
    );
    toX = adj.x;
    toY = adj.y;
  }
  let tx = fromX + (toX - fromX) * eased;
  let ty = fromY + (toY - fromY) * eased;
  return { x: tx, y: ty };
}

function applyReformingResume(
  parts: Particle[],
  canvasW: number,
  canvasH: number,
  size: number | undefined,
  spin: number,
  fromSh: number,
  toSh: number,
  morphFrameVal: number,
  silTight: number,
  phase: ParticleCanvasProps["phase"],
): void {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const t = assemblingReformIdealTarget(
      i,
      parts.length,
      canvasW,
      canvasH,
      size,
      spin,
      fromSh,
      toSh,
      morphFrameVal,
      p.destX,
      p.destY,
      silTight,
      phase,
    );
    p.x = t.x;
    p.y = t.y;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParticleCanvas({
  phase,
  chambersComplete = 0,
  size,
  assemblingAutoCycle = false,
  assemblingLockedShapeIndex,
  splayExitActive = false,
}: ParticleCanvasProps) {
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const splayExitRef = useRef(false);
  splayExitRef.current = !!splayExitActive;
  const splayStartMsRef = useRef<number | null>(null);
  /** After splay ends, keep clearing the canvas so particles never reform behind the sprite. */
  const postSplayBlankRef = useRef(false);
  const prevSplayExitTickRef = useRef(false);

  useEffect(() => {
    if (!splayExitActive) {
      splayStartMsRef.current = null;
    }
  }, [splayExitActive]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const sizeRef = useRef({ w: 1, h: 1 });

  // Animation state — all in refs so rAF reads latest without re-subscribing
  const morphState = useRef<"rotating" | "reforming">("rotating");
  const morphFrame = useRef(0); // counts up each frame during reform
  const currentShape = useRef(0); // shape we are currently showing
  const targetShape = useRef(0); // shape we are reforming toward
  const spinAngle = useRef(0); // accumulated yaw in radians

  const lastCollectSeenRef = useRef(0);
  const pendingCollectGenRef = useRef(0);
  const autoRotateHoldFramesRef = useRef(0);

  // Chamber flare
  const prevChambers = useRef(chambersComplete);
  const flareUntil = useRef<[number, number, number]>([0, 0, 0]);
  const chamberFlashStart = useRef<number | null>(null);
  /** 0 loosest … 3 full humanoid; lerped toward `desiredSilhouetteTightness` each frame. */
  const silhouetteTightnessSmoothed = useRef(0);
  const crystallizingEnteredRef = useRef(false);

  // ── Chamber effect ──────────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevChambers.current;
    if (chambersComplete > prev) {
      for (let s = prev; s < chambersComplete; s++) {
        flareUntil.current[Math.min(2, s)] = performance.now() + 520;
      }
      chamberFlashStart.current = performance.now();
    }
    prevChambers.current = chambersComplete;
  }, [chambersComplete]);

  useEffect(() => {
    if (phase !== "crystallizing" && phase !== "chamber_reveal") {
      crystallizingEnteredRef.current = false;
    }
  }, [phase]);

  // ── Canvas resize ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let resizeRafId = 0;

    const runResize = () => {
      resizeRafId = 0;
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      const prev = sizeRef.current;
      // Speech-bubble layout can fire ResizeObserver multiple times with the same
      // box or transient intermediate sizes; avoid clearing the canvas / re-init
      // particles when nothing actually changed.
      if (particlesRef.current.length > 0 && w === prev.w && h === prev.h) {
        return;
      }

      sizeRef.current = { w, h };
      const canvas = canvasRef.current;
      if (canvas && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }

      const collectGenBeforeReset = particlePulse.collectGen;

      particlesRef.current = initParticles(w, h);
      morphState.current = "rotating";
      morphFrame.current = 0;
      silhouetteTightnessSmoothed.current = 0;

      const restoreFromKeywords =
        collectGenBeforeReset > 0
          ? shapeIndexFromMonotonicCollectGen(collectGenBeforeReset)
          : null;
      const restoreFromMemory = clamp(
        assemblingVisualState.shapeIndex,
        0,
        MAX_ASSEMBLING_MORPH_INDEX,
      );
      const restoreShape =
        restoreFromKeywords !== null ? restoreFromKeywords : restoreFromMemory;

      const rs = assemblingVisualState;
      const phaseNow = phaseRef.current;
      const midReform =
        phaseNow === "assembling" &&
        rs.reformFrom >= 0 &&
        rs.reformTo >= 0 &&
        rs.reformFrom !== rs.reformTo &&
        rs.reformFrame >= 0 &&
        rs.reformFrame < REFORM_FRAMES;

      if (midReform) {
        currentShape.current = rs.reformFrom;
        targetShape.current = rs.reformTo;
        morphState.current = "reforming";
        morphFrame.current = rs.reformFrame;
        lastCollectSeenRef.current = collectGenBeforeReset;
        pendingCollectGenRef.current = 0;
        spinAngle.current = rs.spin;
        applyReformingResume(
          particlesRef.current,
          w,
          h,
          size,
          spinAngle.current,
          rs.reformFrom,
          rs.reformTo,
          rs.reformFrame,
          silhouetteTightnessSmoothed.current,
          phaseNow,
        );
      } else if (collectGenBeforeReset > 0 || restoreShape > 0) {
        currentShape.current = restoreShape;
        targetShape.current = restoreShape;
        lastCollectSeenRef.current = collectGenBeforeReset;
        pendingCollectGenRef.current = 0;
        spinAngle.current = assemblingVisualState.spin;
        applyCollectGenResume(
          particlesRef.current,
          w,
          h,
          size,
          spinAngle.current,
          restoreShape,
        );
      } else {
        currentShape.current = 0;
        targetShape.current = 0;
        lastCollectSeenRef.current = 0;
        pendingCollectGenRef.current = 0;
      }

      autoRotateHoldFramesRef.current =
        morphState.current === "rotating"
          ? assemblingVisualState.holdFrames
          : 0;

      crystallizingEnteredRef.current = false;

      if (splayExitRef.current) {
        snapParticlesToSilhouetteFullForSplay(
          particlesRef.current,
          w,
          h,
          size,
          spinAngle.current,
        );
        currentShape.current = SILHOUETTE_SHAPE_INDEX;
        targetShape.current = SILHOUETTE_SHAPE_INDEX;
        morphState.current = "rotating";
        morphFrame.current = 0;
        crystallizingEnteredRef.current = true;
        silhouetteTightnessSmoothed.current = 3;
      }
    };

    const scheduleResize = () => {
      if (resizeRafId !== 0) return;
      resizeRafId = requestAnimationFrame(() => {
        runResize();
      });
    };

    runResize();
    const ro = new ResizeObserver(() => {
      scheduleResize();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (resizeRafId !== 0) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = 0;
      }
    };
  }, [size, assemblingLockedShapeIndex]);

  // ── Main rAF loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let rafId = 0;
    const t0 = performance.now();

    const drawParticles = () => {
      const { w: dw, h: dh } = sizeRef.current;
      const dparts = particlesRef.current;
      ctx.fillStyle = OVERLAY_PARTICLE_CANVAS_BG;
      ctx.fillRect(0, 0, dw, dh);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const p of dparts) {
        const op = clamp(p.opacity * PARTICLE_DRAW_OPACITY_SCALE, 0, 1);
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
      for (const p of dparts) {
        ctx.globalAlpha = clamp(p.opacity * PARTICLE_DRAW_OPACITY_SCALE, 0, 1);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      const { w, h } = sizeRef.current;
      const parts = particlesRef.current;
      const tSec = (now - t0) / 1000;

      const wasSplayExit = prevSplayExitTickRef.current;
      prevSplayExitTickRef.current = splayExitRef.current;

      if (
        assemblingLockedShapeIndex === undefined &&
        particlePulse.collectGen === 0 &&
        lastCollectSeenRef.current !== 0
      ) {
        lastCollectSeenRef.current = 0;
        pendingCollectGenRef.current = 0;
        morphState.current = "rotating";
        morphFrame.current = 0;
        currentShape.current = 0;
        targetShape.current = 0;
        spinAngle.current = 0;
      }

      // ── Figure geometry (shared with KeywordCascade / CharacterTease) ───
      const { cx, cy, R: rLayout } = getOverlayFigureLayout(w, h);
      const R =
        typeof size === "number"
          ? rLayout * EMBEDDED_SHAPE_RADIUS_SCALE
          : rLayout;

      if (splayExitRef.current) {
        postSplayBlankRef.current = false;
        if (splayStartMsRef.current === null) {
          splayStartMsRef.current = now;
        }
        const s0 = splayStartMsRef.current;
        const tNat = s0 === null ? 0 : Math.min((now - s0) / ADD_TO_PARTY_SPLAY_MS, 1);
        /** Ease-out so outward motion stays gentle early, then opens up. */
        const tSpd = 1 - (1 - tNat) ** 1.75;
        const accel = 0.1 + tSpd * tSpd * 2.2;
        const speedMul = Math.max(0.42, (w + h) / 2600);
        /** Hold brightness while expanding; fade ramps over the rest of the (longer) splay window. */
        const fadeStart = 0.14;
        const fadeT = clamp((tNat - fadeStart) / (1 - fadeStart), 0, 1);
        const opacityMul = 1 - fadeT ** 2.4;

        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]!;
          let dx = p.x - cx;
          let dy = p.y - cy;
          const len = Math.hypot(dx, dy);
          if (len < 1e-3) {
            const ang = (i / Math.max(1, parts.length)) * Math.PI * 2;
            dx = Math.cos(ang);
            dy = Math.sin(ang);
          } else {
            dx /= len;
            dy /= len;
          }
          const perpX = -dy;
          const perpY = dx;
          const wig =
            Math.sin(now * 0.0011 + p.noisePhase * 3) * (1 - tNat) * 1.35;
          const reachBoost = 1 + 0.42 * tNat;
          const sp = (3.2 + (i % 13)) * accel * speedMul * reachBoost;
          p.x += dx * sp + perpX * wig;
          p.y += dy * sp + perpY * wig;
          p.opacity = clamp(
            p.baseOpacity * opacityMul * (1.06 + 0.22 * (1 - fadeT)),
            0,
            1,
          );
        }

        drawParticles();
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (wasSplayExit && !splayExitRef.current) {
        postSplayBlankRef.current = true;
      }

      if (postSplayBlankRef.current) {
        ctx.fillStyle = OVERLAY_PARTICLE_CANVAS_BG;
        ctx.fillRect(0, 0, w, h);
        rafId = requestAnimationFrame(tick);
        return;
      }

      const desiredT = desiredSilhouetteTightness(phase, chambersComplete);
      silhouetteTightnessSmoothed.current +=
        (desiredT - silhouetteTightnessSmoothed.current) *
        SILHOUETTE_TIGHTNESS_LERP;
      const silTight = silhouetteTightnessSmoothed.current;

      // ── Chamber flash ────────────────────────────────────────────────────
      const fs = chamberFlashStart.current;
      let chamberSpike = 0;
      if (fs !== null) {
        const dt = now - fs;
        if (dt < 100) chamberSpike = dt / 100;
        else if (dt < 500) chamberSpike = 1 - (dt - 100) / 400;
        else chamberFlashStart.current = null;
      }

      // ── Morph state machine ──────────────────────────────────────────────
      if (phase === "assembling") {
        const lockedShape =
          typeof assemblingLockedShapeIndex === "number" &&
          assemblingLockedShapeIndex >= 0 &&
          assemblingLockedShapeIndex <= MAX_ASSEMBLING_MORPH_INDEX
            ? assemblingLockedShapeIndex
            : null;

        if (lockedShape !== null) {
          const L = lockedShape;
          currentShape.current = L;
          targetShape.current = L;
          morphState.current = "rotating";
          morphFrame.current = 0;
          spinAngle.current +=
            L > 0 && L < SILHOUETTE_SHAPE_INDEX ? ROTATE_SPIN_MORPHED : 0.0025;
          assemblingVisualState.reformFrom = -1;
          assemblingVisualState.reformTo = -1;
          assemblingVisualState.reformFrame = 0;
          assemblingVisualState.shapeIndex = L;
          assemblingVisualState.spin = spinAngle.current;
        } else if (assemblingAutoCycle) {
          if (morphState.current === "reforming") {
            morphFrame.current++;
            if (morphFrame.current >= REFORM_FRAMES) {
              currentShape.current = targetShape.current;
              morphState.current = "rotating";
              morphFrame.current = 0;
              autoRotateHoldFramesRef.current = 0;
            }
          } else {
            autoRotateHoldFramesRef.current++;
            if (
              autoRotateHoldFramesRef.current >=
              ASSEMBLING_AUTO_ROTATE_HOLD_FRAMES
            ) {
              autoRotateHoldFramesRef.current = 0;
              targetShape.current = nextAssemblingLoopShape(
                currentShape.current,
              );
              morphState.current = "reforming";
              morphFrame.current = 0;
            }
          }

          const spinRefShape =
            morphState.current === "reforming"
              ? targetShape.current
              : currentShape.current;
          spinAngle.current +=
            spinRefShape > 0 && spinRefShape < SILHOUETTE_SHAPE_INDEX
              ? ROTATE_SPIN_MORPHED
              : 0.0025;
        } else {
          const cg = particlePulse.collectGen;

          // Description revealed: morph directly to the next shape (no scatter/splay)
          if (cg > lastCollectSeenRef.current) {
            if (morphState.current === "rotating") {
              lastCollectSeenRef.current = cg;
              targetShape.current = shapeIndexFromMonotonicCollectGen(cg);
              morphState.current = "reforming";
              morphFrame.current = 0;
            } else if (morphState.current === "reforming") {
              pendingCollectGenRef.current = Math.max(
                pendingCollectGenRef.current,
                cg,
              );
            }
          }

          if (morphState.current === "reforming") {
            morphFrame.current++;
            if (morphFrame.current >= REFORM_FRAMES) {
              currentShape.current = targetShape.current;
              const pc = pendingCollectGenRef.current;
              if (pc > lastCollectSeenRef.current) {
                pendingCollectGenRef.current = 0;
                lastCollectSeenRef.current = pc;
                targetShape.current = shapeIndexFromMonotonicCollectGen(pc);
                morphState.current = "reforming";
                morphFrame.current = 0;
              } else {
                morphState.current = "rotating";
                morphFrame.current = 0;
              }
            }
          }

          // Keep spin advancing during reform too (was only in rotating branch before).
          const spinRefShape =
            morphState.current === "reforming"
              ? targetShape.current
              : currentShape.current;
          spinAngle.current +=
            spinRefShape > 0 && spinRefShape < SILHOUETTE_SHAPE_INDEX
              ? ROTATE_SPIN_MORPHED
              : 0.0025;
        }

        if (morphState.current === "reforming") {
          assemblingVisualState.reformFrom = currentShape.current;
          assemblingVisualState.reformTo = targetShape.current;
          assemblingVisualState.reformFrame = morphFrame.current;
        } else {
          assemblingVisualState.reformFrom = -1;
          assemblingVisualState.reformTo = -1;
          assemblingVisualState.reformFrame = 0;
        }
        assemblingVisualState.shapeIndex = currentShape.current;
        assemblingVisualState.spin = spinAngle.current;
        if (assemblingAutoCycle) {
          assemblingVisualState.holdFrames = autoRotateHoldFramesRef.current;
        }
      }

      if (phase === "crystallizing" || phase === "chamber_reveal") {
        if (!crystallizingEnteredRef.current) {
          crystallizingEnteredRef.current = true;
          if (currentShape.current !== SILHOUETTE_SHAPE_INDEX) {
            targetShape.current = SILHOUETTE_SHAPE_INDEX;
            morphState.current = "reforming";
            morphFrame.current = 0;
          } else {
            morphState.current = "rotating";
          }
        }

        if (morphState.current === "reforming") {
          morphFrame.current++;
          if (morphFrame.current >= REFORM_FRAMES) {
            currentShape.current = SILHOUETTE_SHAPE_INDEX;
            morphState.current = "rotating";
            morphFrame.current = 0;
          }
        }

        {
          const tn = clamp(silhouetteTightnessSmoothed.current / 3, 0, 1);
          spinAngle.current += 0.001 + 0.0024 * tn;
        }
      }

      // ── Per-particle update ──────────────────────────────────────────────
      const spin = spinAngle.current;
      const mState = morphState.current;

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!;

        // ── DRIFT ──────────────────────────────────────────────────────────
        if (phase === "drift") {
          p.x += (Math.random() - 0.5) * 0.8;
          p.y += (Math.random() - 0.5) * 0.8;
          p.x = clamp(p.x, 0, w);
          p.y = clamp(p.y, 0, h);
          p.opacity = p.baseOpacity * 0.4;
          continue;
        }

        // ── REFORMING ──────────────────────────────────────────────────────
        // Blend previous shape → next in lockstep (smoothstep), so particles
        // follow the visible form instead of chording through empty space.
        if (mState === "reforming") {
          const fromSh = currentShape.current;
          const toSh = targetShape.current;
          const { x: tx, y: ty } = assemblingReformIdealTarget(
            i,
            parts.length,
            w,
            h,
            size,
            spin,
            fromSh,
            toSh,
            morphFrame.current,
            p.destX,
            p.destY,
            silTight,
            phase,
          );
          p.x += (tx - p.x) * REFORM_LERP;
          p.y += (ty - p.y) * REFORM_LERP;
          p.opacity = p.baseOpacity * ASSEMBLING_PARTICLE_DIM;
          clampParticleToFigureViewport(phase, p, w, h);
          continue;
        }

        // ── ROTATING ───────────────────────────────────────────────────────
        const dest = shapeTarget(
          currentShape.current,
          i,
          parts.length,
          cx,
          cy,
          R,
          p.destX,
          p.destY,
          spin,
        );
        const sh = currentShape.current;
        let destX = dest.x;
        let destY = dest.y;
        if (
          sh === SILHOUETTE_SHAPE_INDEX &&
          (phase === "crystallizing" || phase === "chamber_reveal")
        ) {
          const adj = silhouetteRelaxedTarget(
            destX,
            destY,
            cx,
            cy,
            silTight,
            i,
            w,
            h,
          );
          destX = adj.x;
          destY = adj.y;
        }
        if (sh > 0 && sh < SILHOUETTE_SHAPE_INDEX && phase === "assembling") {
          const { crawlX, crawlY } = surfaceCrawlOffset(p, tSec);
          const tx = destX + crawlX;
          const ty = destY + crawlY;
          p.x += (tx - p.x) * ROTATE_LERP_MORPHED;
          p.y += (ty - p.y) * ROTATE_LERP_MORPHED;
        } else {
          // Sphere: gentle noise. Silhouette: spatial spread still eases with
          // tightness, but motion amplitude ramps up when tight so dense humanoid
          // reads alive (wobble is decoupled from silhouetteRelaxedTarget "loose").
          const spatialLoose =
            sh === SILHOUETTE_SHAPE_INDEX &&
            (phase === "crystallizing" || phase === "chamber_reveal")
              ? clamp(1 - silTight / 3, 0, 1)
              : 1;
          const tightNorm =
            sh === SILHOUETTE_SHAPE_INDEX &&
            (phase === "crystallizing" || phase === "chamber_reveal")
              ? clamp(silTight / 3, 0, 1)
              : 0;
          const wobble =
            2.85 + spatialLoose * 5.25 + tightNorm * 7.0;
          const wobbleX = 1 + spatialLoose * 0.88;
          const wobbleY = 1 - spatialLoose * 0.42;
          const freqMul = 1 + 0.45 * tightNorm;
          const tx =
            destX +
            Math.sin(
              tSec * p.noiseFreq * freqMul + p.noisePhase,
            ) *
              wobble *
              wobbleX;
          const ty =
            destY +
            Math.cos(
              tSec * p.noiseFreq * 0.8 * freqMul + p.noisePhase,
            ) *
              wobble *
              wobbleY;
          const silhouetteLerp =
            sh === SILHOUETTE_SHAPE_INDEX &&
            (phase === "crystallizing" || phase === "chamber_reveal")
              ? SILHOUETTE_ROTATE_LERP_MIN +
                (SILHOUETTE_ROTATE_LERP_MAX - SILHOUETTE_ROTATE_LERP_MIN) *
                  tightNorm
              : ROTATE_LERP;
          p.x += (tx - p.x) * silhouetteLerp;
          p.y += (ty - p.y) * silhouetteLerp;
        }

        let op =
          phase === "assembling"
            ? p.baseOpacity * ASSEMBLING_PARTICLE_DIM
            : p.baseOpacity;
        if (chamberSpike > 0) op = clamp(op + (1 - op) * chamberSpike, 0.08, 1);
        if (phase === "chamber_reveal") {
          const slot = p.sector;
          let boost = 0;
          if (now < flareUntil.current[slot]) boost = 0.45;
          if (chambersComplete > slot) boost += 0.18;
          if (chambersComplete >= 3) boost += 0.1 + Math.sin(tSec * 1.2) * 0.05;
          op = clamp(op + boost, 0.1, 1);
        }
        p.opacity = op;
        clampParticleToFigureViewport(phase, p, w, h);
      }

      drawParticles();

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    phase,
    chambersComplete,
    size,
    assemblingAutoCycle,
    assemblingLockedShapeIndex,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        position: size === undefined ? "absolute" : "relative",
        ...(size === undefined ? { inset: 0 } : {}),
        width: size ?? "100%",
        height: size ?? "100%",
        flexShrink: 0,
        pointerEvents: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
