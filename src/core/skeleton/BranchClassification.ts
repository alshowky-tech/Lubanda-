import type {
  SkeletonBranchRole,
  VerticalZone,
} from "./types.js";
import type { Bounds } from "../geometry/types.js";

// ── Role priority mapping ─────────────────────────────────────────────

export const ROLE_PRIORITY: Record<SkeletonBranchRole, number> = {
  TRUNK: 0,
  PRIMARY: 1,
  SECONDARY: 2,
  TWIG: 3,
  TERMINAL_TWIG: 4,
};

// ── Role-specific growth configuration ────────────────────────────────

export interface RoleGrowthPolicy {
  readonly maxCurvatureRatio: number;       // fraction of the global maxCurvature
  readonly directionPersistence: number;    // how much candidate follows parent direction (0-1)
  readonly lengthMinRatio: number;          // minimum length as fraction of global minimumBranchLength
  readonly lengthMaxRatio: number;          // maximum length multiplier
  readonly allowDescending: boolean;        // whether branch can grow downward
  readonly descentLimitRatio: number;       // how much descent is allowed (0=no descent, 1=full)
  readonly attractorBias: number;           // weighting toward attractor forces
  readonly jitterScale: number;             // organic jitter scale factor
  readonly candidateCountRatio: number;     // candidate count as fraction of config.candidateCount
}

export const ROLE_GROWTH_POLICIES: Record<SkeletonBranchRole, RoleGrowthPolicy> = {
  TRUNK: {
    maxCurvatureRatio: 0.15,
    directionPersistence: 0.9,
    lengthMinRatio: 3,
    lengthMaxRatio: 5,
    allowDescending: false,
    descentLimitRatio: 0,
    attractorBias: 0.4,
    jitterScale: 0.4,
    candidateCountRatio: 1.0,
  },
  PRIMARY: {
    maxCurvatureRatio: 0.5,
    directionPersistence: 0.75,
    lengthMinRatio: 2,
    lengthMaxRatio: 3,
    allowDescending: false,
    descentLimitRatio: 0,
    attractorBias: 0.6,
    jitterScale: 0.6,
    candidateCountRatio: 1.0,
  },
  SECONDARY: {
    maxCurvatureRatio: 0.7,
    directionPersistence: 0.55,
    lengthMinRatio: 1.5,
    lengthMaxRatio: 2,
    allowDescending: true,
    descentLimitRatio: 0.3,
    attractorBias: 0.75,
    jitterScale: 0.8,
    candidateCountRatio: 0.85,
  },
  TWIG: {
    maxCurvatureRatio: 0.85,
    directionPersistence: 0.4,
    lengthMinRatio: 1,
    lengthMaxRatio: 1.5,
    allowDescending: true,
    descentLimitRatio: 0.6,
    attractorBias: 0.85,
    jitterScale: 1.0,
    candidateCountRatio: 0.7,
  },
  TERMINAL_TWIG: {
    maxCurvatureRatio: 0.9,
    directionPersistence: 0.3,
    lengthMinRatio: 1,
    lengthMaxRatio: 1.2,
    allowDescending: true,
    descentLimitRatio: 0.8,
    attractorBias: 0.9,
    jitterScale: 1.2,
    candidateCountRatio: 0.5,
  },
};

// ── Vertical zone policies ────────────────────────────────────────────

export interface ZoneVerticalPolicy {
  readonly maxDescentRatio: number;          // fraction of template height descent allowed
  readonly upwardBias: number;               // strength of upward growth bias (0=none, 1=strong)
  readonly curvatureLimitRatio: number;      // curvature limit for this zone
}

export const ZONE_VERTICAL_POLICIES: Record<VerticalZone, ZoneVerticalPolicy> = {
  ROOT_ZONE: {
    maxDescentRatio: 0,
    upwardBias: 0.95,
    curvatureLimitRatio: 0.2,
  },
  TRUNK_ZONE: {
    maxDescentRatio: 0,
    upwardBias: 0.85,
    curvatureLimitRatio: 0.4,
  },
  INNER_CANOPY: {
    maxDescentRatio: 0.02,
    upwardBias: 0.6,
    curvatureLimitRatio: 0.7,
  },
  OUTER_CANOPY: {
    maxDescentRatio: 0.06,
    upwardBias: 0.4,
    curvatureLimitRatio: 1.0,
  },
};

// ── Classification functions ──────────────────────────────────────────

/**
 * Classify a branch's structural role based on topology and genealogy.
 *
 * Rules:
 * - generation 0 → TRUNK
 * - genealogyDepth 1 with large subtree → PRIMARY
 * - genealogyDepth 1 with moderate subtree → SECONDARY
 * - genealogyDepth 1 with small subtree → TWIG
 * - genealogyDepth >= 2, isTerminal → TERMINAL_TWIG
 * - genealogyDepth >= 2, not terminal → TWIG
 * - genealogyDepth >= 3 → TWIG
 *
 * Subtree size is relative to the total tree size.
 */
export const classifyBranchRole = (
  genealogyDepth: number,
  skeletonDepth: number,
  isTerminal: boolean,
  descendantCount: number,
  totalDescendants: number,
): SkeletonBranchRole => {
  if (skeletonDepth === 0) return "TRUNK";

  const ratio = totalDescendants > 0 ? descendantCount / totalDescendants : 0;

  if (genealogyDepth === 1) {
    if (ratio >= 0.1) return "PRIMARY";
    if (ratio >= 0.03) return "SECONDARY";
    return "TWIG";
  }

  if (isTerminal) return "TERMINAL_TWIG";

  return genealogyDepth >= 3 ? "TWIG" : "SECONDARY";
};

/**
 * Determine the vertical zone based on the branch's y-coordinate relative
 * to the template bounding box.
 *
 * Zones are defined as fractions of template height from top (minY) to
 * bottom (maxY). The root entry is at the bottom (maxY).
 */
export const determineVerticalZone = (
  pointY: number,
  templateBounds: Bounds,
): VerticalZone => {
  const height = Math.max(1, templateBounds.maxY - templateBounds.minY);
  const normalizedY = (pointY - templateBounds.minY) / height;

  // Bottom 0-15%: ROOT_ZONE (near root entry at bottom)
  if (normalizedY >= 0.85) return "ROOT_ZONE";
  // 15-30% from bottom: TRUNK_ZONE
  if (normalizedY >= 0.7) return "TRUNK_ZONE";
  // 30-60% from bottom: INNER_CANOPY
  if (normalizedY >= 0.4) return "INNER_CANOPY";
  // 60-100% from bottom (top): OUTER_CANOPY
  return "OUTER_CANOPY";
};

/**
 * Check if a candidate's end point violates the zone vertical policy.
 * Returns true if the movement is allowed.
 */
export const isDescentAllowed = (
  startY: number,
  endY: number,
  zone: VerticalZone,
): boolean => {
  const policy = ZONE_VERTICAL_POLICIES[zone];
  if (policy.maxDescentRatio <= 0) {
    // No descent allowed — endY must be above or equal to startY
    return endY <= startY + 1e-9;
  }
  // Controlled descent: endY can be below startY by at most maxDescentRatio
  const descent = endY - startY; // positive = moving down
  return descent <= policy.maxDescentRatio * Math.abs(startY);
};

// ── Enhanced score factor computation ─────────────────────────────────

export interface EnhancedScoreFactors {
  readonly roleFitness: number;       // how well candidate matches role expectations
  readonly zoneCompliance: number;     // vertical zone policy compliance
  readonly siblingCompetition: number; // distance from siblings (0=close, 1=far)
  readonly freeSpaceSeeking: number;   // attraction to empty areas
  readonly densityAvoidance: number;   // repulsion from dense areas
}

export const computeRoleScoreBonus = (
  role: SkeletonBranchRole,
  _genealogyDepth: number,
  descendantCount: number,
  isTerminal: boolean,
): number => {
  // PRIMARY branches get a bonus for having large subtrees
  if (role === "PRIMARY" && descendantCount >= 5) return 0.15;
  // SECONDARY with moderate descendants
  if (role === "SECONDARY" && descendantCount >= 2) return 0.08;
  // TERMINAL_TWIG at proper genealogy depth gets a small bonus
  if (role === "TERMINAL_TWIG" && isTerminal) return 0.05;
  return 0;
};

export const computeZoneComplianceScore = (
  verticalZone: VerticalZone,
  startY: number,
  endY: number,
): number => {
  const policy = ZONE_VERTICAL_POLICIES[verticalZone];
  if (policy.maxDescentRatio <= 0) {
    // Strongly penalize downward growth in zones that forbid it
    if (endY > startY + 1e-9) return 0;
    return 1.0; // Upward growth is ideal
  }
  // For zones that allow descent, score based on how much of the budget is used
  const descent = Math.max(0, endY - startY);
  const maxAllowed = policy.maxDescentRatio * Math.abs(startY);
  if (maxAllowed <= 0) return descent <= 0 ? 1.0 : 0;
  return Math.max(0, 1 - descent / maxAllowed);
};

export const computeSiblingCompetitionScore = (
  siblingDirections: readonly number[],
  candidateAngle: number,
): number => {
  if (siblingDirections.length === 0) return 0.5;
  const minDiff = Math.min(
    ...siblingDirections.map((dir) => Math.abs(angleDiff(candidateAngle, dir))),
  );
  // Normalize: larger angular distance = higher score (less competition)
  return Math.min(1, minDiff / (Math.PI / 4));
};

const angleDiff = (a: number, b: number): number => {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
};

export const computeFreeSpaceScore = (
  endpoint: { x: number; y: number },
  existingEndpoints: readonly { x: number; y: number }[],
  templateWidth: number,
  templateHeight: number,
): number => {
  if (existingEndpoints.length === 0) return 0.5;
  const maxDimension = Math.max(templateWidth, templateHeight, 1);
  const minDist = Math.min(
    ...existingEndpoints.map((ep) =>
      Math.hypot(endpoint.x - ep.x, endpoint.y - ep.y),
    ),
  );
  // Normalize: farther from existing endpoints = more free space
  return Math.min(1, minDist / (maxDimension * 0.15));
};
