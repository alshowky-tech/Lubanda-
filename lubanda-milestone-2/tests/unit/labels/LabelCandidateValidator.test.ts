import { describe, expect, it } from "vitest";
import { validateCandidate } from "../../../src/core/labels/LabelCandidateValidator.js";
import { DefaultCandidateCollisionQuery } from "../../../src/core/labels/CandidateCollisionQuery.js";
import type { SkeletonBranchId, PersonId } from "../../../src/core/contracts/identifiers.js";
import type { SkeletonBranch } from "../../../src/core/skeleton/types.js";
import type {
  CandidateCollisionQuery,
  LabelCandidate,
  LabelPlacement,
} from "../../../src/core/labels/types.js";
import type { Bounds, Vec2, Polygon } from "../../../src/core/geometry/types.js";

// ── Mock query for generic tests ──

class MockQuery implements CandidateCollisionQuery {
  branchOverlap = false;
  clearance = 20;
  leaderCross = false;
  inside = true;
  labelOverlap = false;
  boundsClear = 100;

  overlapsFixedBranch(_c: SkeletonBranchId, _b: Bounds, _a: Vec2, _r: number): boolean { return this.branchOverlap; }
  overlapsFixedLabel(_b: Bounds, _fp: readonly LabelPlacement[]): boolean { return this.labelOverlap; }
  isBoundsInsideBoundary(_b: Bounds): boolean { return this.inside; }
  isPointInsideBoundary(_p: Vec2): boolean { return this.inside; }
  leaderCrossesFixedObstacle(_a: Vec2, _b: Vec2): boolean { return this.leaderCross; }
  minClearanceToFixedBranches(_p: Vec2): number { return this.clearance; }
  boundaryClearance(_p: Vec2): number { return this.boundsClear; }
  minBoundsBoundaryClearance(_b: Bounds): number { return this.inside ? this.boundsClear : -1; }
}

// ── L‑shaped concave polygon fixture ──
//
//  (0,120)──────(60,120)
//     │              │
//     │     notch    │
//     │              │
//  (0,0)─────────(120,0)    <- (60,0) to (60,80) is the missing corner
//     │              │         forming an L shape
//     │   (60,80)────(120,80)
//     │      │
//     └──────┘
//  (0,0)    (60,0)

const L_POLYGON: Polygon = Object.freeze({
  points: Object.freeze([
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 80 },
    { x: 60, y: 80 },
    { x: 60, y: 120 },
    { x: 0, y: 120 },
  ]),
});

// Build real query with concave polygon and empty collision index
const concaveQuery = (): CandidateCollisionQuery => {
  const emptyIndex = { entries: Object.freeze([]), branchIdMap: new Map(), query: () => [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new DefaultCandidateCollisionQuery(emptyIndex as any, L_POLYGON);
};

const BID = "b1" as SkeletonBranchId;
const CFG = { minimumFontSize: 12, maximumRotationDegrees: 20, maximumBacktrackDepth: 10 };

const makeBranch = (): SkeletonBranch => ({
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
});

const makeC = (overrides?: Partial<LabelCandidate>): LabelCandidate => {
  const base = {
    candidateId: "c:p1:0",
    personId: "p1" as PersonId,
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 12 },
    anchor: { x: 5, y: 5 }, rotation: 0, leaderLength: 0,
    family: "ALIGNED_WITH_BRANCH" as LabelCandidate["family"],
    validationStatus: "VALID" as const,
    rejectionReasons: Object.freeze([]),
    score: null, componentScores: undefined as Readonly<Record<string, number>> | undefined,
  };
  return { ...base, ...overrides } as LabelCandidate;
};

// ── Concave boundary tests A–G ──

describe("Concave boundary (L-shaped polygon) A–G", () => {
  // Test A: fully inside one valid region
  it("A: AABB fully inside the bottom leg of L → VALID", () => {
    const q = concaveQuery();
    // The bottom leg of the L is the wide horizontal strip
    // Points: (10,10) → (50,20) — all well inside the bottom area
    const r = validateCandidate(makeC({ bounds: { minX: 10, minY: 10, maxX: 50, maxY: 20 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("VALID");
  });

  // Test B: all corners inside but AABB bridges the concave notch
  it("B: AABB bridges concave notch (corners in, edge crosses) → INVALID", () => {
    const q = concaveQuery();
    // The notch is at (60,0)–(60,80). AABB from (50,70) to (70,90):
    // - top-left (50,70): inside (within the vertical leg)
    // - top-right (70,90): inside (within the vertical leg)
    // - bottom-left (50,70): inside
    // - bottom-right (70,70): inside... hmm, let me think
    // Actually the notch is the missing rectangle (60,0) to (∞,80).
    // So points with x>60 and y between 0 and 80 are OUTSIDE.
    // Let's try: AABB (55,70) to (65,90)
    // - TL (55,70): inside (x=55<60, y=70 is between 0–120)
    // - TR (65,90): inside (x=65>60, y=90>80 → inside, in the vertical leg)
    // - BL (55,70): inside (x=55<60)
    // - BR (65,90): inside
    // But the BOTTOM edge crosses from (55,70) to (65,70).
    // At y=70, the notch goes from x=60 to ∞.
    // So the bottom edge at y=70 crosses the polygon at x=60.
    const r = validateCandidate(makeC({ bounds: { minX: 55, minY: 70, maxX: 65, maxY: 90 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BOUNDARY_VIOLATION")).toBe(true);
  });

  // Test C: center inside but corner outside (beyond polygon bounding box)
  it("C: center inside but one corner outside → INVALID", () => {
    const q = concaveQuery();
    // AABB that extends beyond the polygon's maxX=120 bound
    const r = validateCandidate(makeC({ bounds: { minX: 100, minY: 10, maxX: 130, maxY: 20 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
  });

  // Test D: AABB edge crosses polygon boundary edge (right vertical edge x=120)
  it("D: AABB edge crosses polygon boundary edge → INVALID", () => {
    const q = concaveQuery();
    // AABB crosses the right vertical edge (120,0)→(120,80)
    const r = validateCandidate(makeC({ bounds: { minX: 110, minY: 10, maxX: 130, maxY: 20 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
  });

  // Test E: fully contained with clearance above threshold
  it("E: fully contained with clearance above threshold → VALID", () => {
    const q = concaveQuery();
    // Small AABB deep inside the bottom leg
    const r = validateCandidate(makeC({ bounds: { minX: 20, minY: 20, maxX: 40, maxY: 40 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("VALID");
  });

  // Test F: fully inside but clearance below epsilon → BOUNDARY_CLEARANCE_FAILED
  it("F: fully contained with clearance just below epsilon → BOUNDARY_CLEARANCE_FAILED", () => {
    const q = concaveQuery();
    // AABB right against the left edge (x=0). Edge is at x=0.
    const r = validateCandidate(makeC({ bounds: { minX: 0, minY: 10, maxX: 1e-8, maxY: 20 } }), makeBranch(), BID, CFG, q, []);
    // Clearance is ~0, below EPSILON
    expect(r.status).toBe("INVALID");
    const reasons = r.rejectionReasons.map((x) => x.code);
    expect(reasons.some((c) => c === "BOUNDARY_CLEARANCE_FAILED" || c === "BOUNDARY_VIOLATION")).toBe(true);
  });

  // Test G: exact epsilon threshold behavior
  it("G: contained with clearance at epsilon threshold → VALID", () => {
    const q = concaveQuery();
    // AABB with a tiny margin from the left edge: ~0.001 of clearance
    const r = validateCandidate(makeC({ bounds: { minX: 0.001, minY: 10, maxX: 30, maxY: 20 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("VALID");
  });
});

// ── Baseline tests ──

describe("LabelCandidateValidator — baseline", () => {
  it("VALID for clean candidate", () => {
    const r = validateCandidate(makeC(), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("VALID");
  });

  it("INVALID when branch is null", () => {
    const r = validateCandidate(makeC(), null, null, CFG, new MockQuery(), []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "NO_BRANCH_FOR_PERSON")).toBe(true);
  });

  it("INVALID when rotation exceeds limit", () => {
    const r = validateCandidate(makeC({ rotation: 30 }), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "ROTATION_EXCEEDS_LIMIT")).toBe(true);
  });
});

describe("Self-anchor exemption", () => {
  it("A: small overlap entirely inside circle → VALID", () => {
    const r = validateCandidate(makeC({ bounds: { minX: 2, minY: 2, maxX: 8, maxY: 8 }, anchor: { x: 5, y: 5 } }), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("VALID");
  });

  it("B: large label — overlap inside circle → VALID", () => {
    const q = new MockQuery(); q.branchOverlap = false;
    const r = validateCandidate(makeC({ bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, anchor: { x: 5, y: 5 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("VALID");
  });

  it("C: overlap continues outside circle → INVALID", () => {
    const q = new MockQuery(); q.branchOverlap = true;
    const r = validateCandidate(makeC({ bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 }, anchor: { x: 5, y: 5 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BRANCH_PENETRATION")).toBe(true);
  });

  it("D: other-branch overlap inside circle → INVALID", () => {
    const q = new MockQuery(); q.branchOverlap = true;
    const r = validateCandidate(makeC({ bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, anchor: { x: 5, y: 5 } }), makeBranch(), "other" as SkeletonBranchId, CFG, q, []);
    expect(r.status).toBe("INVALID");
  });

  it("E: corner outside circle NO overlap → VALID", () => {
    const q = new MockQuery(); q.branchOverlap = false;
    const r = validateCandidate(makeC({ bounds: { minX: -1000, minY: -1000, maxX: -900, maxY: -900 }, anchor: { x: 5, y: 5 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("VALID");
  });
});

describe("Boundary (rectangular)", () => {
  it("rectangular: fully inside → VALID", () => {
    const r = validateCandidate(makeC({ bounds: { minX: 100, minY: 100, maxX: 200, maxY: 150 } }), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("VALID");
  });

  it("rectangular: corner outside → INVALID", () => {
    const q = new MockQuery(); q.inside = false;
    const r = validateCandidate(makeC(), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BOUNDARY_VIOLATION")).toBe(true);
  });

  it("rectangular: clearance below epsilon → BOUNDARY_CLEARANCE_FAILED", () => {
    const q = new MockQuery(); q.boundsClear = 0;
    const r = validateCandidate(makeC(), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "BOUNDARY_CLEARANCE_FAILED")).toBe(true);
  });
});

describe("Other rejection cases", () => {
  it("INVALID for non-finite geometry", () => {
    const r = validateCandidate(makeC({ bounds: { minX: Infinity, minY: 0, maxX: 0, maxY: 0 } }), makeBranch(), BID, CFG, new MockQuery(), []);
    expect(r.status).toBe("INVALID");
  });

  it("INVALID when leader crosses", () => {
    const q = new MockQuery(); q.leaderCross = true;
    const r = validateCandidate(makeC({ leaderLength: 10, anchor: { x: 0, y: 0 }, bounds: { minX: 100, minY: 0, maxX: 150, maxY: 12 } }), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "LEADER_CROSSING")).toBe(true);
  });

  it("INVALID when overlapping fixed label", () => {
    const q = new MockQuery(); q.labelOverlap = true;
    const r = validateCandidate(makeC(), makeBranch(), BID, CFG, q, []);
    expect(r.status).toBe("INVALID");
    expect(r.rejectionReasons.some((x) => x.code === "OVERLAPS_FIXED_LABEL")).toBe(true);
  });
});
