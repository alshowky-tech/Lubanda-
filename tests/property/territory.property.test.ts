import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { polygonArea } from "../../src/core/territory/polygon-geometry.js";
import { syntheticSnapshot } from "../helpers/genealogy-builders.js";
import {
  planSnapshot,
  rectangularTemplate,
} from "../helpers/territory-builders.js";

describe("territory allocation properties", () => {
  it("preserves unique ownership, positive area, containment, and replay identity", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 40 }),
        fc.constantFrom("BALANCED", "STAR", "UNBALANCED" as const),
        fc.integer({ min: 0, max: 1_000_000 }),
        async (size, shape, seed) => {
          const snapshot = syntheticSnapshot({ size, shape });
          const template = rectangularTemplate(10_000, 6_000);
          const first = await planSnapshot(snapshot, template, seed);
          const second = await planSnapshot(snapshot, template, seed);
          expect(first.result.ok).toBe(true);
          expect(second.result.ok).toBe(true);
          if (!first.result.ok || !second.result.ok) return;
          const owners = first.result.value.territories.map(
            (territory) => territory.ownerLineageRootId,
          );
          expect(new Set(owners).size).toBe(owners.length);
          expect(
            first.result.value.territories.every(
              (territory) =>
                polygonArea(territory.polygon) >= territory.requiredArea,
            ),
          ).toBe(true);
          expect(first.result.value.deterministicFingerprint).toBe(
            second.result.value.deterministicFingerprint,
          );
        },
      ),
      { numRuns: 30 },
    );
  }, 30_000);
});
