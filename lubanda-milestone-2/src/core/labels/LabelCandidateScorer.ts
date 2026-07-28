import { distance } from "../geometry/vec2.js";
import type { PersonId, SkeletonBranchId } from "../contracts/identifiers.js";
import type { SkeletonBranch } from "../skeleton/types.js";
import type { LabelConfig } from "../config/types.js";
import type {
  CandidateCollisionQuery,
  LabelCandidate,
  LabelCandidateFamily,
  LabelPlacement,
} from "./types.js";
import { DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "./types.js";
import { validateCandidate } from "./LabelCandidateValidator.js";

const FAMILY_PRIORITY: Record<LabelCandidateFamily, number> = {
  ALIGNED_WITH_BRANCH: 1,
  OFFSET_ABOVE_BRANCH: 2,
  OFFSET_BELOW_BRANCH: 3,
  LATERAL: 4,
  TERMINAL_LEAF: 5,
  CARTOUCHE_ZONE: 6,
};

/**
 * Score label candidates using configurable weights.
 */
export const scoreCandidates = (
  candidates: readonly LabelCandidate[],
  branchMap: ReadonlyMap<SkeletonBranchId, SkeletonBranch>,
  config: LabelConfig,
  collisionQuery: CandidateCollisionQuery,
  fixedPlacements: readonly LabelPlacement[],
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): LabelCandidate[] => {
  const scored: LabelCandidate[] = [];

  for (const candidate of candidates) {
    const branch = findBranchByPersonId(branchMap, candidate.personId);
    const validation = validateCandidate(candidate, branch, config, collisionQuery, fixedPlacements, true);

    if (validation.status === "INVALID") {
      scored.push(Object.freeze({
        ...candidate,
        validationStatus: "INVALID" as const,
        rejectionReasons: validation.rejectionReasons,
        score: null,
        componentScores: undefined as unknown as Readonly<Record<string, number>> | undefined,
      }));
    } else {
      const rotScore = validation.rotationScore ?? computeRotationScore(candidate.rotation, config.maximumRotationDegrees);
      const distScore = validation.anchorDistanceScore ?? computeAnchorDistanceScore(candidate.anchor, candidate.bounds, branch);
      const clearanceScore = validation.clearanceScore ?? computeClearanceScore(candidate, collisionQuery);
      const rhythmScore = computeRhythmScore(candidate, scored);

      const composite =
        weights.obstacleCollision * 1.0 +
        weights.anchorDistance * distScore +
        weights.rotation * rotScore +
        weights.localRhythm * rhythmScore +
        weights.branchClearance * clearanceScore;

      scored.push(Object.freeze({
        ...candidate,
        validationStatus: "VALID" as const,
        rejectionReasons: Object.freeze([]),
        score: Math.round(composite * 10000) / 10000,
        componentScores: Object.freeze({
          rotation: rotScore,
          anchorDistance: distScore,
          clearance: clearanceScore,
          rhythm: rhythmScore,
        }),
      }));
    }
  }

  const validList = scored.filter((c) => c.validationStatus === "VALID");
  const invalidList = scored.filter((c) => c.validationStatus === "INVALID");

  validList.sort((a, b) => {
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff > 0 ? 1 : -1;
    const idDiff = String(a.personId).localeCompare(String(b.personId));
    if (idDiff !== 0) return idDiff;
    const famDiff = (FAMILY_PRIORITY[a.family] ?? 99) - (FAMILY_PRIORITY[b.family] ?? 99);
    if (famDiff !== 0) return famDiff;
    return 0;
  });

  return [...validList, ...invalidList];
};

/**
 * Get only valid, scored candidates sorted by score descending.
 */
export const getRankedValidCandidates = (
  candidates: readonly LabelCandidate[],
): LabelCandidate[] =>
  candidates
    .filter((c) => c.validationStatus === "VALID" && c.score !== null)
    .sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (Math.abs(scoreDiff) > 1e-9) return scoreDiff > 0 ? 1 : -1;
      return String(a.personId).localeCompare(String(b.personId));
    });

const computeRotationScore = (rotation: number, maxDegrees: number): number => {
  const absRot = Math.abs(rotation);
  if (absRot <= 0.01) return 1;
  return Math.max(0, 1 - absRot / maxDegrees);
};

const computeAnchorDistanceScore = (
  anchor: { x: number; y: number },
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  branch: SkeletonBranch | null,
): number => {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const dist = distance(anchor, { x: centerX, y: centerY });
  const maxDist = branch ? Math.max(branch.length * 0.3, 50) : 50;
  return Math.max(0, 1 - Math.min(dist / maxDist, 1));
};

const computeClearanceScore = (
  candidate: LabelCandidate,
  collisionQuery: CandidateCollisionQuery,
): number => {
  const dist = collisionQuery.minClearanceToFixedBranches(candidate.anchor);
  const required = 12;
  if (dist >= required) return 1;
  if (dist <= 0) return 0;
  return dist / required;
};

const computeRhythmScore = (
  candidate: LabelCandidate,
  existing: readonly LabelCandidate[],
): number => {
  const samePerson = existing.filter((c) => c.personId === candidate.personId);
  if (samePerson.length === 0) return 1;
  const avgRotation = samePerson.reduce((sum, c) => sum + Math.abs(c.rotation), 0) / samePerson.length;
  const diff = Math.abs(Math.abs(candidate.rotation) - avgRotation);
  return Math.max(0, 1 - diff / 45);
};

const findBranchByPersonId = (
  branchMap: ReadonlyMap<SkeletonBranchId, SkeletonBranch>,
  personId: PersonId,
): SkeletonBranch | null => {
  for (const branch of branchMap.values()) {
    if (branch.ownerPersonId === personId) return branch;
  }
  return null;
};
