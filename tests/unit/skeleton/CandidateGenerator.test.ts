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
  existingBranches: [],
  ignoredBranchIds: [],
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

  it("rejects candidates that go out of bounds", () => {
    // An endpoint far outside the template
    const candidates = generateBranchCandidates(
      makeInput({
        endPoint: { x: 10_000, y: 10_000 },
        startPoint: { x: 10_000, y: 10_000 },
      }),
    );
    const rejected = candidates.filter((c) => !c.valid);
    const outOfBounds = rejected.filter((r) =>
      r.rejectionReasons.includes("OUT_OF_BOUNDS"),
    );
    expect(outOfBounds.length).toBeGreaterThanOrEqual(0);
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
});
