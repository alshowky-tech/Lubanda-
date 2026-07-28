import { describe, expect, it } from "vitest";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";
import { growSkeleton } from "../../helpers/skeleton-builders.js";
import { DeterministicRoutingPlanBuilder } from "../../../src/core/routing/RoutingPlanBuilder.js";
import { computeRequiredClearance, computeBranchRadius } from "../../../src/core/routing/ClearanceModel.js";
import { computeRoutingPriority, sortByRoutingPriority } from "../../../src/core/routing/RoutingPriority.js";
import { RoutingValidator } from "../../../src/core/routing/RoutingValidator.js";
import type { SkeletonPlan, SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type { RoutingPlan } from "../../../src/core/routing/types.js";
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
  const territoryPolygons = new Map<string, { points: readonly {x:number;y:number}[] }>();
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
  });

  it("branch radius decreases by generation within configured bounds", () => {
    const r0 = computeBranchRadius(0);
    const r1 = computeBranchRadius(1);
    const r2 = computeBranchRadius(5);
    const r3 = computeBranchRadius(10);
    expect(r0).toBeGreaterThan(r1);
    expect(r1).toBeGreaterThanOrEqual(r2);
    expect(r2).toBeGreaterThanOrEqual(r3);
    expect(r3).toBeGreaterThanOrEqual(2);
    expect(r0).toBeLessThanOrEqual(14);
  });

  it("routing priority is deterministic", () => {
    const b1 = { id: "branch:2:3" as SkeletonBranchId, generation: 1, parentBranchId: null } as unknown as SkeletonBranch;
    const b2 = { id: "branch:3:4" as SkeletonBranchId, generation: 2, parentBranchId: "x" as SkeletonBranchId } as unknown as SkeletonBranch;
    const b3 = { id: "branch:4:5" as SkeletonBranchId, generation: 5, parentBranchId: "y" as SkeletonBranchId } as unknown as SkeletonBranch;
    const p1 = computeRoutingPriority(b1);
    const p2 = computeRoutingPriority(b2);
    const p3 = computeRoutingPriority(b3);
    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
    expect(computeRoutingPriority(b1)).toBe(p1);
    expect(computeRoutingPriority(b2)).toBe(p2);
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
    const reversed = [...branches].reverse().map((b) => b.id);
    const sorted2 = sortByRoutingPriority(reversed, priorityMap);
    expect(sorted1).toEqual(sorted2);
  });

  it("every corridor has finite coordinates and positive area", async () => {
    const { routingPlan } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      for (const pt of record.corridorPolygon.points) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
      }
      const area = polygonArea(record.corridorPolygon);
      expect(area).toBeGreaterThan(0);
    }
  });

  it("every corridor is reasonably close to the branch start and end", async () => {
    const { routingPlan, branchMap } = await buildRoutingPlan();
    for (const record of routingPlan.records) {
      const branch = branchMap.get(record.branchId);
      if (!branch) continue;
      const pts = record.corridorPolygon.points;
      const minDistToStart = Math.min(...pts.map((p) => distance(p, branch.startPoint)));
      const minDistToEnd = Math.min(...pts.map((p) => distance(p, branch.endPoint)));
      expect(minDistToStart).toBeLessThanOrEqual(200);
      expect(minDistToEnd).toBeLessThanOrEqual(200);
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

  it("invalid negative clearance input is rejected", () => {
    expect(() => computeRequiredClearance(-1, 1, 0, 0)).toThrow();
    expect(() => computeRequiredClearance(1, -1, 0, 0)).toThrow();
    expect(() => computeRequiredClearance(1, 1, -1, 0)).toThrow();
    expect(() => computeRequiredClearance(1, 1, 0, -1)).toThrow();
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
    const refIssue = result.issues.find((i) => String(i.code) === "ROUTING_INVALID_BRANCH_REF");
    expect(refIssue).toBeDefined();
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
    const dupIssue = result.issues.find((i) => String(i.code) === "ROUTING_DUPLICATE_RECORD");
    expect(dupIssue).toBeDefined();
  });

  it("duplicated obstacle IDs are rejected", async () => {
    const { skeletonPlan: plan, routingPlan, branchMap } = await buildRoutingPlan();
    const validator = new RoutingValidator();
    const corruptedRecords = routingPlan.records.map((r) => {
      if (r.obstacleBranchIds.length > 0) {
        const duplicated = [...r.obstacleBranchIds, r.obstacleBranchIds[0]!];
        return { ...r, obstacleBranchIds: Object.freeze(duplicated) };
      }
      return r;
    });
    const corruptedPlan = { ...routingPlan, records: Object.freeze(corruptedRecords) };
    const result = validator.validate(corruptedPlan as unknown as RoutingPlan, plan, branchMap);
    const dupIssue = result.issues.find((i) => String(i.code) === "ROUTING_DUPLICATE_OBSTACLE");
    expect(dupIssue).toBeDefined();
  });

  it("routing construction does not mutate the SkeletonPlan", async () => {
    const { skeletonPlan } = await growSkeleton(acceptedSnapshot());
    const originalFingerprint = skeletonPlan.deterministicFingerprint;
    const branchMap = new Map<SkeletonBranchId, SkeletonBranch>(
      skeletonPlan.branches.map((b) => [b.id, b]),
    );
    const builder = new DeterministicRoutingPlanBuilder();
    const territoryPolygons = new Map<string, { points: readonly {x:number;y:number}[] }>();
    for (const b of skeletonPlan.branches) {
      if (b.territoryId) {
        territoryPolygons.set(b.territoryId, { points: [{x:0,y:0},{x:5000,y:0},{x:5000,y:3000},{x:0,y:3000}] });
      }
    }
    await builder.build({ skeletonPlan, skeletonBranchMap: branchMap, territoryPolygons });
    expect(skeletonPlan.deterministicFingerprint).toBe(originalFingerprint);
  });

  it("repeated runs produce the same routing fingerprint", async () => {
    const snapshot = acceptedSnapshot();
    const first = await buildRoutingPlan(snapshot, 42);
    const second = await buildRoutingPlan(snapshot, 42);
    expect(first.routingPlan.deterministicFingerprint).toBe(
      second.routingPlan.deterministicFingerprint,
    );
  });
});
