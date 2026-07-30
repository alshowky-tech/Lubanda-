import type { PersonId, SkeletonBranchId } from "../../../src/core/contracts/identifiers.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import { buildGenealogyGraph } from "../../../src/core/genealogy/graph.js";
import { LabelFallbackPlanner } from "../../../src/core/labels/LabelFallbackPlanner.js";
import type { SkeletonBranch } from "../../../src/core/skeleton/types.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";

const branch = (
  personId: PersonId,
  branchIndex: number,
  x: number,
): SkeletonBranch => ({
  id: `branch:${personId}` as SkeletonBranchId,
  ownerPersonId: personId,
  parentBranchId: null,
  generation: 1,
  genealogyDepth: 1,
  territoryId: null,
  curve: {
    p0: { x, y: 80 },
    p1: { x, y: 70 },
    p2: { x, y: 60 },
    p3: { x, y: 50 },
  },
  branchRole: "SECONDARY" as const,
  verticalZone: "INNER_CANOPY" as const,
  startPoint: { x, y: 80 },
  endPoint: { x, y: 50 },
  length: 30,
  thickness: {
    baseThickness: 4,
    tipThickness: 2,
    taperRatio: 0.5,
  },
  startNodeId: `start:${personId}`,
  endNodeId: `end:${personId}`,
  childrenBranchIds: [],
  candidateScore: null,
  rejectionHistory: [],
  metadata: {
    branchIndex,
    lineageRootId: personId,
    person: acceptedSnapshot().persons.find((person) => person.id === personId)!,
  },
});

describe("LabelFallbackPlanner", () => {
  it("packs unresolved labels deterministically without overlaps", () => {
    const snapshot = acceptedSnapshot();
    const graph = buildGenealogyGraph(snapshot);
    const personIds = snapshot.persons.slice(0, 3).map((person) => person.id);
    const branches = personIds.map((personId, index) =>
      branch(personId, index, 100 + index * 10),
    );
    const input = {
      graph,
      branches,
      templatePolygon: {
        points: [
          { x: 0, y: 0 },
          { x: 600, y: 0 },
          { x: 600, y: 300 },
          { x: 0, y: 300 },
        ],
      },
      configuration: DEFAULT_ENGINE_CONFIGURATION,
      unresolvedPersonIds: personIds,
      fixedPlacements: [],
      obstacles: [],
    };

    const planner = new LabelFallbackPlanner();
    const first = planner.plan(input);
    const replay = planner.plan({
      ...input,
      unresolvedPersonIds: [...personIds].reverse(),
      branches: [...branches].reverse(),
    });

    expect(first.unresolvedPersonIds).toEqual([]);
    expect(first.placements).toHaveLength(personIds.length);
    expect(first.placements.every((placement) =>
      placement.displayName.length > 0
    )).toBe(true);
    expect(replay).toEqual(first);
    for (let index = 0; index < first.placements.length; index += 1) {
      for (let other = index + 1; other < first.placements.length; other += 1) {
        const left = first.placements[index]!.bounds;
        const right = first.placements[other]!.bounds;
        expect(
          left.maxX < right.minX ||
          right.maxX < left.minX ||
          left.maxY < right.minY ||
          right.maxY < left.minY,
        ).toBe(true);
      }
    }
  });

  it("does not move a label into a boundary disconnected from its branch", () => {
    const snapshot = acceptedSnapshot();
    const graph = buildGenealogyGraph(snapshot);
    const personId = snapshot.persons[0]!.id;
    const result = new LabelFallbackPlanner().plan({
      graph,
      branches: [branch(personId, 0, 100)],
      templatePolygon: {
        points: [
          { x: -100, y: -100 },
          { x: -10, y: -100 },
          { x: -10, y: -10 },
          { x: -100, y: -10 },
        ],
      },
      configuration: DEFAULT_ENGINE_CONFIGURATION,
      unresolvedPersonIds: [personId],
      fixedPlacements: [],
      obstacles: [],
    });

    expect(result.placements).toEqual([]);
    expect(result.unresolvedPersonIds).toEqual([personId]);
  });
});
