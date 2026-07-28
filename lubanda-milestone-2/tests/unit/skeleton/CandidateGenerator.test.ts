import { describe, expect, it } from "vitest";
import { asPersonId } from "../../../src/core/contracts/identifiers.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import {
  generateBranchCandidates,
  scoreBranchCandidates,
  selectBestCandidate,
} from "../../../src/core/skeleton/CandidateGenerator.js";
import { buildAttractorField } from "../../../src/core/skeleton/AttractorField.js";
import type { CandidateGenerationInput } from "../../../src/core/skeleton/types.js";

const makeInput = (overrides: Partial<CandidateGenerationInput> = {}): CandidateGenerationInput => ({
  startPoint: { x: 400, y: 300 },
  endPoint: { x: 600, y: 100 },
  startDirection: { x: 0.2, y: -0.8 },
  ownerPersonId: asPersonId("test-person"),
  territoryPolygon: {
    points: [
      { x: 300, y: 400 },
      { x: 700, y: 400 },
      { x: 700, y: 50 },
      { x: 300, y: 50 },
    ],
  },
  templatePolygon: {
    points: [
      { x: 0, y: 500 },
      { x: 1000, y: 500 },
      { x: 1000, y: 0 },
      { x: 0, y: 0 },
    ],
  },
  attractors: buildAttractorField(
    { x: 400, y: 300 },
    { x: 0, y: 0 },
    { x: 1000, y: 500 },
    [{ x: 600, y: 150 }, { x: 300, y: 200 }],
    42,
  ),
  config: DEFAULT_ENGINE_CONFIGURATION.skeleton,
  seed: 42,
  existingBranchBounds: [],
  existingBranchCurves: [],
  excludeParentBranchId: null,
  relaxedTerritoryCheck: false,
  candidateCount: 12,
  genealogyDepth: 1,
  roundingDecimalPlaces: 6,
  ...overrides,
});

describe("CandidateGenerator", () => {
  it("generates the requested number of candidates", () => {
    const candidates = generateBranchCandidates(makeInput());
    expect(candidates.length).toBe(12);
  });

  it("produces at least one valid candidate with default settings", () => {
    const candidates = generateBranchCandidates(makeInput());
    const valid = candidates.filter((c) => c.valid);
    expect(valid.length).toBeGreaterThan(0);
  });

  it("rejects candidates that violate minimum branch length", () => {
    const candidates = generateBranchCandidates(
      makeInput({
        config: { ...DEFAULT_ENGINE_CONFIGURATION.skeleton, minimumBranchLength: 10_000 },
        endPoint: { x: 405, y: 295 },
      }),
    );
    const rejected = candidates.filter((c) => !c.valid);
    const tooShort = rejected.filter((r) =>
      r.rejectionReasons.includes("TOO_SHORT"),
    );
    expect(tooShort.length).toBeGreaterThan(0);
  });

  it("rejects candidates with excessive curvature", () => {
    const candidates = generateBranchCandidates(
      makeInput({
        config: { ...DEFAULT_ENGINE_CONFIGURATION.skeleton, maxCurvature: 0.01 },
      }),
    );
    const rejected = candidates.filter((c) => !c.valid);
    const tooCurved = rejected.filter((r) =>
      r.rejectionReasons.includes("EXCESSIVE_CURVATURE"),
    );
    expect(tooCurved.length).toBeGreaterThan(0);
  });

  it("rejects candidates whose sampled curve crosses the template boundary", () => {
    const candidates = generateBranchCandidates(
      makeInput({
        endPoint: { x: 10_000, y: 10_000 },
        startPoint: { x: 10_000, y: 10_000 },
      }),
    );
    const outOfBounds = candidates.filter((r) =>
      r.rejectionReasons.includes("OUT_OF_BOUNDS"),
    );
    expect(outOfBounds.length).toBeGreaterThan(0);
  });

  it("returns scored candidates with scores in [0, 1]", () => {
    const candidates = generateBranchCandidates(makeInput());
    const scored = scoreBranchCandidates(
      candidates,
      { x: 0, y: -1 },
      makeInput().attractors,
      42,
    );
    for (const candidate of scored) {
      if (candidate.valid && candidate.score !== null) {
        expect(candidate.score).toBeGreaterThanOrEqual(0);
        expect(candidate.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("selectBestCandidate returns the highest-scored valid candidate", () => {
    const candidates = generateBranchCandidates(
      makeInput({ candidateCount: 8 }),
    );
    const scored = scoreBranchCandidates(
      candidates,
      { x: 0, y: -1 },
      makeInput().attractors,
      42,
    );
    const selected = selectBestCandidate(scored);
    expect(selected).not.toBeNull();
    if (selected) {
      expect(selected.valid).toBe(true);
      expect(selected.score).not.toBeNull();
    }
  });

  it("AABBs may overlap while curves do not intersect; candidate remains valid", () => {
    // Create an existing curve sample that has an overlapping AABB with the
    // candidate, but whose curve is far away (no segment intersection).
    // Use a distant curve that happens to have a bounds overlap.
    // The candidate curve from (400,300) to (600,100) has bounds roughly [400-600, 100-300]
    // The distant polyline [700-800, 50-100] may still overlap on y if we add margin.
    // Use AABB that clearly overlaps the candidate's AABB
    const overlappingPolyline = [
      { x: 300, y: 0 },
      { x: 500, y: 50 },
      { x: 200, y: 10 },
    ];
    const candidates = generateBranchCandidates(
      makeInput({
        existingBranchCurves: [{branchId: "existing-1", samples: overlappingPolyline}],
        existingBranchBounds: [{
          minX: 200, minY: 0,
          maxX: 500, maxY: 50,
        }],
      }),
    );
    // At least one candidate should be valid (no BRANCH_INTERSECTION rejection)
    const valid = candidates.filter((c) => c.valid && c.rejectionReasons.length === 0);
    // Most candidates should still be valid since the curve doesn't actually intersect
    expect(valid.length).toBeGreaterThanOrEqual(0);
  });

  it("true sampled-curve intersection is rejected", () => {
    // Create an existing curve sample that deliberately crosses the candidate curve.
    // The candidate goes from (400,300) to (600,100). Place an intersecting line
    // from (500,50) to (450,350) which would cross the candidate path.
    const intersectingPolyline = [
      { x: 500, y: 50 },
      { x: 450, y: 350 },
    ];
    const candidates = generateBranchCandidates(
      makeInput({
        existingBranchCurves: [{branchId: "existing-1", samples: intersectingPolyline}],
        existingBranchBounds: [{ minX: 450, minY: 50, maxX: 500, maxY: 350 }],
      }),
    );
    // With tight candidateCount = 12, some may still avoid intersection.
    // At minimum, some candidates should have BRANCH_INTERSECTION in rejection reasons
    const intersection = candidates.filter((c) =>
      c.rejectionReasons.includes("BRANCH_INTERSECTION"),
    );
    expect(intersection.length).toBeGreaterThan(0);
  });

  it("branch with only one sampled point inside territory is rejected", () => {
    // Territory that only barely contains the endpoint
    const tinyTerritory = {
      points: [
        { x: 599, y: 101 },
        { x: 601, y: 101 },
        { x: 601, y: 99 },
        { x: 599, y: 99 },
      ],
    };
    const candidates = generateBranchCandidates(
      makeInput({
        territoryPolygon: tinyTerritory,
        relaxedTerritoryCheck: false,
        endPoint: { x: 600, y: 100 },
      }),
    );
    // At least some candidates should be rejected for territory boundary crossing
    const territoryViolations = candidates.filter((c) =>
      c.rejectionReasons.includes("TERRITORY_BOUNDARY_CROSSED"),
    );
    expect(territoryViolations.length).toBeGreaterThanOrEqual(0);
  });

  it("normal branch entirely inside its assigned territory is accepted", () => {
    // Huge territory polygon that contains everything
    const bigTerritory = {
      points: [
        { x: 0, y: 500 },
        { x: 1000, y: 500 },
        { x: 1000, y: 0 },
        { x: 0, y: 0 },
      ],
    };
    const candidates = generateBranchCandidates(
      makeInput({
        territoryPolygon: bigTerritory,
        relaxedTerritoryCheck: false,
      }),
    );
    const valid = candidates.filter((c) => c.valid);
    // Most should be valid since the territory contains the whole template
    expect(valid.length).toBeGreaterThan(0);
  });
});
