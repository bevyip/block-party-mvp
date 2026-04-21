export const SILHOUETTE_SHAPE_INDEX = 9;

/** Used by ParticleCanvas (resize / non–auto-cycle paths). Not bumped by KeywordCascade. */
export const MAX_ASSEMBLING_MORPH_INDEX = 8;

const ASSEMBLING_SHAPE_CYCLE = MAX_ASSEMBLING_MORPH_INDEX + 1;

export const particlePulse = { collectGen: 0 };

export const assemblingVisualState = {
  shapeIndex: 0,
  spin: 0,
  reformFrom: -1,
  reformTo: -1,
  reformFrame: 0,
  holdFrames: 0,
};

export function shapeIndexFromMonotonicCollectGen(cg: number): number {
  const m = ASSEMBLING_SHAPE_CYCLE;
  return ((cg % m) + m) % m;
}

/**
 * Clear shared snapshot state for a new pipeline run. Morph pacing during
 * assembling uses `assemblingAutoCycle` in ParticleCanvas, not external collectGen bumps.
 */
export function resetParticlePulse() {
  particlePulse.collectGen = 0;
  assemblingVisualState.shapeIndex = 0;
  assemblingVisualState.spin = 0;
  assemblingVisualState.reformFrom = -1;
  assemblingVisualState.reformTo = -1;
  assemblingVisualState.reformFrame = 0;
  assemblingVisualState.holdFrames = 0;
}
