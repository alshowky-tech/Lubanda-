import type { BranchThicknessParameters } from "./types.js";

/**
 * Deterministic branch thickness based on person count in the subtree.
 * Thicker branches indicate more descendants; the trunk is always thickest.
 *
 * The trunk base starts at a configurable maximum and tapers linearly
 * toward the tip. Child branches inherit a fraction of parent thickness
 * proportional to their share of the descendant count.
 */
export const BASE_TRUNK_THICKNESS = 14;
export const MINIMUM_BRANCH_THICKNESS = 2;

export const computeBranchThickness = (
  descendantCount: number,
  totalDescendantsInSubtree: number,
  parentThickness: number | null,
  isTrunk: boolean,
  genealogyDepth: number,
): BranchThicknessParameters => {
  if (isTrunk) {
    const baseThickness = Math.max(
      MINIMUM_BRANCH_THICKNESS,
      BASE_TRUNK_THICKNESS * Math.max(0.3, 1 - genealogyDepth * 0.04),
    );
    const tipThickness = Math.max(
      MINIMUM_BRANCH_THICKNESS,
      baseThickness * 0.4,
    );
    return {
      baseThickness: Math.round(baseThickness * 100) / 100,
      tipThickness: Math.round(tipThickness * 100) / 100,
      taperRatio: Math.round((tipThickness / baseThickness) * 100) / 100,
    };
  }

  if (parentThickness === null || totalDescendantsInSubtree <= 0) {
    return {
      baseThickness: MINIMUM_BRANCH_THICKNESS,
      tipThickness: MINIMUM_BRANCH_THICKNESS,
      taperRatio: 1,
    };
  }

  const share =
    totalDescendantsInSubtree > 0
      ? descendantCount / totalDescendantsInSubtree
      : 0.1;
  const baseThickness = Math.max(
    MINIMUM_BRANCH_THICKNESS,
    (parentThickness * Math.max(0.15, share)) / Math.max(1, genealogyDepth * 0.5),
  );
  const tipThickness = Math.max(
    MINIMUM_BRANCH_THICKNESS,
    baseThickness * Math.max(0.3, 1 - genealogyDepth * 0.06),
  );

  return {
    baseThickness: Math.round(baseThickness * 100) / 100,
    tipThickness: Math.round(tipThickness * 100) / 100,
    taperRatio: tipThickness / baseThickness,
  };
};
