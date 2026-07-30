import { describe, expect, it } from "vitest";
import { asPersonId, asSkeletonBranchId, asSkeletonPlanId } from "../../../src/core/contracts/identifiers.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/defaults.js";
import type { LabelConfig } from "../../../src/core/config/types.js";
import type { Bounds, Vec2 } from "../../../src/core/geometry/types.js";
import type { SkeletonBranch, SkeletonPlan } from "../../../src/core/skeleton/types.js";
import {
  assignCandidates,
  buildCandidateOrder,
  buildPersonOrder,
  DefaultLabelCollisionQuery,
  type LabelAssignmentResult,
} from "../../../src/core/labels/index.js";
import type {
  GeneratedCandidatesResult,
  LabelCandidate,
  LabelCandidateFamily,
} from "../../../src/core/labels/types.js";

const config = (maximumBacktrackDepth = 10): LabelConfig => ({
  minimumFontSize: 12,
  maximumRotationDegrees: 20,
  maximumBacktrackDepth,
});

const id = asPersonId;

const bounds = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
});

const candidate = (
  personId: string,
  candidateIndex: number,
  candidateBounds: Bounds,
  options: Partial<{
    score: number | null;
    family: LabelCandidateFamily;
    leaderLength: number;
    rotation: number;
    anchor: Vec2;
    validationStatus: "VALID" | "INVALID";
    candidateId: string;
  }> = {},
): LabelCandidate => Object.freeze({
  candidateId: options.candidateId ?? `candidate:${personId}:${candidateIndex}`,
  personId: id(personId),
  bounds: candidateBounds,
  anchor: options.anchor ?? {
    x: (candidateBounds.minX + candidateBounds.maxX) / 2,
    y: (candidateBounds.minY + candidateBounds.maxY) / 2,
  },
  rotation: options.rotation ?? 0,
  leaderLength: options.leaderLength ?? 0,
  family: options.family ?? "ALIGNED_WITH_BRANCH",
  validationStatus: options.validationStatus ?? "VALID",
  rejectionReasons: Object.freeze([]),
  score: options.score ?? 1,
  componentScores: undefined,
});

const branch = (personId: string, generation: number): SkeletonBranch => ({
  id: asSkeletonBranchId(`branch:${personId}`),
  ownerPersonId: id(personId),
  generation,
} as SkeletonBranch);

const skeleton = (entries: readonly (readonly [string, number])[]): SkeletonPlan => ({
  skeletonPlanId: asSkeletonPlanId("skeleton:test"),
  branches: entries.map(([personId, generation]) => branch(personId, generation)),
} as unknown as SkeletonPlan);

const generated = (entries: readonly (readonly [string, readonly LabelCandidate[]])[]): GeneratedCandidatesResult => {
  const personCandidateMap = new Map(entries.map(([personId, candidates]) => [id(personId), candidates]));
  const allCandidates = entries.flatMap(([, candidates]) => [...candidates]);
  const validCandidates = allCandidates.filter((item) => item.validationStatus === "VALID");
  return Object.freeze({
    allCandidates: Object.freeze(allCandidates),
    validCandidates: Object.freeze(validCandidates),
    personCandidateMap,
    totalGeneratablePeople: entries.length,
    diagnostics: Object.freeze([]),
  });
};

const placementIds = (result: LabelAssignmentResult): readonly string[] =>
  result.placements.map((placement) => String(placement.personId));

const unplacedCodes = (result: LabelAssignmentResult): Readonly<Record<string, string>> =>
  Object.fromEntries(result.unplacedPersons.map((reason) => [String(reason.personId), reason.code]));

describe("DefaultLabelCollisionQuery", () => {
  const query = new DefaultLabelCollisionQuery();

  it("detects label↔label closed-interval overlap", () => {
    const placed = assignCandidates({
      skeletonPlan: skeleton([["p1", 1]]),
      generatedCandidates: generated([["p1", [candidate("p1", 0, bounds(0, 0, 10, 10))]]]),
      configuration: config(),
      collisionQuery: query,
    }).placements[0]!;

    expect(query.overlapsPlacedLabel(bounds(10, 10, 20, 20), placed)).toBe(true);
    expect(query.overlapsPlacedLabel(bounds(11, 11, 20, 20), placed)).toBe(false);
  });

  it("detects leader↔label boundary touches as conflicts", () => {
    const placed = assignCandidates({
      skeletonPlan: skeleton([["p1", 1]]),
      generatedCandidates: generated([["p1", [candidate("p1", 0, bounds(0, 0, 10, 10))]]]),
      configuration: config(),
      collisionQuery: query,
    }).placements[0]!;

    expect(query.leaderCrossesPlacedLabel({ x: -5, y: 5 }, { x: 0, y: 5 }, placed)).toBe(true);
  });

  it("detects label↔leader boundary touches as conflicts", () => {
    expect(query.labelCrossesPlacedLeader(bounds(0, 0, 10, 10), { x: -5, y: 5 }, { x: 0, y: 5 })).toBe(true);
  });

  it("detects leader↔leader proper crossings and allows endpoint touches", () => {
    expect(query.leadersCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(query.leadersCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(false);
  });

  it("treats leader COLLINEAR_OVERLAP as a conflict", () => {
    expect(query.leadersCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(true);
  });

  it("allows leader COLLINEAR_TOUCH", () => {
    expect(query.leadersCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(false);
  });
});

describe("LabelAssignmentEngine ordering", () => {
  it("orders persons by validCandidateCount, staticConflictDegree, generation, then personId", () => {
    const plan = skeleton([["z", 2], ["a", 1], ["m", 1], ["d", 1]]);
    const result = buildPersonOrder(plan, new Map([
      [id("z"), buildCandidateOrder(id("z"), [candidate("z", 0, bounds(100, 0, 110, 10))])],
      [id("a"), buildCandidateOrder(id("a"), [candidate("a", 0, bounds(0, 0, 10, 10)), candidate("a", 1, bounds(20, 0, 30, 10))])],
      [id("m"), buildCandidateOrder(id("m"), [candidate("m", 0, bounds(0, 0, 10, 10)), candidate("m", 1, bounds(40, 0, 50, 10))])],
      [id("d"), buildCandidateOrder(id("d"), [candidate("d", 0, bounds(200, 0, 210, 10)), candidate("d", 1, bounds(220, 0, 230, 10))])],
    ]));

    expect(result.map((person) => String(person.personId))).toEqual(["z", "a", "m", "d"]);
    expect(result.map((person) => person.staticConflictDegree)).toEqual([0, 1, 1, 0]);
  });

  it("orders candidate ties stably by the approved tuple", () => {
    const ordered = buildCandidateOrder(id("p"), [
      candidate("p", 0, bounds(0, 0, 1, 1), { score: 1, family: "LATERAL", leaderLength: 1, rotation: 0, candidateId: "z" }),
      candidate("p", 1, bounds(2, 0, 3, 1), { score: 2, family: "CARTOUCHE_ZONE", leaderLength: 4, rotation: 9, candidateId: "a" }),
      candidate("p", 2, bounds(4, 0, 5, 1), { score: 1, family: "ALIGNED_WITH_BRANCH", leaderLength: 9, rotation: 0, candidateId: "b" }),
      candidate("p", 3, bounds(6, 0, 7, 1), { score: 1, family: "ALIGNED_WITH_BRANCH", leaderLength: 2, rotation: 5, candidateId: "c" }),
      candidate("p", 4, bounds(8, 0, 9, 1), { score: 1, family: "ALIGNED_WITH_BRANCH", leaderLength: 2, rotation: 3, candidateId: "d" }),
    ]);

    expect(ordered.map((item) => item.originalIndex)).toEqual([1, 4, 3, 2, 0]);
  });
});

describe("LabelAssignmentEngine assignment", () => {
  it("runs in pure greedy mode when maximumBacktrackDepth is zero", () => {
    const result = assignCandidates({
      skeletonPlan: skeleton([["a", 1], ["b", 1]]),
      generatedCandidates: generated([
        ["a", [candidate("a", 0, bounds(0, 0, 10, 10))]],
        ["b", [candidate("b", 0, bounds(5, 5, 15, 15))]],
      ]),
      configuration: config(0),
    });

    expect(placementIds(result)).toEqual(["a"]);
    expect(unplacedCodes(result)).toEqual({ b: "ALL_CANDIDATES_COLLIDE" });
  });

  it("uses bounded chronological backtracking to replace the latest decision frame", () => {
    const result = assignCandidates({
      skeletonPlan: skeleton([["a", 1], ["b", 1], ["c", 1]]),
      generatedCandidates: generated([
        ["a", [candidate("a", 0, bounds(100, 0, 110, 10))]],
        ["b", [
          candidate("b", 0, bounds(0, 0, 10, 10), { score: 2 }),
          candidate("b", 1, bounds(30, 0, 40, 10), { score: 1 }),
        ]],
        ["c", [
          candidate("c", 0, bounds(5, 5, 15, 15)),
          candidate("c", 1, bounds(6, 6, 16, 16)),
          candidate("c", 2, bounds(7, 7, 17, 17)),
        ]],
      ]),
      configuration: config(1),
    });

    expect(placementIds(result)).toEqual(["a", "b", "c"]);
    expect(result.placements.find((placement) => String(placement.personId) === "b")?.bounds).toEqual(bounds(30, 0, 40, 10));
    expect(result.unplacedPersons).toEqual([]);
  });

  it("replays displaced persons in deterministic order after multi-frame backtracking", () => {
    const result = assignCandidates({
      skeletonPlan: skeleton([["a", 1], ["b", 1], ["c", 1]]),
      generatedCandidates: generated([
        ["a", [
          candidate("a", 0, bounds(0, 0, 10, 10), { score: 2 }),
          candidate("a", 1, bounds(100, 0, 110, 10), { score: 1 }),
        ]],
        ["b", [
          candidate("b", 0, bounds(30, 0, 40, 10), { score: 2 }),
          candidate("b", 1, bounds(5, 0, 15, 10), { score: 1 }),
        ]],
        ["c", [
          candidate("c", 0, bounds(5, 5, 15, 15)),
          candidate("c", 1, bounds(6, 6, 16, 16)),
          candidate("c", 2, bounds(7, 7, 17, 17)),
        ]],
      ]),
      configuration: config(2),
    });

    expect(result.unplacedPersons).toEqual([]);
    expect(placementIds(result)).toEqual(["a", "b", "c"]);
    expect(result.placements.find((placement) => String(placement.personId) === "a")?.bounds).toEqual(bounds(100, 0, 110, 10));
    expect(result.placements.find((placement) => String(placement.personId) === "b")?.bounds).toEqual(bounds(30, 0, 40, 10));
  });

  it("shares one backtracking budget across displaced-person replay", () => {
    const result = assignCandidates({
      skeletonPlan: skeleton([["a", 1], ["b", 1], ["c", 1]]),
      generatedCandidates: generated([
        ["a", [
          candidate("a", 0, bounds(0, 0, 10, 10), { score: 3 }),
          candidate("a", 1, bounds(5, 0, 35, 10), { score: 2 }),
          candidate("a", 2, bounds(100, 0, 110, 10), { score: 1 }),
        ]],
        ["b", [
          candidate("b", 0, bounds(30, 0, 40, 10), { score: 3 }),
          candidate("b", 1, bounds(5, 0, 15, 10), { score: 2 }),
          candidate("b", 2, bounds(0, 0, 10, 10), { score: 1 }),
        ]],
        ["c", [
          candidate("c", 0, bounds(40, 0, 50, 10), { score: 3 }),
          candidate("c", 1, bounds(39, 0, 49, 10), { score: 2 }),
          candidate("c", 2, bounds(35, 0, 105, 10), { score: 1 }),
        ]],
      ]),
      configuration: config(2),
    });

    expect(placementIds(result)).toEqual(["a", "c"]);
    expect(unplacedCodes(result)).toEqual({ b: "BACKTRACK_EXHAUSTED" });
    expect(result.placements.find((placement) => String(placement.personId) === "a")?.bounds).toEqual(bounds(5, 0, 35, 10));
  });

  it("records BACKTRACK_EXHAUSTED when the bounded budget is consumed and continues", () => {
    const result = assignCandidates({
      skeletonPlan: skeleton([["a", 1], ["b", 1], ["c", 1], ["d", 1]]),
      generatedCandidates: generated([
        ["a", [candidate("a", 0, bounds(100, 0, 110, 10))]],
        ["b", [
          candidate("b", 0, bounds(0, 0, 10, 10), { score: 2 }),
          candidate("b", 1, bounds(0, 0, 20, 20), { score: 1 }),
        ]],
        ["c", [
          candidate("c", 0, bounds(5, 5, 15, 15)),
          candidate("c", 1, bounds(6, 6, 16, 16)),
          candidate("c", 2, bounds(7, 7, 17, 17)),
        ]],
        ["d", [
          candidate("d", 0, bounds(200, 0, 210, 10)),
          candidate("d", 1, bounds(220, 0, 230, 10)),
          candidate("d", 2, bounds(240, 0, 250, 10)),
          candidate("d", 3, bounds(260, 0, 270, 10)),
        ]],
      ]),
      configuration: config(1),
    });

    expect(unplacedCodes(result)).toEqual({ c: "BACKTRACK_EXHAUSTED" });
    expect(placementIds(result)).toEqual(["a", "b", "d"]);
  });

  it("returns partial assignments for people with no candidates", () => {
    const result = assignCandidates({
      skeletonPlan: skeleton([["a", 1], ["b", 1]]),
      generatedCandidates: generated([["a", [candidate("a", 0, bounds(0, 0, 10, 10))]]]),
      configuration: config(),
    });

    expect(placementIds(result)).toEqual(["a"]);
    expect(unplacedCodes(result)).toEqual({ b: "NO_CANDIDATES_GENERATED" });
    expect(result.metrics).toMatchObject({ totalPersonCount: 2, placedLabelCount: 1, unplacedLabelCount: 1 });
  });

  it("does not mutate input candidate arrays, maps, or objects", () => {
    const firstCandidate = candidate("a", 0, bounds(0, 0, 10, 10));
    const secondCandidate = candidate("a", 1, bounds(20, 0, 30, 10));
    const candidateArray = [firstCandidate, secondCandidate];
    const personCandidateMap = new Map([[id("a"), candidateArray]]);
    const generatedCandidates: GeneratedCandidatesResult = Object.freeze({
      allCandidates: Object.freeze([...candidateArray]),
      validCandidates: Object.freeze([...candidateArray]),
      personCandidateMap,
      totalGeneratablePeople: 1,
      diagnostics: Object.freeze([]),
    });
    const skeletonPlan = skeleton([["a", 1]]);
    const originalArray = [...candidateArray];
    const originalBounds = { ...firstCandidate.bounds };
    const originalBranches = [...skeletonPlan.branches];
    const originalSkeletonPlan = JSON.stringify(skeletonPlan);

    assignCandidates({
      skeletonPlan,
      generatedCandidates,
      configuration: config(),
    });

    expect(candidateArray).toEqual(originalArray);
    expect(personCandidateMap.get(id("a"))).toBe(candidateArray);
    expect(firstCandidate.bounds).toEqual(originalBounds);
    expect(secondCandidate).toBe(originalArray[1]);
    expect(JSON.stringify(skeletonPlan)).toBe(originalSkeletonPlan);
    expect(skeletonPlan.branches).toEqual(originalBranches);
    expect(skeletonPlan.branches[0]).toBe(originalBranches[0]);
  });

  it("accepts maximumBacktrackDepth 100 and rejects 101", () => {
    const input = {
      skeletonPlan: skeleton([["a", 1]]),
      generatedCandidates: generated([["a", [candidate("a", 0, bounds(0, 0, 10, 10))]]]),
    };

    expect(() => assignCandidates({ ...input, configuration: config(100) })).not.toThrow();
    expect(() => assignCandidates({ ...input, configuration: config(101) })).toThrow(TypeError);
  });

  it("includes maximumBacktrackDepth 10 in the default configuration", () => {
    expect(DEFAULT_ENGINE_CONFIGURATION.labels.maximumBacktrackDepth).toBe(10);
  });

  it("is deterministically repeatable", () => {
    const input = {
      skeletonPlan: skeleton([["a", 1], ["b", 1], ["c", 2]]),
      generatedCandidates: generated([
        ["b", [candidate("b", 0, bounds(20, 0, 30, 10))]],
        ["c", [candidate("c", 0, bounds(40, 0, 50, 10)), candidate("c", 1, bounds(60, 0, 70, 10))]],
        ["a", [candidate("a", 0, bounds(0, 0, 10, 10))]],
      ]),
      configuration: config(),
    };

    const first = assignCandidates(input);
    const second = assignCandidates(input);

    expect(second).toEqual(first);
    expect(second.deterministicFingerprint).toEqual(first.deterministicFingerprint);
  });

  it("rejects negative and non-integer backtracking depths", () => {
    const input = {
      skeletonPlan: skeleton([["a", 1]]),
      generatedCandidates: generated([["a", [candidate("a", 0, bounds(0, 0, 10, 10))]]]),
    };

    expect(() => assignCandidates({ ...input, configuration: config(-1) })).toThrow(TypeError);
    expect(() => assignCandidates({ ...input, configuration: config(1.5) })).toThrow(TypeError);
  });
});
