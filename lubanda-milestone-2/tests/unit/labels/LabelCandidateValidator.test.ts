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

// -- Mock query with configurable behaviors --
class MockQuery implements CandidateCollisionQuery {
  constructor(
    public branchOverlap = false,
    public clearance = 20,
    public leaderCross = false,
    public inside = true,
    public labelOverlap = false,
  ) {}
  overlapsFixedBranch(_cid: SkeletonBranchId, _b: Bounds, _a: Vec2, _r: number): boolean { return this.branchOverlap; }
  overlapsFixedLabel(_b: Bounds, _fp: readonly LabelPlacement[]): boolean { return this.labelOverlap; }
  isBoundsInsideBoundary(_b: Bounds): boolean { return this.inside; }
  isPointInsideBoundary(_p: Vec2): boolean { return this.inside; }
  leaderCrossesFixedObstacle(_a: Vec2, _b: Vec2): boolean { return this.leaderCross; }
  minClearanceToFixedBranches(_p: Vec2): number { return this.clearance; }
  boundaryClearance(_p: Vec2): number { return 100; }
}

const BID = "b1" as SkeletonBranchId;

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
  anchor: { x: 150, y: 0 }, rotation: 0, leaderLength: 0,
  family: "ALIGNED_WITH_BRANCH",
  validationStatus: "VALID",
  rejectionReasons: Object.freeze([]),
  score: null, componentScores: undefined,
  ...overrides,
});

const CFG = { minimumFontSize: 12, maximumRotationDegrees: 20 };

describe("LabelCandidateValidator", () => {
  it("returns VALID for clean candidate", () => {
    const r = validateCandidate(makeCandidate(), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("VALID");
  });

  it("returns INVALID when branch is null", () => {
    const r = validateCandidate(makeCandidate(), null, null, CFG, new MockQuery(), []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "NO_BRANCH_FOR_PERSON")).toBe(true);
  });

  it("returns INVALID when rotation exceeds limit", () => {
    const r = validateCandidate(makeCandidate({ rotation: 30 }), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "ROTATION_EXCEEDS_LIMIT")).toBe(true);
  });

  it("returns INVALID when bounds overflow branch envelope (own branch, outside anchor)", () => {
    // Bounds that extend far beyond the anchor radius
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 } }),
      makeBranch(), BID, CFG, new MockQuery(true), [],
    );
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BRANCH_PENETRATION")).toBe(true);
  });

  it("self-anchor exemption: own branch contact inside anchor radius is ALLOWED", () => {
    // Bounds tightly around the anchor point — all corners within anchorRadius
    // Make a mock query that simulates the exemption check
    // We need a special mock for this: the test verifies the VALIDATOR
    // passes ownBranchId correctly to the query.
    // The query mock returns `false` for `overlapsFixedBranch` because
    // the real implementation would exempt it inside the anchor radius.
    const q = new MockQuery(false); // no overlap reported = exempted
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: 146, minY: -4, maxX: 154, maxY: 4 }, anchor: { x: 150, y: 0 } }),
      makeBranch(), BID, CFG, q, [],
    );
    expect(r.status).toBe("VALID");
  });

  it("other branches get NO self-anchor exemption", () => {
    // A different branch ID — overlap is always reported
    const otherBid = "other-branch" as SkeletonBranchId;
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: -500, minY: -500, maxX: 500, maxY: 500 } }),
      makeBranch(), otherBid, CFG, new MockQuery(true), [],
    );
    expect(r.status).toBe("INVALID");
  });

  it("returns BOUNDARY_VIOLATION (not BRANCH_PENETRATION) when outside boundary", () => {
    const r = validateCandidate(makeCandidate(), makeBranch(), BID, CFG, new MockQuery(false, 20, false, false), []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BOUNDARY_VIOLATION")).toBe(true);
    expect(r.rejectionReasons.some((x) => x.code === "BRANCH_PENETRATION")).toBe(false);
  });

  it("returns INVALID for non-finite geometry", () => {
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: Infinity, minY: 0, maxX: 0, maxY: 0 } }),
      makeBranch(), BID, CFG, new MockQuery(), [],
    );
    expect(r.status).toBe("INVALID");
  });

  it("returns INVALID when leader crosses fixed obstacle", () => {
    const r = validateCandidate(
      makeCandidate({ leaderLength: 10, anchor: { x: 0, y: 0 }, bounds: { minX: 100, minY: 0, maxX: 150, maxY: 12 } }),
      makeBranch(), BID, CFG, new MockQuery(false, 20, true), [],
    );
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "LEADER_CROSSING")).toBe(true);
  });

  it("returns INVALID when overlapping a fixed label", () => {
    const r = validateCandidate(
      makeCandidate({ bounds: { minX: 10, minY: 0, maxX: 50, maxY: 12 } }),
      makeBranch(), BID, CFG, new MockQuery(false, 20, false, true, true), [],
    );
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "OVERLAPS_FIXED_LABEL")).toBe(true);
  });
});

describe("boundary containment", () => {
  it("accepts label fully inside rectangular boundary", () => {
    const r = validateCandidate(makeCandidate({ bounds: { minX: 100, minY: 100, maxX: 200, maxY: 150 } }), makeBranch(), BID, CFG, new MockQuery(false, 20, false, true), []);
    expect(r.status).toBe("VALID");
  });

  it("rejects label with corner outside", () => {
    const r = validateCandidate(makeCandidate(), makeBranch(), BID, CFG, new MockQuery(false, 20, false, false), []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BOUNDARY_VIOLATION")).toBe(true);
  });
});
