import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENGINE_CONFIGURATION,
  type DemandConfig,
} from "../../../src/core/config/index.js";
import { DeterministicDemandEngine } from "../../../src/core/demand/index.js";
import { buildGenealogyGraph } from "../../../src/core/genealogy/index.js";
import {
  acceptedSnapshot,
  syntheticSnapshot,
} from "../../helpers/genealogy-builders.js";

const compute = async (
  size: number,
  shape: "LINEAR" | "BALANCED" | "STAR" | "UNBALANCED",
  configuration: DemandConfig = DEFAULT_ENGINE_CONFIGURATION.demand,
) => {
  const snapshot = syntheticSnapshot({ size, shape });
  return new DeterministicDemandEngine().compute({
    graph: buildGenealogyGraph(snapshot),
    selectedRootId: snapshot.persons.find((person) => person.id === "1")!.id,
    sourceChecksum: snapshot.sourceChecksum,
    configuration,
  });
};

describe("DeterministicDemandEngine", () => {
  it("computes auditable bottom-up statistics without mutating genealogy", async () => {
    const snapshot = acceptedSnapshot();
    const before = JSON.stringify(snapshot);
    const plan = await new DeterministicDemandEngine().compute({
      graph: buildGenealogyGraph(snapshot),
      selectedRootId: snapshot.persons[0]!.id,
      sourceChecksum: snapshot.sourceChecksum,
      configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
    });
    const root = plan.results.find((result) => result.personId === "1")!;
    expect(root.raw).toMatchObject({
      descendantCount: 3,
      directChildCount: 2,
      subtreeDepth: 2,
      terminalPersonCount: 2,
    });
    expect(root.spatial.requiredArea).toBeGreaterThan(0);
    expect(plan.computationMetadata.algorithm).toBe("ITERATIVE_BOTTOM_UP");
    expect(plan.computationMetadata.deterministicFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(JSON.stringify(plan)).not.toContain('"Map"');
  });

  it("handles deep linear genealogies without recursive stack failure", async () => {
    const plan = await compute(5_000, "LINEAR");
    const root = plan.results.find((result) => result.personId === "1")!;
    expect(plan.results).toHaveLength(5_000);
    expect(root.raw.subtreeDepth).toBe(4_999);
    expect(root.raw.descendantCount).toBe(4_999);
  }, 20_000);

  it("applies explicit lineage weighting and configured limits", async () => {
    const configuration: DemandConfig = {
      ...DEFAULT_ENGINE_CONFIGURATION.demand,
      minimumArea: 1_000,
      maximumArea: 2_000,
      lineageWeights: { "2": 1.5 },
    };
    const plan = await compute(3, "STAR", configuration);
    const weighted = plan.results.find((result) => result.personId === "2")!;
    expect(weighted.spatial.appliedLineageWeight).toBe(1.5);
    expect(weighted.spatial.requiredArea).toBe(3_000);
  });

  it("is byte-identical for an identical input", async () => {
    const first = await compute(100, "BALANCED");
    const second = await compute(100, "BALANCED");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
