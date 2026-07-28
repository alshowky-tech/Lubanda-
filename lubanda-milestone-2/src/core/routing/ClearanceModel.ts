import {
  DEFAULT_MINIMUM_BRANCH_RADIUS,
  DEFAULT_MAXIMUM_BRANCH_RADIUS,
  DEFAULT_SAFETY_MARGIN,
  DEFAULT_BRANCH_RADIUS_AT_GENERATION_0,
} from "./types.js";

/**
 * Compute the deterministic branch radius at a given generation depth.
 * Radius decreases linearly with generation, clamped to configured bounds.
 */
export const computeBranchRadius = (
  generation: number,
  minRadius = DEFAULT_MINIMUM_BRANCH_RADIUS,
  maxRadius = DEFAULT_MAXIMUM_BRANCH_RADIUS,
  baseRadius = DEFAULT_BRANCH_RADIUS_AT_GENERATION_0,
): number => {
  if (!Number.isFinite(generation) || generation < 0) {
    throw new RangeError("generation must be a non-negative finite number");
  }
  if (!Number.isFinite(minRadius) || minRadius < 0) {
    throw new RangeError("minRadius must be a non-negative finite number");
  }
  if (!Number.isFinite(maxRadius) || maxRadius < 0) {
    throw new RangeError("maxRadius must be a non-negative finite number");
  }
  if (!Number.isFinite(baseRadius) || baseRadius < 0) {
    throw new RangeError("baseRadius must be a non-negative finite number");
  }
  if (minRadius > maxRadius) {
    throw new RangeError("minRadius must not exceed maxRadius");
  }
  // Linear decay: each generation reduces radius by a fixed fraction
  const decayPerGeneration = (baseRadius - minRadius) / Math.max(1, generation * 2 + 1);
  const radius = Math.max(minRadius, Math.min(maxRadius, baseRadius - generation * decayPerGeneration));
  return Math.round(radius * 100) / 100;
};

/**
 * Compute required clearance between two branches.
 * clearance = radiusA + radiusB + safetyMarginA + safetyMarginB
 */
export const computeRequiredClearance = (
  radiusA: number,
  radiusB: number,
  safetyMarginA = DEFAULT_SAFETY_MARGIN,
  safetyMarginB = DEFAULT_SAFETY_MARGIN,
): number => {
  for (const [value, label] of [
    [radiusA, "radiusA"],
    [radiusB, "radiusB"],
    [safetyMarginA, "safetyMarginA"],
    [safetyMarginB, "safetyMarginB"],
  ] as const) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    if (value < 0) throw new RangeError(`${label} must not be negative`);
  }
  return radiusA + radiusB + safetyMarginA + safetyMarginB;
};

/**
 * Compute effective corridor width for a branch:
 * corridorWidth = branchRadius * 2 + safetyMargin * 2
 */
export const computeCorridorWidth = (
  branchRadius: number,
  safetyMargin = DEFAULT_SAFETY_MARGIN,
): number => {
  if (!Number.isFinite(branchRadius) || branchRadius < 0) {
    throw new RangeError("branchRadius must be a non-negative finite number");
  }
  if (!Number.isFinite(safetyMargin) || safetyMargin < 0) {
    throw new RangeError("safetyMargin must be a non-negative finite number");
  }
  return branchRadius * 2 + safetyMargin * 2;
};

/**
 * Compute the collision envelope radius for a single branch.
 * This is the canonical per-branch formula shared by Routing and Collision.
 *
 * envelopeRadius = branchHalfWidth + barkAllowance + classClearance + numericalSafetyMargin
 *
 * Per LCS-GEO-004 and LCS-CON-004:
 * - branchHalfWidth is the structural branch radius
 * - barkAllowance accounts for bark thickness (from CollisionConfig.barkAllowance)
 * - classClearance is the minimum gap for this element class (from CollisionConfig.branchClearance or labelClearance)
 * - numericalSafetyMargin is a floating-point guard (defaults to the configured safetyMargin)
 */
export const computeEnvelopeRadius = (
  branchHalfWidth: number,
  barkAllowance = 0,
  classClearance = 0,
  numericalSafetyMargin = DEFAULT_SAFETY_MARGIN,
): number => {
  if (!Number.isFinite(branchHalfWidth) || branchHalfWidth < 0) {
    throw new RangeError("branchHalfWidth must be a non-negative finite number");
  }
  if (!Number.isFinite(barkAllowance) || barkAllowance < 0) {
    throw new RangeError("barkAllowance must be a non-negative finite number");
  }
  if (!Number.isFinite(classClearance) || classClearance < 0) {
    throw new RangeError("classClearance must be a non-negative finite number");
  }
  if (!Number.isFinite(numericalSafetyMargin) || numericalSafetyMargin < 0) {
    throw new RangeError("numericalSafetyMargin must be a non-negative finite number");
  }
  return branchHalfWidth + barkAllowance + classClearance + numericalSafetyMargin;
};
