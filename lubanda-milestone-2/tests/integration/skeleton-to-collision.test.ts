import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";
import { buildGenealogyGraph } from "../../src/core/genealogy/graph.js";
import { DeterministicDemandEngine } from "../../src/core/demand/DemandEngine.js";
import { DeterministicTerritoryPlanner } from "../../src/core/territory/TerritoryPlanner.js";
import { DeterministicSkeletonGrowthEngine } from "../../src/core/skeleton/SkeletonGrowthEngine.js";
import { DeterministicRoutingPlanBuilder as RoutingPlanBuilder } from "../../src/core/routing/RoutingPlanBuilder.js";
import { DeterministicCollisionEngine } from "../../src/core/collision/CollisionEngine.js";
import { resolveLocalCollisions, validateCollisionSafety } from "../../src/core/collision/CollisionResolver.js";
import { acceptedSnapshot } from "../helpers/genealogy-builders.js";
import { rectangularTemplate } from "../helpers/territory-builders.js";
import type { SkeletonBranch } from "../../src/core/skeleton/types.js";
import type { RoutingRecord } from "../../src/core/routing/types.js";
import type { CollisionInput } from "../../src/core/collision/types.js";
import type { Polygon } from "../../src/core/geometry/types.js";
import type { SkeletonBranchId } from "../../src/core/contracts/identifiers.js";

describe("Skeleton → Routing → Collision integration", () => {
  const runFullPipeline = async (seed = 42): Promise<CollisionInput> => {
    const snapshot = acceptedSnapshot();
    const graph = buildGenealogyGraph(snapshot);
    const selectedRootId = graph.roots[0]!;

    // Stage 1: Demand
    const demandPlan = await new DeterministicDemandEngine().compute({
      graph,
      selectedRootId,
      sourceChecksum: snapshot.sourceChecksum,
      configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
    });

    // Stage 2: Territory
    const territoryResult = await new DeterministicTerritoryPlanner().plan({
      graph,
      demandPlan,
      selectedRootId,
      sourceChecksum: snapshot.sourceChecksum,
      templateBoundary: rectangularTemplate(),
      configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
      seed,
    });
    expect(territoryResult.ok).toBe(true);
    if (!territoryResult.ok) throw new Error("Territory planning failed");
    const territoryPlan = territoryResult.value;

    // Stage 3: Skeleton growth
    const skeletonPlan = await new DeterministicSkeletonGrowthEngine().grow({
      graph,
      demandPlan,
      territoryPlan,
      selectedRootId,
      sourceChecksum: snapshot.sourceChecksum,
      configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
      seed,
    });
    expect(skeletonPlan.status).toBe("ACCEPTED");

    // Stage 4: Routing
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
    expect(routingPlan.metadata.recordCount).toBeGreaterThan(0);

    // Stage 5: Collision input
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

  it("Stage 5a: collision indexing succeeds from skeleton+routing data", async () => {
    const input = await runFullPipeline();
    const engine = new DeterministicCollisionEngine();
    const index = engine.index(input);

    expect(index.entries.length).toBeGreaterThan(0);
    expect(index.branchIdMap.size).toBe(index.entries.length);

    for (const entry of index.entries) {
      // Every entry consumes routing data
      expect(entry.routingRecord.branchRadius).toBeGreaterThan(0);
      expect(entry.envelopeRadius).toBeGreaterThan(0);
      // Every entry has sampled curve data from the skeleton
      expect(entry.sampledCurve.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("Stage 5b: collision validation produces structured report", async () => {
    const input = await runFullPipeline();
    const engine = new DeterministicCollisionEngine();
    const report = engine.validateLayout(input);

    // Report has the required fields
    expect(typeof report.accepted).toBe("boolean");
    expect(Array.isArray(report.collisions)).toBe(true);
    expect(report.metrics.branchCount).toBeGreaterThan(0);
    expect(Number.isFinite(report.metrics.minimumClearance)).toBe(true);
    expect(Number.isFinite(report.metrics.maximumClearanceDeficit)).toBe(true);

    // Collision records have proper structure
    for (const collision of report.collisions) {
      expect(collision.branchIdA).toBeTruthy();
      expect(collision.collisionClass).toBeTruthy();
      expect(Number.isFinite(collision.measuredDistance)).toBe(true);
      expect(Number.isFinite(collision.requiredClearance)).toBe(true);
      expect(Number.isFinite(collision.clearanceDeficit)).toBe(true);
    }
  });

  it("Stage 5c: local repair runs without error", async () => {
    const input = await runFullPipeline();
    const result = resolveLocalCollisions(input);

    expect(typeof result.hasCollisions).toBe("boolean");
    expect(Array.isArray(result.pendingActions)).toBe(true);
    expect(Array.isArray(result.unresolvedCollisions)).toBe(true);

    // Pending actions have required fields
    for (const action of result.pendingActions) {
      expect(action.branchId).toBeTruthy();
      expect(action.collisionClass).toBeTruthy();
      expect(action.resolutionScope).toBeTruthy();
      expect(Number.isFinite(action.clearanceDeficit)).toBe(true);
    }
  });

  it("Stage 5d: final validation after local repair is consistent", async () => {
    const input = await runFullPipeline();
    const engine = new DeterministicCollisionEngine();

    // Pre-repair validation
    const preReport = engine.validateLayout(input);

    // Local repair (no-op on skeleton, but produces actions)
    const repairResult = resolveLocalCollisions(input);

    // Post-repair validation — should be identical since resolver doesn't mutate
    const postReport = engine.validateLayout(input);

    // Reports match (deterministic, no mutation)
    expect(JSON.stringify(preReport)).toBe(JSON.stringify(postReport));

    // If repair detected collisions, they show in both report and result
    if (repairResult.hasCollisions) {
      expect(preReport.accepted).toBe(false);
    }
  });

  it("end-to-end: all pipeline stages produce expected outputs", async () => {
    const input = await runFullPipeline(42);
    const engine = new DeterministicCollisionEngine();

    // Index
    const index = engine.index(input);
    expect(index.entries.length).toBeGreaterThan(0);

    // Candidate test for each branch
    for (const entry of index.entries) {
      const testResult = engine.testCandidate(entry.branchId, index, input);
      expect(typeof testResult.valid).toBe("boolean");
      if (testResult.valid) {
        expect(testResult.minimumClearance).toBeGreaterThanOrEqual(0);
      } else {
        expect(testResult.collisions.length).toBeGreaterThan(0);
      }
    }

    // Final validation
    const report = validateCollisionSafety(input);
    expect(report.metrics.testedPairCount).toBeGreaterThanOrEqual(0);
    expect(report.metrics.branchCount).toBe(index.entries.length);

    // Deterministic replay: same seed produces same results
    const input2 = await runFullPipeline(42);
    const report2 = validateCollisionSafety(input2);
    expect(JSON.stringify(report)).toBe(JSON.stringify(report2));
  });
});
