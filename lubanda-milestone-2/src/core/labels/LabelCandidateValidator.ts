import type { LabelConfig } from "../config/types.js";
import type { SkeletonBranch } from "../skeleton/types.js";
import type {
  CandidateCollisionQuery,
  LabelCandidateRejectionRecord,
  LabelCandidate,
  LabelPlacement,
} from "./types.js";

const EPSILON = 1e-7;

/**
 * Validate a single candidate against fixed obstacles.
 */
export const validateCandidate = (
  candidate: LabelCandidate,
  branch: SkeletonBranch | null,
  config: LabelConfig,
  collisionQuery: CandidateCollisionQuery,
  fixedPlacements: readonly LabelPlacement[],
  _allowNearClearance: boolean,
): { status: "VALID" | "INVALID"; rejectionReasons: readonly LabelCandidateRejectionRecord[]; rotationScore?: number; anchorDistanceScore?: number; clearanceScore?: number } => {
  const reasons: LabelCandidateRejectionRecord[] = [];

  // 1. No branch
  if (!branch) {
    reasons.push({ code: "NO_BRANCH_FOR_PERSON", message: "No skeleton branch for this person" });
    return { status: "INVALID", rejectionReasons: Object.freeze(reasons) };
  }

  // 2. Rotation limit
  const absRotation = Math.abs(candidate.rotation);
  if (absRotation > config.maximumRotationDegrees + EPSILON) {
    reasons.push({
      code: "ROTATION_EXCEEDS_LIMIT",
      message: `Rotation ${candidate.rotation}° exceeds limit ${config.maximumRotationDegrees}°`,
      details: { rotation: candidate.rotation, maxDegrees: config.maximumRotationDegrees },
    });
  }

  // 3. Finite geometry
  if (!Number.isFinite(candidate.bounds.minX) || !Number.isFinite(candidate.bounds.maxX) ||
      !Number.isFinite(candidate.bounds.minY) || !Number.isFinite(candidate.bounds.maxY) ||
      !Number.isFinite(candidate.anchor.x) || !Number.isFinite(candidate.anchor.y)) {
    reasons.push({ code: "FINITE_GEOMETRY_FAILURE", message: "Candidate has non-finite geometry" });
  }

  // 4. Branch overlap with self-anchor exemption
  const selfAnchorRadius = Math.max(branch.thickness.baseThickness, 8);
  if (collisionQuery.overlapsFixedObstacle(candidate.bounds, candidate.anchor, selfAnchorRadius)) {
    reasons.push({ code: "BRANCH_PENETRATION", message: "Candidate bounds overlap branch envelope" });
  }

  // 5. Boundary containment
  if (!isInsideBoundary(candidate, collisionQuery)) {
    reasons.push({ code: "BOUNDARY_VIOLATION", message: "Candidate extends outside template boundary" });
  }

  // 6. Fixed label overlap
  for (const fp of fixedPlacements) {
    if (rectsOverlap(candidate.bounds, fp.bounds)) {
      reasons.push({ code: "OVERLAPS_FIXED_LABEL", message: `Overlaps fixed label for person ${fp.personId}` });
      break;
    }
  }

  // 7. Leader crossing
  if (candidate.leaderLength > EPSILON) {
    const nearestPt = nearestPointOnRect(candidate.anchor, candidate.bounds);
    if (collisionQuery.leaderCrossesFixedObstacle(candidate.anchor, nearestPt)) {
      reasons.push({ code: "LEADER_CROSSING", message: "Leader line crosses a branch envelope" });
    }
  }

  const isInvalid = reasons.length > 0;
  if (isInvalid) {
    return { status: "INVALID", rejectionReasons: Object.freeze(reasons) };
  }

  // Score-range values for valid candidates
  const rotationScore = absRotation <= EPSILON ? 1 : Math.max(0, 1 - absRotation / config.maximumRotationDegrees);
  const anchorDist = distance(candidate.anchor, rectCenter(candidate.bounds));
  const maxDist = Math.max(branch.length * 0.3, 50);
  const anchorDistanceScore = Math.max(0, 1 - Math.min(anchorDist / maxDist, 1));
  const clearanceScore = 1.0;

  return {
    status: "VALID",
    rejectionReasons: Object.freeze(reasons),
    rotationScore,
    anchorDistanceScore,
    clearanceScore,
  };
};

const rectsOverlap = (
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean =>
  !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);

const isInsideBoundary = (candidate: LabelCandidate, cq: CandidateCollisionQuery): boolean => {
  const corners: { x: number; y: number }[] = [
    { x: candidate.bounds.minX, y: candidate.bounds.minY },
    { x: candidate.bounds.maxX, y: candidate.bounds.minY },
    { x: candidate.bounds.maxX, y: candidate.bounds.maxY },
    { x: candidate.bounds.minX, y: candidate.bounds.maxY },
  ];
  for (const c of corners) {
    if (!cq.isInsideBoundary(c)) return false;
  }
  return true;
};

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

const nearestPointOnRect = (
  pt: { x: number; y: number },
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): { x: number; y: number } => ({
  x: Math.max(rect.minX, Math.min(rect.maxX, pt.x)),
  y: Math.max(rect.minY, Math.min(rect.maxY, pt.y)),
});

const rectCenter = (
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): { x: number; y: number } => ({
  x: (rect.minX + rect.maxX) / 2,
  y: (rect.minY + rect.maxY) / 2,
});
