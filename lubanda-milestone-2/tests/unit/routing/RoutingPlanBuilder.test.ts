import { describe, expect, it } from "vitest";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";
import { growSkeleton } from "../../helpers/skeleton-builders.js";
import { DeterministicRoutingPlanBuilder } from "../../../src/core/routing/RoutingPlanBuilder.js";
import { computeRequiredClearance, computeBranchRadius } from "../../../src/core/routing/ClearanceModel.js";
import { computeRoutingPriority, sortByRoutingPriority } from "../../../src/core/routing/RoutingPriority.js";
import { RoutingValidator } from "../../../src/core/routing/RoutingValidator.js";
import { buildBranchCorridor } from "../../../src/core/routing/CorridorBuilder.js";
import type { SkeletonPlan, SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type { RoutingPlan } from "../../../src/core/routing/types.js";
import type { Polygon } from "../../../src/core/geometry/types.js";
import { distance } from "../../../src/core/geometry/vec2.js";
import { polygonArea } from "../../../src/core/territory/polygon-geometry.js";
import type { SkeletonBranchId } from "../../../src/core/contracts/identifiers.js";

const buildRoutingPlan = async (
  snapshot = acceptedSnapshot(),
  seed = 42,
): Promise<{
  skeletonPlan: SkeletonPlan;
  routingPlan: RoutingPlan;
  branchMap: ReadonlyMap<SkeletonBranchId, SkeletonBranch>;
}> => {
  const { skeletonPlan } = await growSkeleton(snapshot, undefined, seed);
  const branchMap = new Map<SkeletonBranchId, SkeletonBranch>(
    skeletonPlan.branches.map((b) => [b.id, b]),
  );
  const builder = new DeterministicRoutingPlanBuilder();
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
  return { skeletonPlan, routingPlan, branchMap };
};

describe("RoutingPlanBuilder", () => {
  it("every routable branch receives exactly one routing record", async () => {
    const { skeletonPlan: skp, routingPlan } = await buildRoutingPlan();
    const routableBranches = skp.branches.filter((b) => b.generation > 0);
    expect(routableBranches.length).toBeGreaterThan(0);
    for (const branch of routableBranches) {
      const records = routingPlan.records.filter((r) => r.branchId === branch.id);
      expect(records.length).toBe(1);
    }
  });

  it("routing records preserve all skeleton topology references", async () => {
    const { routingPlan, branchMap } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      const skeletonBranch = branchMap.get(record.branchId);
      expect(skeletonBranch).toBeDefined();
      if (!skeletonBranch) continue;
      expect(record.parentBranchId).toBe(skeletonBranch.parentBranchId);
      expect(record.startNodeId).toBe(skeletonBranch.startNodeId);
      expect(record.endNodeId).toBe(skeletonBranch.endNodeId);
      expect(record.ownerPersonId).toBe(skeletonBranch.ownerPersonId);
      expect(record.territoryId).toBe(skeletonBranch.territoryId);
      expect(record.generation).toBe(skeletonBranch.generation);
    }
  });

  it("clearance formula is correct", () => {
    expect(computeRequiredClearance(2, 3, 1, 1)).toBe(7);
    expect(computeRequiredClearance(5, 5, 2, 2)).toBe(14);
    expect(computeRequiredClearance(10, 10, 4, 4)).toBe(28);
    expect(() => computeRequiredClearance(-1, 1, 0, 0)).toThrow();
  });

  it("branch radius decreases by generation within configured bounds", () => {
    expect(computeBranchRadius(0)).toBeGreaterThan(computeBranchRadius(1));
    expect(computeBranchRadius(10)).toBeGreaterThanOrEqual(2);
    expect(computeBranchRadius(0)).toBeLessThanOrEqual(14);
  });

  it("routing priority is deterministic and ordered", () => {
    const b1 = { id: "branch:2:3" as SkeletonBranchId, generation: 1, parentBranchId: null } as unknown as SkeletonBranch;
    const b2 = { id: "branch:3:4" as SkeletonBranchId, generation: 2, parentBranchId: "x" as SkeletonBranchId } as unknown as SkeletonBranch;
    const b5 = { id: "branch:5:6" as SkeletonBranchId, generation: 5, parentBranchId: "y" as SkeletonBranchId } as unknown as SkeletonBranch;
    expect(computeRoutingPriority(b1)).toBeLessThan(computeRoutingPriority(b2));
    expect(computeRoutingPriority(b2)).toBeLessThan(computeRoutingPriority(b5));
  });

  it("routing priority is stable regardless of input array order", () => {
    const branches = [
      { id: "branch:2:3" as SkeletonBranchId, generation: 1, parentBranchId: null },
      { id: "branch:3:4" as SkeletonBranchId, generation: 2, parentBranchId: "x" as SkeletonBranchId },
      { id: "branch:4:5" as SkeletonBranchId, generation: 3, parentBranchId: "y" as SkeletonBranchId },
      { id: "branch:5:6" as SkeletonBranchId, generation: 6, parentBranchId: "z" as SkeletonBranchId },
    ] as unknown as SkeletonBranch[];
    const priorityMap = new Map(branches.map((b) => [b.id, computeRoutingPriority(b)]));
    const sorted1 = sortByRoutingPriority(branches.map((b) => b.id), priorityMap);
    const sorted2 = sortByRoutingPriority([...branches].reverse().map((b) => b.id), priorityMap);
    expect(sorted1).toEqual(sorted2);
  });

  it("every corridor has finite coordinates and positive area (non-BLOCKED)", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      if (record.status === "BLOCKED") continue;
      for (const pt of record.corridorPolygon.points) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
      }
      expect(polygonArea(record.corridorPolygon)).toBeGreaterThan(0);
    }
  });

  it("every corridor touches the branch start and end regions", async () => {
    const { routingPlan, branchMap } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      if (record.status === "BLOCKED") continue;
      const branch = branchMap.get(record.branchId);
      if (!branch) continue;
      const pts = record.corridorPolygon.points;
      const distToStart = Math.min(...pts.map((p) => distance(p, branch.startPoint)));
      const distToEnd = Math.min(...pts.map((p) => distance(p, branch.endPoint)));
      expect(distToStart).toBeLessThanOrEqual(200);
      expect(distToEnd).toBeLessThanOrEqual(200);
    }
  });

  it("obstacle IDs are unique and sorted", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      const unique = new Set(record.obstacleBranchIds);
      expect(unique.size).toBe(record.obstacleBranchIds.length);
      for (let i = 1; i < record.obstacleBranchIds.length; i += 1) {
        expect(String(record.obstacleBranchIds[i - 1]!).localeCompare(
          String(record.obstacleBranchIds[i]!),
        )).toBeLessThanOrEqual(0);
      }
    }
  });

  it("a branch never lists itself as an obstacle", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      expect(record.obstacleBranchIds.includes(record.branchId)).toBe(false);
    }
  });

  it("direct-parent attachment is not treated as obstacle", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      if (record.parentBranchId !== null) {
        expect(record.obstacleBranchIds.includes(record.parentBranchId)).toBe(false);
      }
    }
  });

  it("every obstacle has a matching obstacleClearance record", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      const clearanceIds = new Set(record.obstacleClearances.map((c) => c.obstacleBranchId));
      for (const obsId of record.obstacleBranchIds) {
        expect(clearanceIds.has(obsId)).toBe(true);
      }
      expect(clearanceIds.size).toBe(record.obstacleClearances.length);
    }
  });

  it("obstacleClearances have finite positive values", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      for (const oc of record.obstacleClearances) {
        expect(Number.isFinite(oc.requiredClearance)).toBe(true);
        expect(oc.requiredClearance).toBeGreaterThan(0);
        expect(Number.isFinite(oc.sampledMinSegmentDistance)).toBe(true);
        expect(oc.sampledMinSegmentDistance).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("requiredClearance is the maximum of all pairwise clearances", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      if (record.obstacleClearances.length === 0) {
        // Self-clearance is the baseline
        const selfClearance = computeRequiredClearance(
          record.branchRadius, record.branchRadius,
          record.safetyMargin, record.safetyMargin,
        );
        expect(record.requiredClearance).toBeGreaterThanOrEqual(selfClearance);
      } else {
        // requiredClearance must be >= each pairwise clearance
        for (const oc of record.obstacleClearances) {
          expect(record.requiredClearance).toBeGreaterThanOrEqual(oc.requiredClearance - 0.001);
        }
      }
    }
  });

  it("corrupted branch references are rejected", async () => {
    const { skeletonPlan: plan, routingPlan, branchMap } = await buildRoutingPlan();
    const validator = new RoutingValidator();
    const corruptedPlan = {
      ...routingPlan,
      records: Object.freeze([
        ...routingPlan.records,
        { ...routingPlan.records[0]!, branchId: "nonexistent-branch" as SkeletonBranchId },
      ]),
    };
    const result = validator.validate(corruptedPlan as unknown as RoutingPlan, plan, branchMap);
    expect(result.accepted).toBe(false);
    expect(result.issues.some((i) => String(i.code) === "ROUTING_INVALID_BRANCH_REF")).toBe(true);
  });

  it("duplicated routing records are rejected", async () => {
    const { skeletonPlan: plan, routingPlan, branchMap } = await buildRoutingPlan();
    const validator = new RoutingValidator();
    const corruptedPlan = {
      ...routingPlan,
      records: Object.freeze([...routingPlan.records, routingPlan.records[0]!]),
    };
    const result = validator.validate(corruptedPlan as unknown as RoutingPlan, plan, branchMap);
    expect(result.accepted).toBe(false);
    expect(result.issues.some((i) => String(i.code) === "ROUTING_DUPLICATE_RECORD")).toBe(true);
  });

  it("duplicated obstacle IDs are rejected", async () => {
    const { skeletonPlan: plan, routingPlan, branchMap } = await buildRoutingPlan();
    const validator = new RoutingValidator();
    const corruptedRecords = routingPlan.records.map((r) => {
      if (r.obstacleBranchIds.length > 0) {
        const duplicated = [...r.obstacleBranchIds, r.obstacleBranchIds[0]!];
        return {
          ...r,
          obstacleBranchIds: Object.freeze(duplicated),
          obstacleClearances: Object.freeze([...r.obstacleClearances, r.obstacleClearances[0]!]),
        };
      }
      return r;
    });
    const corruptedPlan = { ...routingPlan, records: Object.freeze(corruptedRecords) };
    const result = validator.validate(corruptedPlan as unknown as RoutingPlan, plan, branchMap);
    expect(result.issues.some((i) => String(i.code) === "ROUTING_DUPLICATE_OBSTACLE")).toBe(true);
  });

  it("BLOCKED status requires empty corridor; ROUTABLE/TERMINAL require non-empty", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      if (record.status === "BLOCKED") {
        expect(record.corridorPolygon.points.length).toBeLessThan(3);
      } else {
        expect(record.corridorPolygon.points.length).toBeGreaterThanOrEqual(3);
        expect(polygonArea(record.corridorPolygon)).toBeGreaterThan(0);
      }
    }
  });

  it("topology equality against skeleton", async () => {
    const { skeletonPlan, routingPlan, branchMap } = await buildRoutingPlan();
    const validator = new RoutingValidator();
    const result = validator.validate(routingPlan, skeletonPlan, branchMap);
    expect(result.accepted).toBe(true);
  });

  it("repeated runs produce the same routing fingerprint", async () => {
    const snapshot = acceptedSnapshot();
    const first = await buildRoutingPlan(snapshot, 42);
    const second = await buildRoutingPlan(snapshot, 42);
    expect(first.routingPlan.deterministicFingerprint).toBe(
      second.routingPlan.deterministicFingerprint,
    );
  });

  it("routing construction does not mutate the SkeletonPlan", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    const originalFingerprint = skeletonPlan.deterministicFingerprint;
    const branchMap = new Map<SkeletonBranchId, SkeletonBranch>(
      skeletonPlan.branches.map((b) => [b.id, b]),
    );
    const builder = new DeterministicRoutingPlanBuilder();
    const territoryPolygons = new Map<string, Polygon>();
    for (const b of skeletonPlan.branches) {
      if (b.territoryId) {
        territoryPolygons.set(b.territoryId, { points: [{x:0,y:0},{x:5000,y:0},{x:5000,y:3000},{x:0,y:3000}] });
      }
    }
    await builder.build({ skeletonPlan, skeletonBranchMap: branchMap, territoryPolygons });
    expect(skeletonPlan.deterministicFingerprint).toBe(originalFingerprint);
  });

  it("concave territory is explicitly rejected", () => {
    // A concave L-shaped polygon should not be supported
    const concave = {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 100 },
        { x: 0, y: 100 },
      ],
    };
    const branch = {
      id: "test-branch" as SkeletonBranchId,
      startPoint: { x: 10, y: 10 },
      endPoint: { x: 90, y: 90 },
      curve: { p0: { x: 10, y: 10 }, p1: { x: 10, y: 10 }, p2: { x: 90, y: 90 }, p3: { x: 90, y: 90 } },
    } as unknown as SkeletonBranch;
    const result = buildBranchCorridor({
      branch,
      branchRadius: 2,
      safetyMargin: 1,
      territoryPolygon: concave,
      isMajorLineage: false,
    });
    expect(result.points.length).toBeLessThan(3);
  });

  it("obstacleClearances are sorted deterministically", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      for (let i = 1; i < record.obstacleClearances.length; i += 1) {
        expect(
          String(record.obstacleClearances[i - 1]!.obstacleBranchId).localeCompare(
            String(record.obstacleClearances[i]!.obstacleBranchId),
          ),
        ).toBeLessThanOrEqual(0);
      }
    }
  });
});
