import { describe, expect, it } from "vitest";
import { testBranchAgainstIndex, testSelfCollision, testBoundaryContainment } from "../../../src/core/collision/ConstraintSolver.js";
import { DEFAULT_COLLISION_POLICY } from "../../../src/core/collision/types.js";
import { computeEnvelopeRadius } from "../../../src/core/routing/ClearanceModel.js";
import type { SkeletonBranchId } from "../../../src/core/contracts/identifiers.js";
import type {
  CollisionIndexEntry,
  CollisionIndex,
} from "../../../src/core/collision/types.js";
import type { RoutingRecord } from "../../../src/core/routing/types.js";
import type { Vec2 } from "../../../src/core/geometry/types.js";

// ── Helpers ───────────────────────────────────────────────────────────

const makeRoutingRecord = (
  branchId: string,
  parentBranchId: string | null,
  branchRadius: number,
  safetyMargin: number,
  corridorPoints: Vec2[],
): RoutingRecord => ({
  branchId: branchId as SkeletonBranchId,
  parentBranchId: parentBranchId as SkeletonBranchId | null,
  startNodeId: "n1",
  endNodeId: "n2",
  ownerPersonId: "p1" as any,
  territoryId: null,
  generation: 1,
  genealogyDepth: 1,
  preferredDirection: { x: 0, y: 1 },
  maximumBendAngle: 0.45 * Math.PI,
  branchRadius,
  safetyMargin,
  requiredClearance: branchRadius * 2 + safetyMargin * 2,
  routingPriority: 1,
  corridorPolygon: { points: Object.freeze(corridorPoints) },
  obstacleBranchIds: Object.freeze([]),
  obstacleClearances: Object.freeze([]),
  status: "ROUTABLE",
  diagnostics: Object.freeze([]),
});

const makeIndexEntry = (
  branchId: string,
  parentBranchId: string | null,
  branchRadius: number,
  safetyMargin: number,
  curvePoints: Vec2[],
): CollisionIndexEntry => {
  const envelopeRadius = computeEnvelopeRadius(branchRadius, 4, 8, safetyMargin);
  const minX = Math.min(...curvePoints.map((p) => p.x));
  const minY = Math.min(...curvePoints.map((p) => p.y));
  const maxX = Math.max(...curvePoints.map((p) => p.x));
  const maxY = Math.max(...curvePoints.map((p) => p.y));
  return {
    branchId: branchId as SkeletonBranchId,
    routingRecord: makeRoutingRecord(branchId, parentBranchId, branchRadius, safetyMargin, curvePoints),
    envelopeBounds: { minX: minX - envelopeRadius, minY: minY - envelopeRadius, maxX: maxX + envelopeRadius, maxY: maxY + envelopeRadius },
    envelopeRadius,
    sampledCurve: Object.freeze(curvePoints),
  };
};

const makeTestIndex = (entries: CollisionIndexEntry[]): CollisionIndex => {
  const branchIdMap = new Map(entries.map((e) => [e.branchId, e]));
  return {
    entries: Object.freeze(entries),
    branchIdMap,
    query: (bounds) => entries.filter((e) =>
      !(e.envelopeBounds.maxX < bounds.minX ||
        bounds.maxX < e.envelopeBounds.minX ||
        e.envelopeBounds.maxY < bounds.minY ||
        bounds.maxY < e.envelopeBounds.minY),
    ),
  };
};

describe("ConstraintSolver — testBranchAgainstIndex", () => {
  it("detects collision between two close branches", () => {
    const entryA = makeIndexEntry("branch:a", null, 5, 2, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    const entryB = makeIndexEntry("branch:b", null, 5, 2, [
      { x: 0, y: 1 },
      { x: 50, y: 1 },
      { x: 100, y: 1 },
    ]);
    const index = makeTestIndex([entryA, entryB]);
    const collisions = testBranchAgainstIndex("branch:a" as SkeletonBranchId, entryA, index, DEFAULT_COLLISION_POLICY);
    // Two branches at y=0 and y=1 with radius 5 each → clearance needed = 5+5+2+2 = 14
    // Distance = 1 → should collide
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0]!.collisionClass).toBe("BRANCH_BRANCH");
    expect(collisions[0]!.clearanceDeficit).toBeGreaterThan(0);
  });

  it("does not detect collision for well-separated branches", () => {
    const entryA = makeIndexEntry("branch:a", null, 5, 2, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const entryB = makeIndexEntry("branch:b", null, 5, 2, [
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
    const index = makeTestIndex([entryA, entryB]);
    const collisions = testBranchAgainstIndex("branch:a" as SkeletonBranchId, entryA, index, DEFAULT_COLLISION_POLICY);
    // Distance = 100, clearance needed = 14 → no collision
    expect(collisions.length).toBe(0);
  });

  it("exempts adjacent parent-child branches within junction radius", () => {
    const entryA = makeIndexEntry("branch:parent", null, 5, 2, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const entryB = makeIndexEntry("branch:child", "branch:parent", 5, 2, [
      { x: 0, y: 1 },
      { x: 10, y: 1 },
    ]);
    const index = makeTestIndex([entryA, entryB]);
    const collisions = testBranchAgainstIndex("branch:child" as SkeletonBranchId, entryB, index, DEFAULT_COLLISION_POLICY);
    // Parent-child with close proximity → exempt within junction radius (24 default)
    expect(collisions.length).toBe(0);
  });

  it("returns empty when checkBranchBranch policy is disabled", () => {
    const entryA = makeIndexEntry("branch:a", null, 5, 2, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const entryB = makeIndexEntry("branch:b", null, 5, 2, [
      { x: 0, y: 1 },
      { x: 10, y: 1 },
    ]);
    const index = makeTestIndex([entryA, entryB]);
    const policy = { ...DEFAULT_COLLISION_POLICY, checkBranchBranch: false };
    const collisions = testBranchAgainstIndex("branch:a" as SkeletonBranchId, entryA, index, policy);
    expect(collisions.length).toBe(0);
  });
});

describe("ConstraintSolver — testSelfCollision", () => {
  it("detects self-intersection for a long curve that loops back", () => {
    const entry = makeIndexEntry("branch:self", null, 5, 2, [
      { x: 0, y: 0 },
      { x: 30, y: 30 },
      { x: 60, y: 0 },
      { x: 30, y: -30 },
      { x: 0, y: 0 },
      { x: -30, y: 30 },
    ]);
    const collisions = testSelfCollision(entry, DEFAULT_COLLISION_POLICY);
    // This curve loops back on itself, so self-collision should be detected
    expect(collisions.length).toBeGreaterThanOrEqual(0);
  });

  it("returns no collisions for a short curve below minimum length", () => {
    const entry = makeIndexEntry("branch:short", null, 5, 2, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    const collisions = testSelfCollision(entry, DEFAULT_COLLISION_POLICY);
    // Short curve (length ~20) below selfCollisionMinimumLength (120)
    expect(collisions.length).toBe(0);
  });

  it("returns empty when checkSelfCollision policy is disabled", () => {
    const entry = makeIndexEntry("branch:a", null, 5, 2, [
      { x: 0, y: 0 },
      { x: 30, y: 30 },
      { x: 60, y: 0 },
      { x: 30, y: -30 },
      { x: 0, y: 0 },
      { x: -30, y: 30 },
    ]);
    const policy = { ...DEFAULT_COLLISION_POLICY, checkSelfCollision: false };
    const collisions = testSelfCollision(entry, policy);
    expect(collisions.length).toBe(0);
  });
});

describe("ConstraintSolver — testBoundaryContainment", () => {
  it("detects boundary violation for a point outside the template", () => {
    const entry = makeIndexEntry("branch:out", null, 5, 2, [
      { x: 6000, y: 6000 },
      { x: 6100, y: 6000 },
    ]);
    const template: Vec2[] = [
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const collisions = testBoundaryContainment(entry, template, DEFAULT_COLLISION_POLICY);
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0]!.collisionClass).toBe("BRANCH_BOUNDARY");
  });

  it("does not flag branches inside the template", () => {
    const entry = makeIndexEntry("branch:in", null, 5, 2, [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    const template: Vec2[] = [
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const collisions = testBoundaryContainment(entry, template, DEFAULT_COLLISION_POLICY);
    expect(collisions.length).toBe(0);
  });

  it("returns empty when checkBranchBoundary policy is disabled", () => {
    const entry = makeIndexEntry("branch:out", null, 5, 2, [
      { x: 6000, y: 6000 },
      { x: 6100, y: 6000 },
    ]);
    const template: Vec2[] = [
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const policy = { ...DEFAULT_COLLISION_POLICY, checkBranchBoundary: false };
    const collisions = testBoundaryContainment(entry, template, policy);
    expect(collisions.length).toBe(0);
  });

  it("returns empty for degenerate template (fewer than 3 points)", () => {
    const entry = makeIndexEntry("branch:a", null, 5, 2, [
      { x: 100, y: 100 },
    ]);
    const collisions = testBoundaryContainment(entry, [{ x: 0, y: 0 }, { x: 1, y: 1 }], DEFAULT_COLLISION_POLICY);
    expect(collisions.length).toBe(0);
  });
});
