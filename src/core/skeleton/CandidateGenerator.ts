import { classifyPointInPolygon } from "../geometry/polygon.js";
import type { Polygon, Vec2, CubicBezier, Bounds } from "../geometry/types.js";
import { distance, lerp, normalize, subtract } from "../geometry/vec2.js";
import { sampleCubicBezier } from "../geometry/bezier.js";
import { boundsOverlap } from "../geometry/bounds.js";
import { intersectSegments } from "../geometry/segments.js";
import { stableUnit, roundDeterministic } from "../determinism/numeric.js";
import {
  computeAttractorForce,
} from "./AttractorField.js";
import type {
  BranchCandidate,
  BranchRejectionReason,
  CandidateGenerationInput,
  AttractorField,
} from "./types.js";

// ── Internal helpers ──────────────────────────────────────────────────

const defaultSamplingOptions = Object.freeze({
  tolerance: 0.5,
  maxSubdivisionDepth: 12,
});

const bezierLength = (curve: CubicBezier): number => {
  const points = sampleCubicBezier(curve, defaultSamplingOptions);
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1] as Vec2, points[index] as Vec2);
  }
  return total;
};

const computeMaxCurvature = (curve: CubicBezier): number => {
  const samples = sampleCubicBezier(curve, { tolerance: 1, maxSubdivisionDepth: 8 });
  let maxCurvature = 0;
  for (let index = 1; index < samples.length - 1; index += 1) {
    const prev = samples[index - 1] as Vec2;
    const curr = samples[index] as Vec2;
    const next = samples[index + 1] as Vec2;
    const d1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const d2 = { x: next.x - curr.x, y: next.y - curr.y };
    const d1Len = Math.hypot(d1.x, d1.y);
    const d2Len = Math.hypot(d2.x, d2.y);
    if (d1Len < 1e-9 || d2Len < 1e-9) continue;
    const angle = Math.acos(
      Math.max(-1, Math.min(1,
        (d1.x * d2.x + d1.y * d2.y) / (d1Len * d2Len),
      )),
    );
    maxCurvature = Math.max(maxCurvature, angle);
  }
  return maxCurvature;
};

const curveBounds = (curve: CubicBezier): Bounds => {
  const points = sampleCubicBezier(curve, defaultSamplingOptions);
  let minX = points[0]?.x ?? 0;
  let minY = points[0]?.y ?? 0;
  let maxX = minX;
  let maxY = minY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
};

const sampledCurveIntersects = (
  left: readonly Vec2[],
  right: readonly Vec2[],
): boolean => {
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      const intersection = intersectSegments(
        left[leftIndex] as Vec2,
        left[leftIndex + 1] as Vec2,
        right[rightIndex] as Vec2,
        right[rightIndex + 1] as Vec2,
      );
      if (intersection.kind !== "NONE") return true;
    }
  }
  return false;
};

const curveIntersectsAnyExistingCurve = (
  curve: CubicBezier,
  existingBranches: CandidateGenerationInput["existingBranches"],
  ignoredBranchIds: readonly string[],
): boolean => {
  if (existingBranches.length === 0) return false;
  const samples = sampleCubicBezier(curve, defaultSamplingOptions);
  const bounds = curveBounds(curve);
  const ignored = new Set<string>(ignoredBranchIds);
  for (const existing of existingBranches) {
    if (ignored.has(existing.id)) continue;
    if (!boundsOverlap(bounds, curveBounds(existing.curve))) continue;
    const existingSamples = sampleCubicBezier(
      existing.curve,
      defaultSamplingOptions,
    );
    if (sampledCurveIntersects(samples, existingSamples)) return true;
  }
  return false;
};

const curveRespectsTerritory = (
  curve: CubicBezier,
  polygon: Polygon,
  relaxed: boolean,
): boolean => {
  const points = sampleCubicBezier(curve, { tolerance: 4, maxSubdivisionDepth: 10 });
  if (relaxed) {
    // For major lineage branches starting at trunk junction, the start may
    // be outside the territory. Only check that the last 50% enters and stays
    // inside the territory boundary.
    const midPoint = Math.floor(points.length / 2);
    for (let i = midPoint; i < points.length; i += 1) {
      const point = points[i]!;
      if (classifyPointInPolygon(point, polygon) === "OUTSIDE") {
        return false;
      }
    }
    return true;
  }
  return points.every(
    (point) => classifyPointInPolygon(point, polygon) !== "OUTSIDE",
  );
};

// ── Main candidate generation ─────────────────────────────────────────

const generateControlPoint = (
  start: Vec2,
  end: Vec2,
  startDirection: Vec2 | null,
  fragment: number,     // 0 = near start, 1 = near end
  seed: number,
  personId: string,
  directionBias: number,
  attractorField: AttractorField,
): Vec2 => {
  const along = lerp(start, end, 0.2 + fragment * 0.6);
  const midpoint = lerp(start, end, 0.5);

  // Organic jitter
  const jitterX = (stableUnit(`cp-jx-${personId}-${fragment}-${seed}`, seed) * 2 - 1) * 48;
  const jitterY = (stableUnit(`cp-jy-${personId}-${fragment}-${seed}`, seed) * 2 - 1) * 48;

  // Attractor influence at midpoint
  const attractorForce = computeAttractorForce(midpoint, attractorField, seed);
  const attractorOffsetX = attractorForce.x * 36;
  const attractorOffsetY = attractorForce.y * 36;

  // Directional bias
  let dirBiasX = 0;
  let dirBiasY = 0;
  if (startDirection !== null) {
    const normalized = subtract(end, start);
    const len = Math.hypot(normalized.x, normalized.y);
    if (len > 1e-9) {
      dirBiasX =
        (normalized.x / len) * directionBias * 16 +
        (stableUnit(`dir-bias-${personId}-${fragment}`, seed + 1) * 2 - 1) * 12;
      dirBiasY =
        ((normalized.y / len) * directionBias) * 20 +
        (stableUnit(`dir-bias-y-${personId}-${fragment}`, seed + 2) * 2 - 1) * 12;
    }
  }

  return {
    x: along.x + jitterX * 0.5 + attractorOffsetX * 0.35 + dirBiasX,
    y: along.y + jitterY * 0.5 + attractorOffsetY * 0.35 + dirBiasY,
  };
};

export const generateBranchCandidates = (
  input: CandidateGenerationInput,
): readonly BranchCandidate[] => {
  const candidates: BranchCandidate[] = [];
  const personId = input.ownerPersonId;

  for (let index = 0; index < input.candidateCount; index += 1) {
    const seed = input.seed + index * 7 + 3;
    const p1 = generateControlPoint(
      input.startPoint,
      input.endPoint,
      input.startDirection,
      0,
      seed,
      personId,
      0.6 + (stableUnit(`ds-${index}`, seed) * 0.4),
      input.attractors,
    );
    const p2 = generateControlPoint(
      input.startPoint,
      input.endPoint,
      input.startDirection,
      1,
      seed + 3,
      personId,
      0.4 + (stableUnit(`ds2-${index}`, seed + 1) * 0.4),
      input.attractors,
    );

    const curve: CubicBezier = {
      p0: { x: input.startPoint.x, y: input.startPoint.y },
      p1: {
        x: roundDeterministic(p1.x, input.roundingDecimalPlaces),
        y: roundDeterministic(p1.y, input.roundingDecimalPlaces),
      },
      p2: {
        x: roundDeterministic(p2.x, input.roundingDecimalPlaces),
        y: roundDeterministic(p2.y, input.roundingDecimalPlaces),
      },
      p3: { x: input.endPoint.x, y: input.endPoint.y },
    };

    const length = bezierLength(curve);
    const maxCurvature = computeMaxCurvature(curve);
    const rejectionReasons: BranchRejectionReason[] = [];

    // Hard candidate rejection checks
    if (length < input.config.minimumBranchLength) {
      rejectionReasons.push("TOO_SHORT");
    }
    if (maxCurvature > input.config.maxCurvature) {
      rejectionReasons.push("EXCESSIVE_CURVATURE");
    }
    if (!curveRespectsTerritory(curve, input.templatePolygon, false)) {
      rejectionReasons.push("OUT_OF_BOUNDS");
    }
    if (input.territoryPolygon !== null) {
      if (!curveRespectsTerritory(curve, input.territoryPolygon, input.relaxedTerritoryCheck)) {
        rejectionReasons.push("TERRITORY_BOUNDARY_CROSSED");
      }
    }
    if (
      curveIntersectsAnyExistingCurve(
        curve,
        input.existingBranches,
        input.ignoredBranchIds,
      )
    ) {
      rejectionReasons.push("BRANCH_INTERSECTION");
    }

    const valid = rejectionReasons.length === 0;

    candidates.push({
      index,
      curve,
      startPoint: input.startPoint,
      endPoint: input.endPoint,
      length: roundDeterministic(length, input.roundingDecimalPlaces),
      maxCurvature: roundDeterministic(maxCurvature, input.roundingDecimalPlaces),
      score: null,
      valid,
      rejectionReasons: Object.freeze(rejectionReasons),
    });
  }

  return Object.freeze(candidates);
};

// ── Deterministic candidate scoring ───────────────────────────────────

export interface CandidateScoreWeights {
  readonly smoothnessWeight: number;
  readonly naturalnessWeight: number;
  readonly directionContinuityWeight: number;
  readonly lengthEfficiencyWeight: number;
  readonly attractorAlignmentWeight: number;
}

export const DEFAULT_SCORE_WEIGHTS: CandidateScoreWeights = Object.freeze({
  smoothnessWeight: 0.35,
  naturalnessWeight: 0.20,
  directionContinuityWeight: 0.20,
  lengthEfficiencyWeight: 0.10,
  attractorAlignmentWeight: 0.15,
});

export const scoreBranchCandidates = (
  candidates: readonly BranchCandidate[],
  startDirection: Vec2 | null,
  attractorField: AttractorField,
  seed: number,
  weights: CandidateScoreWeights = DEFAULT_SCORE_WEIGHTS,
): readonly BranchCandidate[] => {
  const validCandidates = candidates.filter((c) => c.valid);
  if (validCandidates.length === 0) return candidates;

  const maxLength = Math.max(...validCandidates.map((c) => c.length), 1);
  const maxCurvature = Math.max(...validCandidates.map((c) => c.maxCurvature), 0.01);

  const scored: BranchCandidate[] = candidates.map((candidate) => {
    if (!candidate.valid) return candidate;

    // 1. Smoothness score (lower curvature = higher score)
    const smoothnessScore = 1 - candidate.maxCurvature / (maxCurvature * 1.1);

    // 2. Naturalness score (moderate curvature is natural)
    const curvRatio = candidate.maxCurvature / maxCurvature;
    const naturalnessScore = 1 - Math.abs(curvRatio - 0.35) * 1.5;

    // 3. Direction continuity (consistency with parent direction)
    let directionScore = 0.5;
    if (startDirection !== null) {
      const branchVec = subtract(candidate.endPoint, candidate.startPoint);
      const branchLen = Math.hypot(branchVec.x, branchVec.y);
      if (branchLen > 1e-9) {
        const normalizedBranch = normalize(branchVec);
        const dot =
          normalizedBranch.x * startDirection.x +
          normalizedBranch.y * startDirection.y;
        directionScore = Math.max(0, Math.min(1, (dot + 1) / 2));
      }
    }

    // 4. Length efficiency (moderate better than extreme)
    const lengthRatio = candidate.length / maxLength;
    const lengthScore = 1 - Math.abs(lengthRatio - 0.6) * 1.25;

    // 5. Attractor alignment
    const midpoint = lerp(candidate.startPoint, candidate.endPoint, 0.5);
    const attractorForce = computeAttractorForce(midpoint, attractorField, seed);
    const branchDir = normalize(subtract(candidate.endPoint, candidate.startPoint));
    const attractorScore = Math.max(
      0,
      Math.min(
        1,
        (branchDir.x * attractorForce.x + branchDir.y * attractorForce.y + 1) / 2,
      ),
    );

    const totalScore =
      smoothnessScore * weights.smoothnessWeight +
      naturalnessScore * weights.naturalnessWeight +
      directionScore * weights.directionContinuityWeight +
      lengthScore * weights.lengthEfficiencyWeight +
      attractorScore * weights.attractorAlignmentWeight;

    return {
      ...candidate,
      score: roundDeterministic(totalScore, 4),
    };
  });

  return Object.freeze(scored);
};

export const selectBestCandidate = (
  candidates: readonly BranchCandidate[],
): BranchCandidate | null => {
  const valid = candidates.filter((c) => c.valid && c.score !== null);
  if (valid.length === 0) return null;
  return valid.reduce((best, current) =>
    (current.score ?? 0) > (best.score ?? 0) ? current : best,
  );
};
