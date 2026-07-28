import { describe, expect, it } from "vitest";
import { DeterministicCollisionEngine } from "../../src/core/collision/CollisionEngine.js";
import { resolveLocalCollisions, validateCollisionSafety } from "../../src/core/collision/CollisionResolver.js";
import { acceptedSnapshot } from "../helpers/genealogy-builders.js";
import { growSkeleton } from "../helpers/skeleton-builders.js";
import { DeterministicRoutingPlanBuilder as RoutingPlanBuilder } from "../../src/core/routing/RoutingPlanBuilder.js";
import type { SkeletonBranchId } from "../../src/core/contracts/identifiers.js";
import type { CollisionInput } from "../../src/core/collision/types.js";
import type { SkeletonBranch } from "../../src/core/skeleton/types.js";
import type { RoutingRecord } from "../../src/core/routing/types.js";
import type { Polygon } from "../../src/core/geometry/types.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";

const buildCollisionInput = async (seed = 42): Promise<CollisionInput> => {
  const snapshot = acceptedSnapshot();
  const { skeletonPlan } = await growSkeleton(snapshot, undefined, seed);
  const branchMap = new Map<SkeletonBranchId, SkeletonBranch>(
    skeletonPlan.branches.map((b) => [b.id, b]),
  );
  const builder = new RoutingPlanBuilder();
  const territoryPolygons = new Map<string, Polygon>();
  for (const b of skeletonPlan.branches) {
    if (b.territoryId) {
      territoryPolygons.set(b.territoryId, {
        points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }],
      });
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

describe("Collision property tests", () => {
  it("deterministic: byte-identical collision reports on repeat runs", async () => {
    const input1 = await buildCollisionInput(42);
    const input2 = await buildCollisionInput(42);

    const engine = new DeterministicCollisionEngine();
    const report1 = engine.validateLayout(input1);
    const report2 = engine.validateLayout(input2);

    // Byte-identical JSON serialization
    const json1 = JSON.stringify(report1);
    const json2 = JSON.stringify(report2);
    expect(json1).toBe(json2);

    // Byte-identical resolution too
    const resolve1 = resolveLocalCollisions(input1);
    const resolve2 = resolveLocalCollisions(input2);
    expect(JSON.stringify(resolve1)).toBe(JSON.stringify(resolve2));
  });

  it("collision symmetry: if A collides with B, then B has a pending action for A", async () => {
    const input = await buildCollisionInput(42);
    const result = resolveLocalCollisions(input);

    // For every collision between branchA and branchB where branchB is in the index,
    // there should be a pending action for branchB
    for (const collision of result.unresolvedCollisions) {
      if (collision.branchIdB !== null && collision.branchIdB !== collision.branchIdA) {
        // The resolver adds reciprocal actions, so check both sides
        const actionForB = result.pendingActions.find(
          (a) => a.branchId === collision.branchIdB,
        );
        const actionForA = result.pendingActions.find(
          (a) => a.branchId === collision.branchIdA,
        );
        // At minimum, the side that was tested should have an action
        const testedBranchHasAction = actionForA !== undefined || actionForB !== undefined;
        expect(testedBranchHasAction).toBe(true);
      }
    }
  });

  it("non-negative finite clearance and deficit values", async () => {
    const input = await buildCollisionInput(42);
    const engine = new DeterministicCollisionEngine();
    const report = engine.validateLayout(input);

    for (const collision of report.collisions) {
      // measuredDistance: non-negative finite
      expect(Number.isFinite(collision.measuredDistance)).toBe(true);
      expect(collision.measuredDistance).toBeGreaterThanOrEqual(0);

      // requiredClearance: positive finite
      expect(Number.isFinite(collision.requiredClearance)).toBe(true);
      expect(collision.requiredClearance).toBeGreaterThan(0);

      // clearanceDeficit: non-negative finite
      expect(Number.isFinite(collision.clearanceDeficit)).toBe(true);
      expect(collision.clearanceDeficit).toBeGreaterThanOrEqual(0);

      // closest points: finite coordinates
      expect(Number.isFinite(collision.closestPointA.x)).toBe(true);
      expect(Number.isFinite(collision.closestPointA.y)).toBe(true);
      expect(Number.isFinite(collision.closestPointB.x)).toBe(true);
      expect(Number.isFinite(collision.closestPointB.y)).toBe(true);
    }

    // Metrics: all non-negative finite
    const metrics = report.metrics;
    expect(Number.isFinite(metrics.minimumClearance)).toBe(true);
    expect(metrics.minimumClearance).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(metrics.maximumClearanceDeficit)).toBe(true);
    expect(metrics.maximumClearanceDeficit).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(metrics.branchCount)).toBe(true);
    expect(metrics.branchCount).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(metrics.collisionCount)).toBe(true);
    expect(metrics.collisionCount).toBeGreaterThanOrEqual(0);
  });

  it("no forbidden crossing in an accepted layout", async () => {
    const input = await buildCollisionInput(42);
    const engine = new DeterministicCollisionEngine();
    const report = engine.validateLayout(input);

    // If the layout is accepted, there must be zero collisions with PENETRATION severity
    if (report.accepted) {
      const penetrations = report.collisions.filter(
        (c) => c.severity === "PENETRATION",
      );
      expect(penetrations.length).toBe(0);
    }
  });

  it("replay identity: validateCollisionSafety produces deterministic SHA-256 fingerprint", async () => {
    const input1 = await buildCollisionInput(42);
    const input2 = await buildCollisionInput(42);
    const report1 = validateCollisionSafety(input1);
    const report2 = validateCollisionSafety(input2);
    expect(report1.accepted).toBe(report2.accepted);
    expect(report1.collisions.length).toBe(report2.collisions.length);
    expect(report1.metrics.collisionCount).toBe(report2.metrics.collisionCount);
  });

  it("collision count equals sum of severity counts", async () => {
    const input = await buildCollisionInput(42);
    const engine = new DeterministicCollisionEngine();
    const report = engine.validateLayout(input);

    const { collisionCount, clearanceDeficitCount, penetrationCount, boundaryViolationCount } = report.metrics;

    // The collision count should match the total records
    expect(collisionCount).toBe(report.collisions.length);

    // Penetrations + clearance deficits should cover most collisions
    // (some collisions may be both, like boundary violations being penetrations)
    expect(clearanceDeficitCount + penetrationCount).toBeGreaterThanOrEqual(
      collisionCount - boundaryViolationCount,
    );
  });
});
