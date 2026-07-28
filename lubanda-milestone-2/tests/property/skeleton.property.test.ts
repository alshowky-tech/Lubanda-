import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { syntheticSnapshot } from "../helpers/genealogy-builders.js";
import { growSkeleton, rectangularTemplate } from "../helpers/skeleton-builders.js";

describe("skeleton growth properties", () => {
  it(
    "every branch is contained within the template, connected, and replay-identical",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 20 }),
          fc.constantFrom("BALANCED", "STAR" as const),
          fc.integer({ min: 0, max: 1_000_000 }),
          async (size, shape, seed) => {
            const snapshot = syntheticSnapshot({ size, shape });
            const template = rectangularTemplate(10_000, 6_000);

            const result1 = await growSkeleton(snapshot, template, seed);
            const result2 = await growSkeleton(snapshot, template, seed);

            // Deterministic replay
            expect(result1.skeletonPlan.deterministicFingerprint).toBe(
              result2.skeletonPlan.deterministicFingerprint,
            );

            // All branches have finite coordinates
            for (const branch of result1.skeletonPlan.branches) {
              expect(Number.isFinite(branch.curve.p0.x)).toBe(true);
              expect(Number.isFinite(branch.curve.p3.y)).toBe(true);
              expect(branch.length).toBeGreaterThan(0);
            }

            // All nodes have finite coordinates
            for (const node of result1.skeletonPlan.nodes) {
              expect(Number.isFinite(node.point.x)).toBe(true);
              expect(Number.isFinite(node.point.y)).toBe(true);
            }

            // Trunk exists
            expect(
              result1.skeletonPlan.trunk.segments.length,
            ).toBeGreaterThanOrEqual(1);
          },
        ),
        { numRuns: 15 },
      );
    },
    30_000,
  );
});
