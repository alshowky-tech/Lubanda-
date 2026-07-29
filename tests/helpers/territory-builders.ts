import { DEFAULT_ENGINE_CONFIGURATION } from "../../src/core/config/index.js";
import { DeterministicDemandEngine } from "../../src/core/demand/index.js";
import { buildGenealogyGraph } from "../../src/core/genealogy/index.js";
import {
  DeterministicTerritoryPlanner,
  type TemplateBoundary,
} from "../../src/core/territory/index.js";
import type { GenealogySnapshot } from "../../src/core/genealogy/types.js";

export const rectangularTemplate = (
  width = 4_000,
  height = 2_500,
): TemplateBoundary => ({
  kind: "POLYGON",
  polygon: {
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  },
});

export const planSnapshot = async (
  snapshot: GenealogySnapshot,
  templateBoundary: TemplateBoundary = rectangularTemplate(),
  seed = 42,
  territoryConfiguration = DEFAULT_ENGINE_CONFIGURATION.territory,
) => {
  const graph = buildGenealogyGraph(snapshot);
  const selectedRootId = graph.roots.find((root) => root === "1") ?? graph.roots[0]!;
  const demandPlan = await new DeterministicDemandEngine().compute({
    graph,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
  });
  const result = await new DeterministicTerritoryPlanner().plan({
    graph,
    demandPlan,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    templateBoundary,
    configuration: territoryConfiguration,
    seed,
  });
  return { graph, selectedRootId, demandPlan, result };
};
