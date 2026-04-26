/**
 * Stage 2 → manifest appearance slice (`footwear` = brief `shoes`).
 * Keep in sync with `manifestStage2FromBrief` in `lib/generatedSprites.ts`.
 */

function isRecord(x) {
  return typeof x === "object" && x !== null;
}

function manifestStage2FromBrief(brief) {
  if (!isRecord(brief)) return undefined;
  const hair = brief.hair;
  const face = brief.face;
  const torso = brief.torso;
  const legs = brief.legs;
  const shoes = brief.shoes;
  if (
    !isRecord(hair) ||
    !isRecord(face) ||
    !isRecord(torso) ||
    !isRecord(legs) ||
    !isRecord(shoes)
  ) {
    return undefined;
  }
  if (
    typeof hair.style !== "string" ||
    typeof hair.color !== "string" ||
    typeof hair.description !== "string"
  ) {
    return undefined;
  }
  if (
    typeof face.expression !== "string" ||
    typeof face.description !== "string" ||
    !("markings" in face)
  ) {
    return undefined;
  }
  const markings =
    face.markings === null || typeof face.markings === "string"
      ? face.markings
      : null;
  if (
    typeof torso.style !== "string" ||
    typeof torso.primary_color !== "string" ||
    typeof torso.description !== "string" ||
    !("secondary_color" in torso)
  ) {
    return undefined;
  }
  const secondary =
    torso.secondary_color === null ||
    typeof torso.secondary_color === "string"
      ? torso.secondary_color
      : null;
  if (
    typeof legs.style !== "string" ||
    typeof legs.color !== "string" ||
    typeof legs.description !== "string"
  ) {
    return undefined;
  }
  if (typeof shoes.color !== "string" || typeof shoes.description !== "string") {
    return undefined;
  }
  return {
    hair: {
      style: hair.style,
      color: hair.color,
      description: hair.description,
    },
    face: {
      expression: face.expression,
      markings,
      description: face.description,
    },
    torso: {
      style: torso.style,
      primary_color: torso.primary_color,
      secondary_color: secondary,
      description: torso.description,
    },
    legs: {
      style: legs.style,
      color: legs.color,
      description: legs.description,
    },
    footwear: {
      color: shoes.color,
      description: shoes.description,
    },
  };
}

module.exports = { manifestStage2FromBrief };
