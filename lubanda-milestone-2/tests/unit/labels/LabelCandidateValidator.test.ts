import { describe, expect, it } from "vitest";
import { validateCandidate } from "../../../src/core/labels/LabelCandidateValidator.js";
import type { SkeletonBranchId, PersonId } from "../../../src/core/contracts/identifiers.js";
import type { SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type {
  CandidateCollisionQuery,
  LabelCandidate,
  LabelPlacement,
} from "../../../src/core/labels/types.js";
import type { Bounds, Vec2 } from "../../../src/core/geometry/types.js";

// ── Mock query with per-test control ──

class MockQuery implements CandidateCollisionQuery {
  branchOverlap = false;
  clearance = 20;
  leaderCross = false;
  inside = true;
  labelOverlap = false;
  boundsClear = 100;

  reset(): MockQuery {
    this.branchOverlap = false;
    this.clearance = 20;
    this.leaderCross = false;
    this.inside = true;
    this.labelOverlap = false;
    this.boundsClear = 100;
    return this;
  }

  overlapsFixedBranch(_c: SkeletonBranchId, _b: Bounds, _a: Vec2, _r: number): boolean { return this.branchOverlap; }
  overlapsFixedLabel(_b: Bounds, _fp: readonly LabelPlacement[]): boolean { return this.labelOverlap; }
  isBoundsInsideBoundary(_b: Bounds): boolean { return this.inside; }
  isPointInsideBoundary(_p: Vec2): boolean { return this.inside; }
  leaderCrossesFixedObstacle(_a: Vec2, _b: Vec2): boolean { return this.leaderCross; }
  minClearanceToFixedBranches(_p: Vec2): number { return this.clearance; }
  boundaryClearance(_p: Vec2): number { return this.boundsClear; }
  minBoundsBoundaryClearance(_b: Bounds): number { return this.inside ? this.boundsClear : -1; }
}

const BID = "b1" as SkeletonBranchId;
const CFG = { minimumFontSize: 12, maximumRotationDegrees: 20 };

const makeBranch = (overrides?: Partial<SkeletonBranch>): SkeletonBranch => ({
  id: BID,
  ownerPersonId: "p1" as PersonId,
  parentBranchId: null, generation: 1, genealogyDepth: 1, territoryId: null,
  curve: { p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 150, y: 0 } },
  startPoint: { x: 0, y: 0 }, endPoint: { x: 150, y: 0 }, length: 150,
  thickness: { baseThickness: 4, tipThickness: 2, taperRatio: 0.5 },
  startNodeId: "n1", endNodeId: "n2", childrenBranchIds: Object.freeze([]),
  candidateScore: null, rejectionHistory: Object.freeze([]),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Object.freeze({ branchIndex: 1, lineageRootId: "p1" as PersonId, person: null as any }),
  ...overrides,
});

const makeCandidate = (overrides?: Partial<LabelCandidate>): LabelCandidate => ({
  personId: "p1" as PersonId,
  bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 },
  anchor: { x: 5, y: 5 }, rotation: 0, leaderLength: 0,
  family: "ALIGNED_WITH_BRANCH",
  validationStatus: "VALID",
  rejectionReasons: Object.freeze([]),
  score: null, componentScores: undefined,
  ...overrides,
});

// ── Tests ──

describe("LabelCandidateValidator — baseline", () => {
  it("VALID for clean candidate", () => {
    const r = validateCandidate(makeCandidate(), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("VALID");
  });

  it("INVALID when branch is null", () => {
    const r = validateCandidate(makeCandidate(), null, null, CFG, new MockQuery(), []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "NO_BRANCH_FOR_PERSON")).toBe(true);
  });

  it("INVALID when rotation exceeds limit", () => {
    const r = validateCandidate(makeCandidate({ rotation: 30 }), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "ROTATION_EXCEEDS_LIMIT")).toBe(true);
  });
});

// ── Self-anchor exemption tests A–E ──

describe("Self-anchor exemption", () => {
  it("A: small own-branch overlap entirely inside attachment circle → VALID", () => {
    // Tiny bounds tight around anchor, all well within anchorRadius=8
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: 2, minY: 2, maxX: 8, maxY: 8 }, anchor: { x: 5, y: 5 } }),
      makeBranch(), BID, CFG, new MockQuery().reset(), [],
    );
    // Mock has branchOverlap=false → no overlap reported → VALID
    expect(r.status).toBe("VALID");
  });

  it("B: large label — overlap only inside circle → VALID", () => {
    // The mock query simulates the exemption: the overlap region of this large
    // label with the branch envelope is entirely within the anchor-radius circle.
    // The real implementation (CandidateCollisionQuery) checks this by sampling
    // the intersection region. Here the mock returns no overlap (exempted).
    const q = new MockQuery().reset();
    q.branchOverlap = false; // exempted by the real implementation
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, anchor: { x: 5, y: 5 } }),
      makeBranch(), BID, CFG, q, [],
    );
    expect(r.status).toBe("VALID");
  });

  it("C: own-branch overlap continues outside circle → INVALID", () => {
    // Mock reports branch overlap (simulating the real logic finding
    // sampled points outside the anchor circle)
    const q = new MockQuery().reset();
    q.branchOverlap = true;
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 }, anchor: { x: 5, y: 5 } }),
      makeBranch(), BID, CFG, q, [],
    );
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BRANCH_PENETRATION")).toBe(true);
  });

  it("D: other-branch overlap inside attachment circle → INVALID (no exemption for other branches)", () => {
    const otherBid = "other" as SkeletonBranchId;
    const q = new MockQuery().reset();
    q.branchOverlap = true;
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, anchor: { x: 5, y: 5 } }),
      makeBranch(), otherBid, CFG, q, [],
    );
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BRANCH_PENETRATION")).toBe(true);
  });

  it("E: corner outside circle but NO branch overlap → VALID (no false rejection)", () => {
    const q = new MockQuery().reset();
    q.branchOverlap = false; // no actual branch overlap
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: -1000, minY: -1000, maxX: -900, maxY: -900 }, anchor: { x: 5, y: 5 } }),
      makeBranch(), BID, CFG, q, [],
    );
    expect(r.status).toBe("VALID");
  });
});

// ── Boundary tests ──

describe("Boundary containment and clearance", () => {
  it("rectangular boundary: fully inside → VALID", () => {
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: 100, minY: 100, maxX: 200, maxY: 150 } }),
      makeBranch(), BID, CFG, new MockQuery().reset(), [],
    );
    expect(r.status).toBe("VALID");
  });

  it("center inside but corner outside → INVALID", () => {
    const q = new MockQuery().reset();
    q.inside = false;
    const r = validateCandidate(makeCandidate(), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BOUNDARY_VIOLATION")).toBe(true);
  });

  it("contained but clearance below epsilon → BOUNDARY_CLEARANCE_FAILED", () => {
    const q = new MockQuery().reset();
    q.boundsClear = 1e-8; // effectively zero clearance
    const r = validateCandidate(makeCandidate(), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BOUNDARY_CLEARANCE_FAILED")).toBe(true);
  });

  it("clearance at epsilon threshold → VALID", () => {
    const q = new MockQuery().reset();
    q.boundsClear = 1e-6; // at EPSILON
    const r = validateCandidate(makeCandidate(), makeBranch(), BID, CFG, q, []);
    // Above the < EPSILON threshold
    expect(r.status).toBe("VALID");
  });

  it("clearance just below epsilon → BOUNDARY_CLEARANCE_FAILED", () => {
    const q = new MockQuery().reset();
    q.boundsClear = 0; // zero clearance
    const r = validateCandidate(makeCandidate(), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BOUNDARY_CLEARANCE_FAILED")).toBe(true);
  });
});

// ── Other rejection cases ──

describe("Other rejection cases", () => {
  it("INVALID for non-finite geometry", () => {
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: Infinity, minY: 0, maxX: 0, maxY: 0 } }),
      makeBranch(), BID, CFG, new MockQuery().reset(), [],
    );
    expect(r.status).toBe("INVALID");
  });

  it("INVALID when leader crosses", () => {
    const q = new MockQuery().reset();
    q.leaderCross = true;
    const r = validateCandidate(
      makeCandidate({ leaderLength: 10, anchor: { x: 0, y: 0 }, bounds: { minX: 100, minY: 0, maxX: 150, maxY: 12 } }),
      makeBranch(), BID, CFG, q, [],
    );
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "LEADER_CROSSING")).toBe(true);
  });

  it("INVALID when overlapping fixed label", () => {
    const q = new MockQuery().reset();
    q.labelOverlap = true;
    const r = validateCandidate(makeCandidate({ bounds: { minX: 10, minY: 0, maxX: 50, maxY: 12 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "OVERLAPS_FIXED_LABEL")).toBe(true);
  });
});
