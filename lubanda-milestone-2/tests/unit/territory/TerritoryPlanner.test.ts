import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import {
  acceptedSnapshot,
  syntheticSnapshot,
} from "../../helpers/genealogy-builders.js";
import {
  planSnapshot,
  rectangularTemplate,
} from "../../helpers/territory-builders.js";

describe("DeterministicTerritoryPlanner", () => {
  it("allocates one valid territory per major lineage", async () => {
    const { result } = await planSnapshot(acceptedSnapshot());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.territories.map((item) => item.ownerLineageRootId)).toEqual([
      "3",
      "2",
    ]);
    expect(result.value.corridors).toHaveLength(2);
    expect(result.value.validation.accepted).toBe(true);
    expect(result.value.negotiation.status).not.toBe("FAILED");
  });

  it("accepts a single-person genealogy without inventing a lineage", async () => {
    const { result } = await planSnapshot(syntheticSnapshot({ size: 1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.territories).toEqual([]);
    expect(result.value.corridors).toEqual([]);
    expect(result.value.negotiation.status).toBe("NOT_REQUIRED");
  });

  it("keeps people outside the selected root subtree out of render scope", async () => {
    const { demandPlan, result } = await planSnapshot(
      syntheticSnapshot({ size: 10, extraRootSize: 4 }),
    );
    expect(demandPlan.results).toHaveLength(10);
    expect(demandPlan.results.some((item) => item.personId.startsWith("x-"))).toBe(
      false,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a degenerate template and insufficient usable area", async () => {
    const degenerate = await planSnapshot(acceptedSnapshot(), {
      kind: "POLYGON",
      polygon: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] },
    });
    expect(degenerate.result.ok).toBe(false);
    if (!degenerate.result.ok) {
      expect(degenerate.result.errors.some((issue) => issue.code === "TEMPLATE_INVALID")).toBe(true);
    }
    const tiny = await planSnapshot(acceptedSnapshot(), rectangularTemplate(160, 160));
    expect(tiny.result.ok).toBe(false);
  });

  it("reports negotiation failure when the iteration budget cannot meet tolerance", async () => {
    const configuration = {
      ...DEFAULT_ENGINE_CONFIGURATION.territory,
      maxNegotiationIterations: 0,
      maximumAreaErrorRatio: 0,
    };
    const { result } = await planSnapshot(
      acceptedSnapshot(),
      rectangularTemplate(),
      42,
      configuration,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "TERRITORY_NEGOTIATION_FAILED",
        ),
      ).toBe(true);
    }
  });

  it("rejects narrow or impossible corridor constraints", async () => {
    const configuration = {
      ...DEFAULT_ENGINE_CONFIGURATION.territory,
      minimumCorridorLength: 10_000,
    };
    const { result } = await planSnapshot(
      acceptedSnapshot(),
      rectangularTemplate(),
      42,
      configuration,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((issue) => issue.code === "CORRIDOR_INVALID")).toBe(
        true,
      );
    }
  });
});
