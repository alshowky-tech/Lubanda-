import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type { SkeletonBranch } from "../skeleton/types.js";

/**
 * Deterministic routing priority assignment.
 *
 * Priority order:
 * 1. trunk-connected major lineage branches (generation 1, parentBranchId === null)
 * 2. lower-generation structural branches (generation 1-2)
 * 3. higher-generation secondary branches (generation 3+)
 * 4. terminal twigs (terminal nodes, high generation)
 *
 * Tie-breaking uses branchId for stable ordering.
 */
export const computeRoutingPriority = (
  branch: SkeletonBranch,
): number => {
  // Base priority: lower = more important
  let base: number;

  if (branch.generation === 1 && branch.parentBranchId === null) {
    // Major lineage branches (highest priority)
    base = 100;
  } else if (branch.generation <= 2) {
    // Lower-generation structural branches
    base = 200 + branch.generation * 10;
  } else if (branch.generation <= 4) {
    // Mid-generation
    base = 300 + branch.generation * 10;
  } else {
    // High-generation terminal twigs
    base = 400 + branch.generation * 10;
  }

  // Add stable tiebreaker from branchId (FNV-1a hash reduced to 0-99)
  const idStr = String(branch.id);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < idStr.length; i += 1) {
    hash ^= idStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const tiebreaker = (hash % 100) / 100;

  return Math.round((base + tiebreaker) * 100) / 100;
};

/**
 * Sort branches by routing priority (ascending).
 * Stable: tie-breaking uses the branchId string comparison.
 */
export const sortByRoutingPriority = (
  branchIds: readonly SkeletonBranchId[],
  priorityMap: ReadonlyMap<SkeletonBranchId, number>,
): readonly SkeletonBranchId[] =>
  [...branchIds].sort((left, right) => {
    const pLeft = priorityMap.get(left) ?? Infinity;
    const pRight = priorityMap.get(right) ?? Infinity;
    if (pLeft !== pRight) return pLeft - pRight;
    return String(left).localeCompare(String(right));
  });
