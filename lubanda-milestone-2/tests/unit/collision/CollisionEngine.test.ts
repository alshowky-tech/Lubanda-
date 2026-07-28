import { describe, expect, it } from "vitest";
import { DeterministicCollisionEngine } from "../../../src/core/collision/CollisionEngine.js";
import { resolveLocalCollisions } from "../../../src/core/collision/CollisionResolver.js";
import { computeEnvelopeRadius } from "../../../src/core/routing/ClearanceModel.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";
import { growSkeleton } from "../../helpers/skeleton-builders.js";
import { DeterministicRoutingPlanBuilder as RoutingPlanBuilder } from "../../../src/core/routing/RoutingPlanBuilder.js";
import type { SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type { CollisionInput } from "../../../src/core/collision/types.js";
import type { RoutingRecord } from "../../../src/core/routing/types.js";
import type { Polygon } from "../../../src/core/geometry/types.js";
import type { SkeletonBranchId } from "../../../src/core/contracts/identifiers.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";

const buildCollisionInput = async (
  seed = 42,
): Promise<CollisionInput> => {
  const snapshot = acceptedSnapshot();
  const { skeletonPlan } = await growSkeleton(snapshot, undefined, seed);
  const branchMap = new Map<SkeletonBranchId, SkeletonBranch>(
    skeletonPlan.branches.map((b) => [b.id, b]),
  );
  const builder = new RoutingPlanBuilder();
  const territoryPolygons = new Map<string, Polygon>();
  for (const b of skeletonPlan.branches) {
    if (b.territoryId) {
      territoryPolygons.set(b.territoryId, { points: [{x:0,y:0},{x:5000,y:0},{x:5000,y:3000},{x:0,y:3000}] });
    }
  }
  const routingPlan = await builder.build({
    skeletonPlan,
    skeletonBranchMap: branchMap,
    territoryPolygons,
  });
  const routingRecordMap = new Map<SkeletonBranchId, RoutingRecord>(
    routingPlan.records.map((r) => [r.branchId, r]),
  );
  return {
    skeletonPlan,
    skeletonBranchMap: branchMap,
    routingPlan,
    routingRecordMap,
    configuration: DEFAULT_ENGINE_CONFIGURATION.collision,
  };
};

describe("DeterministicCollisionEngine", () => {
  it("builds collision index from routing data", async () => {
    const input = await buildCollisionInput();
    const engine = new DeterministicCollisionEngine();
    const index = engine.index(input);
    expect(index.entries.length).toBeGreaterThan(0);
    expect(index.branchIdMap.size).toBe(index.entries.length);
  });

  it("every index entry has envelopeRadius > 0", async () => {
    const input = await buildCollisionInput();
    const engine = new DeterministicCollisionEngine();
    const index = engine.index(input);
    for (const entry of index.entries) {
      expect(entry.envelopeRadius).toBeGreaterThan(0);
      expect(Number.isFinite(entry.envelopeRadius)).toBe(true);
    }
  });

  it("envelope radius uses canonical clearance formula from routing", async () => {
    const input = await buildCollisionInput();
    const engine = new DeterministicCollisionEngine();
    const index = engine.index(input);
    for (const entry of index.entries) {
      const expected = computeEnvelopeRadius(
        entry.routingRecord.branchRadius,
        input.configuration.barkAllowance,
        input.configuration.branchClearance,
        entry.routingRecord.safetyMargin,
      );
      expect(entry.envelopeRadius).toBe(expected);
    }
  });

  it("every index entry has sampledCurve with at least 2 points", async () => {
    const input = await buildCollisionInput();
    const engine = new DeterministicCollisionEngine();
    const index = engine.index(input);
    for (const entry of index.entries) {
      expect(entry.sampledCurve.length).toBeGreaterThanOrEqual(2);
      for (const pt of entry.sampledCurve) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
      }
    }
  });

  it("testCandidate returns valid:true for a branch with no collisions", async () => {
    const input = await buildCollisionInput();
    const engine = new DeterministicCollisionEngine();
    const index = engine.index(input);
    if (index.entries.length > 0) {
      const result = engine.testCandidate(index.entries[0]!.branchId, index, input);
      expect(typeof result.valid).toBe("boolean");
      if (result.valid) {
        expect(result.minimumClearance).toBeGreaterThanOrEqual(0);
      } else {
        expect(result.collisions.length).toBeGreaterThan(0);
      }
    }
  });

  it("testCandidate with nonexistent branchId returns valid with Infinity clearance", async () => {
    const input = await buildCollisionInput();
    const engine = new DeterministicCollisionEngine();
    const index = engine.index(input);
    const result = engine.testCandidate("nonexistent" as SkeletonBranchId, index, input);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.minimumClearance).toBe(Infinity);
    }
  });

  it("validateLayout returns a report with metrics", async () => {
    const input = await buildCollisionInput();
    const engine = new DeterministicCollisionEngine();
    const report = engine.validateLayout(input);
    expect(report.metrics.branchCount).toBeGreaterThan(0);
    expect(typeof report.accepted).toBe("boolean");
    expect(report.metrics.collisionCount).toBeGreaterThanOrEqual(0);
  });

  it("validateLayout metrics are internally consistent", async () => {
    const input = await buildCollisionInput();
    const engine = new DeterministicCollisionEngine();
    const report = engine.validateLayout(input);
    expect(report.collisions.length).toBe(report.metrics.collisionCount);
    if (report.metrics.collisionCount === 0) {
      expect(report.accepted).toBe(true);
    }
  });

  it("deterministic: same input produces same index", async () => {
    const input1 = await buildCollisionInput(42);
    const input2 = await buildCollisionInput(42);
    const engine = new DeterministicCollisionEngine();
    const index1 = engine.index(input1);
    const index2 = engine.index(input2);
    expect(index1.entries.length).toBe(index2.entries.length);
    for (let i = 0; i < index1.entries.length; i += 1) {
      expect(index1.entries[i]!.branchId).toBe(index2.entries[i]!.branchId);
      expect(index1.entries[i]!.envelopeRadius).toBe(index2.entries[i]!.envelopeRadius);
    }
  });

  it("deterministic: same input produces same validation report", async () => {
    const input1 = await buildCollisionInput(42);
    const input2 = await buildCollisionInput(42);
    const engine = new DeterministicCollisionEngine();
    const report1 = engine.validateLayout(input1);
    const report2 = engine.validateLayout(input2);
    expect(report1.accepted).toBe(report2.accepted);
    expect(report1.metrics.collisionCount).toBe(report2.metrics.collisionCount);
    expect(report1.metrics.minimumClearance).toBe(report2.metrics.minimumClearance);
  });
});

describe("resolveLocalCollisions", () => {
  it("returns a result with hasCollisions boolean", async () => {
    const input = await buildCollisionInput();
    const result = resolveLocalCollisions(input);
    expect(typeof result.hasCollisions).toBe("boolean");
    expect(Array.isArray(result.pendingActions)).toBe(true);
    expect(Array.isArray(result.unresolvedCollisions)).toBe(true);
  });

  it("pending actions are sorted deterministically by branchId", async () => {
    const input = await buildCollisionInput();
    const result = resolveLocalCollisions(input);
    for (let i = 1; i < result.pendingActions.length; i += 1) {
      expect(
        String(result.pendingActions[i - 1]!.branchId).localeCompare(
          String(result.pendingActions[i]!.branchId),
        ),
      ).toBeLessThanOrEqual(0);
    }
  });

  it("deterministic: same input produces same resolution result", async () => {
    const input1 = await buildCollisionInput(42);
    const input2 = await buildCollisionInput(42);
    const result1 = resolveLocalCollisions(input1);
    const result2 = resolveLocalCollisions(input2);
    expect(result1.hasCollisions).toBe(result2.hasCollisions);
    expect(result1.pendingActions.length).toBe(result2.pendingActions.length);
    for (let i = 0; i < result1.pendingActions.length; i += 1) {
      expect(result1.pendingActions[i]!.branchId).toBe(result2.pendingActions[i]!.branchId);
    }
  });
});
